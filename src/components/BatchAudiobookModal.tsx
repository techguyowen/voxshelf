"use client";

import { Check, Download, Library, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type {
  AudiobookExportFormat,
  DocumentSummary,
  PrerenderEvent,
  VoiceInfo,
} from "@/lib/types";
import { Modal } from "./Modal";

export type BatchBookStage =
  | "queued"
  | "importing"
  | "synthesizing"
  | "packaging"
  | "done"
  | "error"
  | "cancelled";

export interface BatchBookJob {
  id: string;
  sourceKind: "file" | "existing-doc";
  file?: File;
  docId?: string;
  title: string;
  sentenceCount: number;
  completedSentences: number;
  cachedSentences: number;
  stage: BatchBookStage;
  error: string | null;
  downloadUrl: string | null;
  downloadFilename: string | null;
}

const ACCEPT = ".epub,.pdf,.docx,.txt,.md,.html";

const FORMATS: { id: AudiobookExportFormat; label: string }[] = [
  { id: "chapter-zip", label: "Chaptered Audiobook Bundle (.zip with Chapter WAVs + CUE + Metadata)" },
  { id: "m4b", label: "Apple Books / Audiobook (.m4b with Chapter Markers)" },
  { id: "wav", label: "Single Continuous Audiobook (.wav)" },
];

const STAGE_LABEL: Record<BatchBookStage, string> = {
  queued: "Queued",
  importing: "Importing",
  synthesizing: "Synthesizing",
  packaging: "Packaging",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
}

export function BatchAudiobookModal({
  onClose,
  existingDocs,
  onCreatedDocs,
}: {
  onClose: () => void;
  existingDocs?: DocumentSummary[];
  onCreatedDocs?: () => void;
}) {
  const [jobs, setJobs] = useState<BatchBookJob[]>([]);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState("Kore");
  const [format, setFormat] = useState<AudiobookExportFormat>("chapter-zip");
  const [stylePrompt, setStylePrompt] = useState("");
  const [autoDownload, setAutoDownload] = useState(true);
  const [running, setRunning] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<DocumentSummary[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const jobsRef = useRef<BatchBookJob[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    const snapshot = jobsRef;
    return () => {
      abortRef.current?.abort();
      for (const j of snapshot.current) {
        if (j.downloadUrl) {
          try {
            URL.revokeObjectURL(j.downloadUrl);
          } catch {
            // ignore
          }
        }
      }
    };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([api.voices(), api.settings()])
      .then(([v, s]) => {
        if (!live) return;
        setVoices(v.voices);
        setVoice(s.defaultVoice || v.default || "Kore");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!libraryOpen || existingDocs || library !== null || libraryLoading) return;
    setLibraryLoading(true);
    api
      .listDocuments()
      .then((r) => setLibrary(r.documents))
      .catch(() => setLibrary([]))
      .finally(() => setLibraryLoading(false));
  }, [libraryOpen, existingDocs, library, libraryLoading]);

  const updateJob = useCallback((id: string, patch: Partial<BatchBookJob>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setJobs((list) => [
      ...list,
      ...files.map(
        (file): BatchBookJob => ({
          id: makeId(),
          sourceKind: "file",
          file,
          title: titleFromFilename(file.name),
          sentenceCount: 0,
          completedSentences: 0,
          cachedSentences: 0,
          stage: "queued",
          error: null,
          downloadUrl: null,
          downloadFilename: null,
        }),
      ),
    ]);
  }, []);

  const docs = existingDocs ?? library ?? [];

  const toggleSelect = useCallback((id: string) => {
    setSelected((list) =>
      list.includes(id) ? list.filter((s) => s !== id) : [...list, id],
    );
  }, []);

  const addSelectedDocs = useCallback(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    setJobs((list) => {
      const known = new Set(list.map((j) => j.docId));
      const fresh: BatchBookJob[] = [];
      for (const id of selected) {
        if (known.has(id)) continue;
        const d = byId.get(id);
        if (!d) continue;
        known.add(id);
        fresh.push({
          id: makeId(),
          sourceKind: "existing-doc",
          docId: d.id,
          title: d.title,
          sentenceCount: d.sentenceCount,
          completedSentences: 0,
          cachedSentences: 0,
          stage: "queued",
          error: null,
          downloadUrl: null,
          downloadFilename: null,
        });
      }
      return [...list, ...fresh];
    });
    setSelected([]);
  }, [docs, selected]);

  const removeJob = useCallback((id: string) => {
    setJobs((list) => {
      const job = list.find((j) => j.id === id);
      if (job?.downloadUrl) {
        try {
          URL.revokeObjectURL(job.downloadUrl);
        } catch {
          // ignore
        }
      }
      return list.filter((j) => j.id !== id);
    });
  }, []);

  const startBatch = useCallback(async () => {
    if (running || jobs.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    try {
      const queue = jobs
        .filter((j) => j.stage === "queued" || j.stage === "error" || j.stage === "cancelled")
        .map((j) => j.id);
      for (const id of queue) {
        if (ctrl.signal.aborted) break;
        const latest = jobsRef.current.find((j) => j.id === id);
        if (!latest) continue;
        try {
          let docId = latest.docId;
          if (latest.sourceKind === "file" && !docId) {
            if (!latest.file) throw new Error("Missing source file.");
            updateJob(id, { stage: "importing", error: null });
            const extracted = await api.extractFile(latest.file);
            const created = await api.createDocument({
              title: extracted.title || latest.title,
              author: extracted.author,
              sourceType: extracted.sourceType,
              text: extracted.text,
              voice,
            });
            docId = created.id;
            updateJob(id, { docId, sentenceCount: created.sentenceCount });
            onCreatedDocs?.();
          }
          if (!docId) throw new Error("No document to synthesize.");
          if (ctrl.signal.aborted) {
            updateJob(id, { stage: "cancelled" });
            break;
          }
          updateJob(id, {
            stage: "synthesizing",
            error: null,
            completedSentences: 0,
            cachedSentences: 0,
          });
          let cached = 0;
          await api.prerenderStream(
            docId,
            { voice, stylePrompt: stylePrompt.trim() || undefined, concurrency: 2 },
            (ev: PrerenderEvent) => {
              if (ev.type === "start") {
                updateJob(id, { sentenceCount: ev.total });
              } else if (ev.type === "progress") {
                if (ev.cached) cached += 1;
                updateJob(id, {
                  completedSentences: ev.completed,
                  cachedSentences: cached,
                });
              } else if (ev.type === "error") {
                updateJob(id, { completedSentences: ev.completed });
              }
            },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) {
            updateJob(id, { stage: "cancelled" });
            break;
          }
          updateJob(id, { stage: "packaging" });
          const url = api.getAudiobookExportUrl(docId, {
            format,
            voice,
            style: stylePrompt,
          });
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          const ext = format === "m4b" ? "m4b" : format === "wav" ? "wav" : "zip";
          const base =
            (jobsRef.current.find((j) => j.id === id)?.title ?? "audiobook")
              .replace(/[^\w\d-_]+/g, "_")
              .slice(0, 80) || "audiobook";
          const filename = `${base}.${ext}`;
          updateJob(id, {
            stage: "done",
            downloadUrl: objectUrl,
            downloadFilename: filename,
          });
          if (autoDownload) {
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        } catch (e) {
          if (ctrl.signal.aborted) {
            updateJob(id, { stage: "cancelled" });
            break;
          }
          updateJob(id, {
            stage: "error",
            error: e instanceof Error ? e.message : "Batch step failed.",
          });
        }
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [running, jobs, voice, format, stylePrompt, autoDownload, updateJob, onCreatedDocs]);

  const stopBatch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const triggerDownload = useCallback((url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const finished = jobs.filter(
    (j) => j.stage === "done" && j.downloadUrl && j.downloadFilename,
  );

  const doneCount = jobs.filter((j) => j.stage === "done").length;
  const overallPct = jobs.length > 0 ? Math.round((doneCount / jobs.length) * 100) : 0;

  return (
    <Modal title="Batch Audiobook Studio" onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Narrator Voice</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={running}
              className="h-11 w-full rounded-lg border border-zinc-300 px-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {voices.length === 0 && <option value={voice}>{voice}</option>}
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} · {v.description}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Output Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as AudiobookExportFormat)}
              disabled={running}
              className="h-11 w-full rounded-lg border border-zinc-300 px-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-semibold">
              Style Prompt <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <input
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              disabled={running}
              placeholder="Warm, engaging audiobook narrator"
              className="h-11 w-full rounded-lg border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={autoDownload}
              onChange={(e) => setAutoDownload(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            <span className="font-medium">Auto-download each audiobook when finished</span>
          </label>
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold">1. Drop or Pick Multiple Book Files</p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              addFiles(Array.from(e.dataTransfer.files ?? []));
            }}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center ${
              dragActive
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <Upload size={24} className="text-zinc-400" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Drag &amp; drop book files here, or
            </p>
            <label className="cursor-pointer rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
              Pick Files
              <input
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              EPUB, PDF, DOCX, TXT, MD, HTML
            </p>
          </div>
        </div>

        <div>
          <button
            onClick={() => setLibraryOpen((v) => !v)}
            aria-expanded={libraryOpen}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Library size={16} /> 2. Pick from Library
            <span className="ml-auto text-xs font-normal text-zinc-500">
              {libraryOpen ? "Hide" : "Show"}
            </span>
          </button>
          {libraryOpen && (
            <div className="mt-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
              {libraryLoading ? (
                <p className="flex items-center gap-2 px-2 py-4 text-sm text-zinc-500">
                  <Loader2 size={16} className="animate-spin" /> Loading library…
                </p>
              ) : docs.length === 0 ? (
                <p className="px-2 py-4 text-sm text-zinc-500">
                  No documents in your library yet. Import a book first.
                </p>
              ) : (
                <>
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {docs.map((d) => (
                      <li key={d.id}>
                        <button
                          onClick={() => toggleSelect(d.id)}
                          aria-pressed={selected.includes(d.id)}
                          className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm ${
                            selected.includes(d.id)
                              ? "bg-emerald-50 dark:bg-emerald-950/40"
                              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              selected.includes(d.id)
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-zinc-300 dark:border-zinc-600"
                            }`}
                            aria-hidden="true"
                          >
                            {selected.includes(d.id) && <Check size={14} />}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {d.sentenceCount.toLocaleString()} sentences
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={addSelectedDocs}
                    disabled={selected.length === 0}
                    className="mt-2 min-h-[44px] w-full rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    Add {selected.length} to batch
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {jobs.length > 0 && (
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="font-semibold">
                  {doneCount} of {jobs.length} books completed
                </span>
                <span className="text-xs tabular-nums text-zinc-500">{overallPct}%</span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
                role="progressbar"
                aria-valuenow={overallPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Overall batch progress"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width]"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
            </div>

            <ul className="space-y-2">
              {jobs.map((job) => {
                const pct =
                  job.sentenceCount > 0
                    ? Math.min(
                        100,
                        Math.round((job.completedSentences / job.sentenceCount) * 100),
                      )
                    : job.stage === "done"
                      ? 100
                      : 0;
                return (
                  <li
                    key={job.id}
                    className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{job.title}</p>
                      <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                        {STAGE_LABEL[job.stage]}
                      </span>
                      {!running && (
                        <button
                          onClick={() => removeJob(job.id)}
                          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          aria-label={`Remove ${job.title} from batch`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    {(job.stage === "synthesizing" ||
                      job.stage === "importing" ||
                      job.stage === "packaging") && (
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300" aria-live="polite">
                        {job.stage === "importing" && "Importing book text…"}
                        {job.stage === "synthesizing" &&
                          `Synthesizing ${job.completedSentences.toLocaleString()} / ${job.sentenceCount.toLocaleString()} sentences…`}
                        {job.stage === "packaging" && "Packaging audiobook…"}
                        {job.cachedSentences > 0 &&
                          ` (${job.cachedSentences.toLocaleString()} from cache)`}
                      </p>
                    )}
                    {(job.stage === "synthesizing" || job.stage === "done") && (
                      <div
                        className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Progress for ${job.title}`}
                      >
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-[width]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                    {job.stage === "error" && job.error && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{job.error}</p>
                    )}
                    {job.stage === "done" && job.downloadUrl && job.downloadFilename && (
                      <button
                        onClick={() =>
                          triggerDownload(job.downloadUrl as string, job.downloadFilename as string)
                        }
                        className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                      >
                        <Download size={14} /> Download Audiobook
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap gap-2">
              {!running ? (
                <button
                  onClick={() => void startBatch()}
                  className="min-h-[44px] rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                >
                  {doneCount > 0 ? "Resume Batch" : "Start Batch"}
                </button>
              ) : (
                <button
                  onClick={stopBatch}
                  className="min-h-[44px] rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Stop Batch
                </button>
              )}
              {finished.length > 1 && (
                <button
                  onClick={() => {
                    for (const j of finished) {
                      if (j.downloadUrl && j.downloadFilename) {
                        triggerDownload(j.downloadUrl, j.downloadFilename);
                      }
                    }
                  }}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <Download size={16} /> Download All Finished ({finished.length})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
