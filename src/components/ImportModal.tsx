"use client";

import {
  Camera,
  ClipboardPaste,
  FileUp,
  Globe,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  ScanLine,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client";
import type { ExtractResult, SourceType } from "@/lib/types";
import { countWords } from "@/lib/text";
import { Modal } from "./Modal";

type Tab = "upload" | "scan" | "gdocs" | "article" | "paste";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "upload", label: "Upload", icon: <FileUp size={16} /> },
  { id: "scan", label: "Scan / OCR", icon: <ScanLine size={16} /> },
  { id: "gdocs", label: "Google Docs", icon: <Link2 size={16} /> },
  { id: "article", label: "Web Article", icon: <Globe size={16} /> },
  { id: "paste", label: "Paste Text", icon: <ClipboardPaste size={16} /> },
];

const inputCls =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900";

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Shared "review extraction then save" panel. */
function ExtractPreview({
  result,
  sourceLabel,
  onSave,
  saving,
}: {
  result: ExtractResult;
  sourceLabel: string;
  onSave: (title: string, tags: string[]) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(result.title);
  const [tags, setTags] = useState("");
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {sourceLabel}
        </span>
        <span>{result.wordCount.toLocaleString()} words</span>
        <span>·</span>
        <span>{result.sentenceCount.toLocaleString()} sentences</span>
        {result.pages ? (
          <>
            <span>·</span>
            <span>{result.pages} pages</span>
          </>
        ) : null}
        {result.author && (
          <>
            <span>·</span>
            <span className="max-w-40 truncate">{result.author}</span>
          </>
        )}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={inputCls}
        placeholder="Document title"
        aria-label="Document title"
      />
      <div className="max-h-48 overflow-y-auto rounded-lg bg-zinc-50 p-3 text-sm whitespace-pre-wrap dark:bg-zinc-900/60">
        {result.text.slice(0, 4000)}
        {result.text.length > 4000 && "\n\n…"}
      </div>
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className={inputCls}
        placeholder="Tags (comma separated, optional)"
        aria-label="Tags"
      />
      <button
        onClick={() => onSave(title.trim() || result.title, parseTags(tags))}
        disabled={saving}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        Save to library & start reading
      </button>
    </div>
  );
}

function UploadTab({ onSaved }: { onSaved: (id: string) => void }) {
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [cleanup, setCleanup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const out = await api.extractFile(file, { cleanup });
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save(title: string, tags: string[]) {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const doc = await api.createDocument({
        title,
        text: result.text,
        sourceType: result.sourceType,
        sourceUrl: result.sourceUrl,
        author: result.author,
        tags,
      });
      onSaved(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save document.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragOver
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-zinc-300 hover:border-emerald-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        }`}
      >
        <FileUp size={28} className="text-zinc-400" />
        <p className="text-sm font-medium">
          {busy ? `Extracting ${fileName}…` : "Drop a file here or click to browse"}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          PDF · EPUB · DOCX · TXT · MD · Images
        </p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.epub,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={cleanup}
          onChange={(e) => setCleanup(e.target.checked)}
          className="h-4 w-4 accent-emerald-600"
        />
        AI cleanup (fix extraction artifacts — needs API key)
      </label>
      {busy && (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={18} /> Extracting text…
        </div>
      )}
      <ErrorBox message={error} />
      {result && (
        <ExtractPreview
          result={result}
          sourceLabel={fileName || "File"}
          onSave={save}
          saving={saving}
        />
      )}
    </div>
  );
}

function ScanTab({ onSaved }: { onSaved: (id: string) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [mode, setMode] = useState("auto");
  const [cleanup, setCleanup] = useState(true);
  const [text, setText] = useState("");
  const [engine, setEngine] = useState("");
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [fromCamera, setFromCamera] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File, camera: boolean) {
    setPreview(URL.createObjectURL(file));
    setFromCamera(camera);
    setBusy(true);
    setError(null);
    setText("");
    try {
      const out = await api.ocr(file, { mode, cleanup });
      setText(out.cleaned || out.text);
      setEngine(out.engine === "ai-vision" ? "Gemini Vision" : "Tesseract (on-device)");
      setTitle((t) => t || `Scan ${new Date().toLocaleString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCR failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runCleanup() {
    if (!text.trim()) return;
    setCleaning(true);
    setError(null);
    try {
      const out = await api.cleanup(text);
      setText(out.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI cleanup failed.");
    } finally {
      setCleaning(false);
    }
  }

  async function save() {
    if (!text.trim()) {
      setError("Nothing to save yet — scan a page first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const doc = await api.createDocument({
        title: title.trim() || `Scan ${new Date().toLocaleString()}`,
        text: text.trim(),
        sourceType: (fromCamera ? "camera" : "file-image") as SourceType,
      });
      onSaved(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save document.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => cameraRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <Camera size={16} /> Take photo
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <ImageIcon size={16} /> Choose image
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f, true);
            e.target.value = "";
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f, false);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          Engine
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="auto">Auto (AI if key set)</option>
            <option value="ai">Gemini Vision</option>
            <option value="local">On-device (Tesseract)</option>
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          AI cleanup
        </label>
      </div>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Scan preview"
          className="max-h-40 w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
        />
      )}
      {busy && (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={18} /> Recognizing text…
        </div>
      )}
      <ErrorBox message={error} />
      {(text || engine) && (
        <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          {engine && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Recognized with {engine} · {countWords(text).toLocaleString()} words — edit freely:
            </p>
          )}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
            placeholder="Document title"
            aria-label="Document title"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className={`${inputCls} whitespace-pre-wrap`}
          />
          <div className="flex gap-2">
            <button
              onClick={runCleanup}
              disabled={cleaning || !text.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {cleaning ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              AI cleanup
            </button>
            <button
              onClick={save}
              disabled={saving || !text.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Save & read
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UrlTab({
  onSaved,
  kind,
}: {
  onSaved: (id: string) => void;
  kind: "gdocs" | "article";
}) {
  const [url, setUrl] = useState("");
  const [cleanup, setCleanup] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    if (!url.trim()) {
      setError("Paste a link first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.extractUrl(url.trim(), cleanup);
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save(title: string, tags: string[]) {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const doc = await api.createDocument({
        title,
        text: result.text,
        sourceType: result.sourceType,
        sourceUrl: result.sourceUrl,
        author: result.author,
        tags,
      });
      onSaved(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save document.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void extract();
          }}
          type="url"
          inputMode="url"
          placeholder={
            kind === "gdocs"
              ? "https://docs.google.com/document/d/…"
              : "https://example.com/article"
          }
          className={inputCls}
          spellCheck={false}
        />
        <button
          onClick={extract}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Import
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {kind === "gdocs"
          ? "The doc must be shared as “Anyone with the link can view”. Private docs can't be imported."
          : "Reader view is extracted automatically. Paywalled or JavaScript-heavy pages may fail."}
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={cleanup}
          onChange={(e) => setCleanup(e.target.checked)}
          className="h-4 w-4 accent-emerald-600"
        />
        AI cleanup (needs API key)
      </label>
      <ErrorBox message={error} />
      {result && (
        <ExtractPreview
          result={result}
          sourceLabel={kind === "gdocs" ? "Google Docs" : "Web article"}
          onSave={save}
          saving={saving}
        />
      )}
    </div>
  );
}

// Minimal Web Speech API shapes (not in TS DOM lib).
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResultItem {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
  length: number;
}
interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultItem>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function PasteTab({ onSaved }: { onSaved: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorderKind, setRecorderKind] = useState<"webspeech" | "media" | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [dictated, setDictated] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const baseTextRef = useRef("");
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function appendDictation(chunk: string) {
    const clean = chunk.trim();
    if (!clean) return;
    setText((prev) => {
      const base = prev.trimEnd();
      if (base.endsWith(clean.slice(0, Math.min(base.length, clean.length))) && base.length > 0) {
        return prev;
      }
      return base ? `${base} ${clean}` : clean;
    });
    setDictated(true);
  }

  async function startMediaFallback() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Voice dictation is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) {
          setRecording(false);
          setRecorderKind(null);
          return;
        }
        setTranscribing(true);
        api
          .transcribe(blob)
          .then((out) => {
            if (out.text.trim()) appendDictation(out.text);
            else setError("No speech detected in the recording.");
          })
          .catch((e) => setError(e instanceof Error ? e.message : "Transcription failed."))
          .finally(() => {
            setTranscribing(false);
            setRecording(false);
            setRecorderKind(null);
          });
      };
      mediaRecorderRef.current = recorder;
      stopRequestedRef.current = false;
      recorder.start();
      setRecorderKind("media");
      setRecording(true);
      setError(null);
    } catch {
      setError("Microphone access was denied.");
    }
  }

  function startDictation() {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      void startMediaFallback();
      return;
    }
    try {
      const rec = new Ctor();
      recognitionRef.current = rec;
      baseTextRef.current = text;
      stopRequestedRef.current = false;
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let finalSoFar = "";
      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalSoFar += res[0].transcript;
          else interimText += res[0].transcript;
        }
        setInterim(interimText);
        if (finalSoFar.trim()) {
          const base = baseTextRef.current.trimEnd();
          setText(base ? `${base} ${finalSoFar.trim()}` : finalSoFar.trim());
          baseTextRef.current = base ? `${base} ${finalSoFar.trim()}` : finalSoFar.trim();
          finalSoFar = "";
          setDictated(true);
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone access was denied.");
        } else if (e.error && e.error !== "aborted" && e.error !== "no-speech") {
          setError(`Dictation error: ${e.error}`);
        }
      };
      rec.onend = () => {
        setInterim("");
        if (!stopRequestedRef.current && recording) {
          // Some browsers end continuous sessions spontaneously; resume.
          try {
            rec.start();
            return;
          } catch {
            // fall through to stopped state
          }
        }
        setRecording(false);
        setRecorderKind(null);
      };
      rec.start();
      setRecorderKind("webspeech");
      setRecording(true);
      setError(null);
    } catch {
      void startMediaFallback();
    }
  }

  function stopDictation() {
    stopRequestedRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    if (mediaRecorderRef.current?.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    } else if (recorderKind === "webspeech") {
      setRecording(false);
      setRecorderKind(null);
      setInterim("");
    }
  }

  async function cleanupDictated() {
    if (!text.trim()) return;
    setCleaning(true);
    setError(null);
    try {
      const out = await api.cleanup(text, "dictation");
      setText(out.text);
      setDictated(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI cleanup failed.");
    } finally {
      setCleaning(false);
    }
  }

  async function save() {
    if (!text.trim()) {
      setError("Paste some text first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const doc = await api.createDocument({
        title: title.trim() || text.trim().split("\n")[0].slice(0, 80) || "Pasted text",
        text: text.trim(),
        sourceType: "paste",
        tags: parseTags(tags),
      });
      onSaved(doc.id);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Failed to save document.",
      );
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={inputCls}
        placeholder="Title (optional — first line is used when empty)"
        aria-label="Title"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => (recording ? stopDictation() : startDictation())}
          disabled={transcribing}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${
            recording
              ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          }`}
        >
          {recording ? <Square size={15} /> : <Mic size={15} />}
          {recording
            ? `Stop dictation${recorderKind === "media" ? " (recording…)" : " (listening…)"}`
            : "🎤 Voice Dictation"}
        </button>
        {dictated && !recording && (
          <button
            onClick={() => void cleanupDictated()}
            disabled={cleaning || !text.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          >
            {cleaning ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            ✨ Clean Up with AI
          </button>
        )}
      </div>
      {transcribing && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={15} /> Transcribing recording…
        </div>
      )}
      <textarea
        value={interim ? `${text}${text.endsWith(" ") || !text ? "" : " "}${interim}` : text}
        onChange={(e) => {
          setText(e.target.value);
          setInterim("");
        }}
        rows={10}
        className={`${inputCls} whitespace-pre-wrap`}
        placeholder="Paste or type text here… or dictate with the microphone."
        aria-label="Text"
      />
      <div className="flex items-center justify-between gap-2">
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={`${inputCls} max-w-44`}
          placeholder="Tags, optional"
          aria-label="Tags"
        />
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          {countWords(text).toLocaleString()} words
        </span>
      </div>
      <ErrorBox message={error} />
      <button
        onClick={save}
        disabled={saving || !text.trim()}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        Save to library & start reading
      </button>
    </div>
  );
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("upload");
  const router = useRouter();

  function onSaved(id: string) {
    onClose();
    router.push(`/reader/${id}`);
    router.refresh();
  }

  return (
    <Modal title="Import to VocalFlow" onClose={onClose} wide>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium sm:text-sm ${
              tab === t.id
                ? "bg-white text-zinc-900 shadow dark:bg-zinc-950 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.label.split(" ")[0]}</span>
          </button>
        ))}
      </div>
      {tab === "upload" && <UploadTab onSaved={onSaved} />}
      {tab === "scan" && <ScanTab onSaved={onSaved} />}
      {tab === "gdocs" && <UrlTab kind="gdocs" onSaved={onSaved} />}
      {tab === "article" && <UrlTab kind="article" onSaved={onSaved} />}
      {tab === "paste" && <PasteTab onSaved={onSaved} />}
    </Modal>
  );
}
