"use client";

import { Download, Loader2, Pause, Play, XCircle, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import {
  estimateTtsCostUsd,
  formatUsd,
  FREE_TIER_LIMITS,
} from "@/lib/pricing";
import type {
  DocumentDetail,
  PrerenderCompleteEvent,
  PrerenderEvent,
  PrerenderStats,
} from "@/lib/types";
import { Modal } from "./Modal";

type Scope = "full" | "from-current" | "next50" | "next100";
type Phase = "loading" | "config" | "running" | "paused" | "done";

const SCOPES: { id: Scope; label: string; hint: (current: number, total: number) => string }[] = [
  {
    id: "full",
    label: "Whole Document",
    hint: (_c, t) => `${t.toLocaleString()} sentences`,
  },
  {
    id: "from-current",
    label: "From Current Sentence to End",
    hint: (c, t) => `Sentence ${c + 1} → ${t} (${Math.max(0, t - c).toLocaleString()} left)`,
  },
  {
    id: "next50",
    label: "Next 50 Sentences",
    hint: () => "≈10 mins of audio",
  },
  {
    id: "next100",
    label: "Next 100 Sentences",
    hint: () => "≈20 mins of audio",
  },
];

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatAudioLength(ms: number): string {
  const mins = ms / 60000;
  if (mins < 1) return `${Math.round(ms / 1000)}s of audio`;
  if (mins < 60) return `${mins.toFixed(1)} mins of audio`;
  return `${(mins / 60).toFixed(1)} hrs of audio`;
}

export function PrerenderModal({
  docId,
  title,
  currentIdx,
  onClose,
  onDone,
}: {
  docId: string;
  title: string;
  currentIdx: number;
  onClose: () => void;
  onDone?: (stats: PrerenderStats) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [stats, setStats] = useState<PrerenderStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("full");

  const [completed, setCompleted] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [synthCount, setSynthCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [preview, setPreview] = useState("");
  const [runTotal, setRunTotal] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PrerenderCompleteEvent | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const seenRef = useRef<Set<number>>(new Set());
  const rangeRef = useRef({ start: 0, count: 0 });
  const elapsedBaseRef = useRef(0);
  const segmentStartRef = useRef(0);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getDocument(docId), api.getPrerenderStats(docId)])
      .then(([detail, s]) => {
        if (cancelled) return;
        setDoc(detail);
        setStats(s);
        setPhase("config");
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load document.");
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [docId]);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      setElapsedMs(elapsedBaseRef.current + (Date.now() - segmentStartRef.current));
    }, 500);
    return () => clearInterval(t);
  }, [phase]);

  const range = useMemo(() => {
    const total = doc?.sentences.length ?? 0;
    const cur = Math.max(0, Math.min(total - 1, currentIdx));
    switch (scope) {
      case "from-current":
        return { start: cur, count: Math.max(0, total - cur) };
      case "next50":
        return { start: cur, count: Math.min(50, Math.max(0, total - cur)) };
      case "next100":
        return { start: cur, count: Math.min(100, Math.max(0, total - cur)) };
      case "full":
      default:
        return { start: 0, count: total };
    }
  }, [doc, scope, currentIdx]);

  const estimate = useMemo(() => {
    if (!doc) return { chars: 0, alreadyCached: 0, billable: 0 };
    const targets = doc.sentences.slice(range.start, range.start + range.count);
    const uncached = targets.filter((s) => !s.audioHash);
    return {
      chars: targets.reduce((n, s) => n + s.text.length, 0),
      alreadyCached: targets.length - uncached.length,
      billable: uncached.reduce((n, s) => n + s.text.length, 0),
    };
  }, [doc, range]);

  const handleEvent = useCallback((event: PrerenderEvent) => {
    if (event.type === "progress" || event.type === "error") {
      if (seenRef.current.has(event.sentenceIdx)) return;
      seenRef.current.add(event.sentenceIdx);
      setCompleted(seenRef.current.size);
      setPreview(event.textPreview);
      if (event.type === "progress") {
        if (event.cached) setCachedCount((n) => n + 1);
        else setSynthCount((n) => n + 1);
      } else {
        setFailedCount((n) => n + 1);
      }
    }
  }, []);

  const startRun = useCallback(
    async (fresh: boolean) => {
      if (!doc) return;
      const { start, count } = fresh ? range : rangeRef.current;
      if (count <= 0) return;
      if (fresh) {
        rangeRef.current = { start, count };
        seenRef.current = new Set();
        setCompleted(0);
        setCachedCount(0);
        setSynthCount(0);
        setFailedCount(0);
        setPreview("");
        setRunTotal(count);
        setRunError(null);
        setSummary(null);
        elapsedBaseRef.current = 0;
        setElapsedMs(0);
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      segmentStartRef.current = Date.now();
      setPhase("running");
      try {
        const done = await api.prerenderStream(
          docId,
          { startIndex: start, count },
          handleEvent,
          ctrl.signal,
        );
        const freshStats = await api.getPrerenderStats(docId);
        setStats(freshStats);
        setElapsedMs(elapsedBaseRef.current + (Date.now() - segmentStartRef.current));
        setSummary(done);
        setPhase("done");
        onDone?.(freshStats);
      } catch (e) {
        if (ctrl.signal.aborted && phaseRef.current !== "paused") return;
        if (e instanceof ApiError && e.status === 499) return;
        elapsedBaseRef.current += Date.now() - segmentStartRef.current;
        setElapsedMs(elapsedBaseRef.current);
        setRunError(e instanceof Error ? e.message : "Pre-render failed.");
        setPhase("paused");
      }
    },
    [doc, docId, range, handleEvent, onDone],
  );

  const pause = useCallback(() => {
    elapsedBaseRef.current += Date.now() - segmentStartRef.current;
    setElapsedMs(elapsedBaseRef.current);
    setPhase("paused");
    abortRef.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    elapsedBaseRef.current = 0;
    setElapsedMs(0);
    setCompleted(0);
    setCachedCount(0);
    setSynthCount(0);
    setFailedCount(0);
    setPreview("");
    setRunError(null);
    setSummary(null);
    setPhase("config");
    api.getPrerenderStats(docId).then(setStats).catch(() => {});
  }, [docId]);

  const pct = runTotal > 0 ? Math.round((completed / runTotal) * 100) : 0;
  const etaMs =
    phase === "running" && completed > 0 && runTotal > completed
      ? (elapsedMs / completed) * (runTotal - completed)
      : null;

  return (
    <Modal title={`Pre-render audio — ${title}`} onClose={onClose} wide>
      {phase === "loading" && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={18} /> Loading document…
        </div>
      )}

      {loadError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </p>
      )}

      {(phase === "config" || phase === "paused") && doc && !loadError && (
        <div className="space-y-4">
          {stats && (
            <div className="flex items-center gap-2 text-sm">
              <Zap size={16} className="text-amber-500" />
              <span className="text-zinc-600 dark:text-zinc-300">
                {stats.cachedSentences.toLocaleString()} of{" "}
                {stats.totalSentences.toLocaleString()} sentences cached (
                {stats.percentCached}%)
              </span>
              {stats.isFullyCached && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                  Offline Ready
                </span>
              )}
            </div>
          )}

          <fieldset disabled={phase === "paused"}>
            <legend className="mb-2 text-sm font-semibold">Scope</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  aria-pressed={scope === s.id}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    scope === s.id
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                  }`}
                >
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {s.hint(Math.min(currentIdx, doc.sentences.length - 1), doc.sentences.length)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="rounded-lg bg-zinc-100 px-3 py-2.5 text-sm dark:bg-zinc-800">
            <span className="font-semibold">
              Est. cost: {formatUsd(estimateTtsCostUsd(estimate.billable))} (
              {estimate.billable.toLocaleString()} chars)
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {" "}· Free tier eligible ({FREE_TIER_LIMITS})
              {estimate.alreadyCached > 0 &&
                ` · ${estimate.alreadyCached.toLocaleString()} already cached, free`}
            </span>
          </div>

          {phase === "paused" && (
            <div>
              <div
                className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Pre-render progress"
              >
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                Paused at sentence {completed} of {runTotal} ({cachedCount} from
                cache, {synthCount} newly generated
                {failedCount > 0 ? `, ${failedCount} failed` : ""}).
              </p>
            </div>
          )}

          {runError && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              {runError} Progress is saved — resume to continue.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {phase === "config" ? (
              <button
                onClick={() => void startRun(true)}
                disabled={range.count <= 0}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                <Zap size={16} />
                Pre-render {range.count.toLocaleString()} sentence
                {range.count === 1 ? "" : "s"}
              </button>
            ) : (
              <>
                <button
                  onClick={() => void startRun(false)}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                >
                  <Play size={16} /> Resume
                </button>
                <button
                  onClick={cancel}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">{pct}%</span>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatClock(elapsedMs)} elapsed
                {etaMs !== null && ` · ≈${formatClock(etaMs)} left`}
              </span>
            </div>
            <div
              className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Pre-render progress"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <p className="text-sm" aria-live="polite">
            Sentence {Math.min(completed + 1, runTotal)} of {runTotal} (
            {cachedCount} from cache, {synthCount} newly generated
            {failedCount > 0 ? `, ${failedCount} failed` : ""})
          </p>

          {preview && (
            <p className="truncate rounded-lg bg-zinc-100 px-3 py-2 text-xs italic text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              “{preview}”
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={pause}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              <Pause size={16} /> Pause
            </button>
            <button
              onClick={cancel}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "done" && summary && (
        <div className="space-y-4 text-center">
          <p className="text-lg font-bold">
            {stats?.isFullyCached
              ? "🎉 Document is 100% Pre-rendered & Offline Ready!"
              : "Pre-render complete!"}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {summary.total.toLocaleString()} sentences · {summary.cached} from
            cache · {summary.synthesized} newly generated
            {summary.failed > 0 && ` · ${summary.failed} failed`} ·{" "}
            {formatAudioLength(summary.totalDurationMs)} · took{" "}
            {formatClock(elapsedMs)}
          </p>
          {stats && !stats.isFullyCached && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Document is {stats.percentCached}% cached overall — run again with
              “Whole Document” to finish.
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <a
              href={`/api/documents/${docId}/audio?download=1`}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              <Download size={16} /> Download full WAV
            </a>
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Back to reading
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
