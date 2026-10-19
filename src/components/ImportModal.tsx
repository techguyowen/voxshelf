"use client";

import {
  BookOpen,
  Briefcase,
  Camera,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  FileAudio,
  FileText,
  FileUp,
  Globe,
  GraduationCap,
  Headphones,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Rss,
  ScanLine,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, formatBytes } from "@/lib/client";
import type { AudioNoteMode, ExtractResult, Feed, FeedItem, SourceType } from "@/lib/types";
import { countWords } from "@/lib/text";
import { Modal } from "./Modal";

type Tab = "audio" | "upload" | "scan" | "rss" | "gdocs" | "article" | "paste";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "audio", label: "Voice & Audio", icon: <Mic size={16} /> },
  { id: "upload", label: "Upload", icon: <FileUp size={16} /> },
  { id: "scan", label: "Scan / OCR", icon: <ScanLine size={16} /> },
  { id: "rss", label: "RSS & Feeds", icon: <Rss size={16} /> },
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

const AUDIO_NOTE_MODES: {
  id: AudioNoteMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "meeting",
    label: "Meeting Notes",
    desc: "Action items, decisions & attendee takeaways",
    icon: <Briefcase size={15} />,
  },
  {
    id: "lecture",
    label: "Lecture & Study",
    desc: "Core concepts, definitions, study notes & review questions",
    icon: <GraduationCap size={15} />,
  },
  {
    id: "notes",
    label: "Voice Memo / Notes",
    desc: "Executive summary, comprehensive takeaways & key points",
    icon: <FileText size={15} />,
  },
  {
    id: "transcript-only",
    label: "Full Transcript",
    desc: "Verbatim speech-to-text transcription",
    icon: <BookOpen size={15} />,
  },
];

function AudioTab({ onSaved }: { onSaved: (id: string) => void }) {
  const [subMode, setSubMode] = useState<"record" | "upload">("record");
  const [noteMode, setNoteMode] = useState<AudioNoteMode>("meeting");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");

  // Recording state
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused" | "recorded">("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");
  const [fullTranscript, setFullTranscript] = useState("");

  // Upload file state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadAudioUrl, setUploadAudioUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Status & submission
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingStateRef = useRef(recordingState);
  recordingStateRef.current = recordingState;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLen = analyser.frequencyBinCount;
      const dataArr = new Uint8Array(bufferLen);

      const draw = () => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const cCtx = canvas.getContext("2d");
        if (!cCtx) return;

        analyser.getByteFrequencyData(dataArr);
        cCtx.clearRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLen) * 1.35;
        let x = 0;

        for (let i = 0; i < bufferLen; i++) {
          const barHeight = Math.max(3, (dataArr[i] / 255) * canvas.height * 0.9);
          const grad = cCtx.createLinearGradient(0, canvas.height, 0, 0);
          grad.addColorStop(0, "#10b981");
          grad.addColorStop(1, "#06b6d4");

          cCtx.fillStyle = grad;
          cCtx.beginPath();
          cCtx.roundRect(x, canvas.height - barHeight, Math.max(barWidth - 2, 2), barHeight, 2);
          cCtx.fill();

          x += barWidth + 2;
        }

        animFrameRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      // Audio visualizer non-fatal
    }
  };

  const stopVisualizer = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const startRecognition = () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      recognitionRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (e) => {
        let fullAcc = "";
        for (let i = 0; i < e.results.length; i++) {
          fullAcc += e.results[i][0].transcript + " ";
        }
        setFullTranscript(fullAcc.trim());

        let recentAcc = "";
        for (let i = Math.max(0, e.results.length - 2); i < e.results.length; i++) {
          recentAcc += e.results[i][0].transcript + " ";
        }
        setInterimText(recentAcc.trim());
      };
      rec.onend = () => {
        if (recordingStateRef.current === "recording") {
          try {
            rec.start();
          } catch {
            // ignore
          }
        }
      };
      rec.start();
    } catch {
      // speech recognition optional
    }
  };

  const stopRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  };

  async function startRecording() {
    setError(null);
    setInterimText("");
    setFullTranscript("");
    setRecordedBlob(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const supported = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";

      const recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mime });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        stopVisualizer();
        stopRecognition();
      };

      recorder.start(500);
      setRecordingState("recording");
      setRecordSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      startVisualizer(stream);
      startRecognition();
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access was denied. Please allow microphone permissions in your browser."
          : "Could not access microphone."
      );
      setRecordingState("idle");
    }
  }

  function pauseRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setRecordingState("paused");
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setRecordingState("recording");
      timerIntervalRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    }
  }

  function stopRecording() {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setRecordingState("recorded");
  }

  function handleFileSelected(file: File) {
    if (!file) return;
    setError(null);
    setUploadFile(file);
    if (uploadAudioUrl) URL.revokeObjectURL(uploadAudioUrl);
    const url = URL.createObjectURL(file);
    setUploadAudioUrl(url);
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  }

  async function handleSubmit() {
    const audioTarget = subMode === "record" ? recordedBlob : uploadFile;
    if (!audioTarget) {
      setError(subMode === "record" ? "Record some audio first." : "Select an audio file first.");
      return;
    }

    const hasLiveTranscript = subMode === "record" && Boolean(fullTranscript.trim());
    setBusy(true);
    setError(null);
    setStatusMessage(
      hasLiveTranscript
        ? (noteMode === "transcript-only" ? "Saving live recording..." : "Extracting structured notes from live transcript with Gemini...")
        : "Uploading audio and transcribing with Gemini 3.5..."
    );

    try {
      const form = new FormData();
      const filename =
        subMode === "record"
          ? `live_recording_${Date.now()}.webm`
          : uploadFile?.name || "recording.mp3";

      form.append("file", audioTarget, filename);
      form.append("mode", noteMode);
      if (hasLiveTranscript) {
        form.append("transcript", fullTranscript.trim());
      }
      if (title.trim()) form.append("title", title.trim());
      if (tags.trim()) form.append("tags", tags.trim());
      form.append("recordedLive", subMode === "record" ? "1" : "0");
      form.append("saveDocument", "1");
      if (subMode === "record" && recordSeconds > 0) {
        form.append("durationMs", String(recordSeconds * 1000));
      }

      const res = await api.transcribeAndNote(form);

      if (res.document?.id) {
        onSaved(res.document.id);
      } else {
        throw new Error("Document was not created.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transcribe audio.");
      setBusy(false);
      setStatusMessage(null);
    }
  }

  async function handleSaveDirectTranscript() {
    if (!fullTranscript.trim()) return;
    setBusy(true);
    setError(null);
    setStatusMessage("Saving document to library...");
    try {
      const doc = await api.createDocument({
        title: title.trim() || `Live Recording (${formatTimer(recordSeconds)})`,
        text: fullTranscript.trim(),
        tags: parseTags(tags),
        sourceType: "dictation",
      });
      onSaved(doc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save transcript.");
      setBusy(false);
      setStatusMessage(null);
    }
  }

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      stopVisualizer();
      stopRecognition();
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
      if (uploadAudioUrl) URL.revokeObjectURL(uploadAudioUrl);
    };
  }, [recordedAudioUrl, uploadAudioUrl]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      {/* Submode Switcher: Record Live vs Upload */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/80">
        <button
          type="button"
          onClick={() => {
            setSubMode("record");
            setError(null);
          }}
          className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
            subMode === "record"
              ? "bg-white text-emerald-700 shadow dark:bg-zinc-900 dark:text-emerald-400"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          <Mic size={15} />
          Record Live
        </button>
        <button
          type="button"
          onClick={() => {
            setSubMode("upload");
            setError(null);
          }}
          className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
            subMode === "upload"
              ? "bg-white text-emerald-700 shadow dark:bg-zinc-900 dark:text-emerald-400"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          <FileAudio size={15} />
          Upload Recording
        </button>
      </div>

      {/* Note-Taking Mode Selector */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Note-Taking Style
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {AUDIO_NOTE_MODES.map((m) => {
            const active = noteMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setNoteMode(m.id)}
                className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition ${
                  active
                    ? "border-emerald-500 bg-emerald-50/70 text-emerald-900 ring-1 ring-emerald-500 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                }`}
              >
                <div className="mb-1 flex items-center gap-1.5 font-medium text-xs">
                  {m.icon}
                  <span>{m.label}</span>
                </div>
                <span className="line-clamp-2 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
                  {m.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode-specific Recording or Upload Box */}
      {subMode === "record" ? (
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          {recordingState === "idle" && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <button
                type="button"
                onClick={() => void startRecording()}
                className="group relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-700 hover:scale-105 active:scale-95 dark:bg-emerald-500 dark:text-zinc-950"
              >
                <span className="absolute -inset-1 animate-ping rounded-full bg-emerald-400/40" />
                <Mic size={32} className="relative z-10" />
              </button>
              <h3 className="mt-4 font-semibold text-sm text-zinc-800 dark:text-zinc-200">
                Click to Start Recording
              </h3>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Speak naturally. Audio is recorded live and transcribed with Gemini 3.5.
              </p>
            </div>
          )}

          {(recordingState === "recording" || recordingState === "paused") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3 w-3 rounded-full ${
                      recordingState === "recording"
                        ? "animate-pulse bg-red-500"
                        : "bg-amber-500"
                    }`}
                  />
                  <span className="font-mono font-bold text-sm text-zinc-800 dark:text-zinc-200">
                    {formatTimer(recordSeconds)}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {recordingState === "recording" ? "Recording Live" : "Paused"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {recordingState === "recording" ? (
                    <button
                      type="button"
                      onClick={pauseRecording}
                      className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <Pause size={13} /> Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={resumeRecording}
                      className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <Play size={13} /> Resume
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950"
                  >
                    <Square size={13} /> Finish Recording
                  </button>
                </div>
              </div>

              {/* Waveform Canvas */}
              <canvas
                ref={canvasRef}
                width={480}
                height={64}
                className="h-16 w-full rounded-xl bg-zinc-950"
              />

              {/* Live interim preview if speech recognition available */}
              {interimText && (
                <div className="rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-300">
                  <div className="mb-0.5 flex items-center gap-1 font-semibold text-[10px] text-emerald-600 dark:text-emerald-400">
                    <Radio size={11} className="animate-pulse" /> Live Speech Preview
                  </div>
                  <p className="italic">“{interimText}”</p>
                </div>
              )}
            </div>
          )}

          {recordingState === "recorded" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <span className="font-semibold text-xs text-zinc-800 dark:text-zinc-200">
                    Recording Complete ({formatTimer(recordSeconds)}) · Audio saved
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRecordingState("idle");
                    setRecordSeconds(0);
                    setRecordedBlob(null);
                    setInterimText("");
                    setFullTranscript("");
                    if (recordedAudioUrl) {
                      URL.revokeObjectURL(recordedAudioUrl);
                      setRecordedAudioUrl(null);
                    }
                  }}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  <RotateCcw size={12} /> Re-record
                </button>
              </div>

              {recordedAudioUrl && (
                <audio
                  controls
                  src={recordedAudioUrl}
                  className="h-9 w-full rounded-lg"
                />
              )}

              {/* Live Recognized Speech preview & edit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <Radio size={12} /> {fullTranscript ? "Live Recognized Transcript (edit if needed):" : "Live Speech Transcript:"}
                  </span>
                  {fullTranscript && (
                    <span className="font-normal text-[10px] text-zinc-400">
                      Captured live · editable
                    </span>
                  )}
                </div>
                <textarea
                  value={fullTranscript}
                  onChange={(e) => setFullTranscript(e.target.value)}
                  rows={3}
                  placeholder="No speech recognized live. Gemini 3.5 will transcribe the recorded audio when submitted."
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 text-xs text-zinc-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Upload Recording Submode */
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileSelected(file);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,.webm,.flac,.aac,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
            }}
          />

          {uploadFile ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
                <FileAudio size={24} />
                <span className="font-semibold text-sm">{uploadFile.name}</span>
                <span className="text-xs text-zinc-400">
                  ({formatBytes(uploadFile.size)})
                </span>
              </div>
              {uploadAudioUrl && (
                <div onClick={(e) => e.stopPropagation()} className="pt-2">
                  <audio controls src={uploadAudioUrl} className="mx-auto h-9 w-full max-w-md" />
                </div>
              )}
              <p className="text-[11px] text-zinc-500">Click or drop another file to change</p>
            </div>
          ) : (
            <div className="space-y-1">
              <FileAudio size={32} className="mx-auto text-zinc-400" />
              <p className="font-medium text-xs text-zinc-700 dark:text-zinc-300">
                Drag and drop audio file, or click to browse
              </p>
              <p className="text-[11px] text-zinc-400">
                Supports MP3, WAV, M4A, AAC, FLAC, OGG, WebM
              </p>
            </div>
          )}
        </div>
      )}

      {/* Document Details: Title & Tags placed neatly below recording card */}
      <div className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
          placeholder="Title (optional — Gemini will auto-generate one if empty)"
          aria-label="Document Title"
        />
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={inputCls}
          placeholder="Tags (comma-separated, e.g. meeting, standup, chemistry)"
          aria-label="Tags"
        />
      </div>

      <ErrorBox message={error} />

      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || (subMode === "record" ? !recordedBlob : !uploadFile)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>{statusMessage || "Transcribing with Gemini 3.5 Transcribe & extracting notes..."}</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>✨ Transcribe & Generate AI Notes</span>
            </>
          )}
        </button>

        {subMode === "record" && recordingState === "recorded" && fullTranscript.trim() && (
          <button
            type="button"
            onClick={handleSaveDirectTranscript}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white py-2.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <FileText size={14} />
            <span>📝 Save Live Transcript Directly</span>
          </button>
        )}
      </div>
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

const PRESET_FEEDS = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Hacker News Top", url: "https://news.ycombinator.com/rss" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
];

function RssTab({ onSaved }: { onSaved: (id: string) => void }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);
  const [importingItemId, setImportingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (feedId?: string | null) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listFeeds({ feedId: feedId || undefined });
      setFeeds(data.feeds);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feeds");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(selectedFeedId);
  }, [selectedFeedId]);

  const handleSubscribe = async (feedUrlToSub?: string) => {
    const target = (feedUrlToSub || urlInput).trim();
    if (!target) return;
    try {
      setSubscribing(true);
      setError(null);
      const res = await api.subscribeFeed(target);
      setUrlInput("");
      setSelectedFeedId(res.feed.id);
      await loadData(res.feed.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to subscribe to feed");
    } finally {
      setSubscribing(false);
    }
  };

  const handleRefresh = async (feedId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      setRefreshingFeedId(feedId);
      setError(null);
      await api.refreshFeed(feedId);
      await loadData(selectedFeedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh feed");
    } finally {
      setRefreshingFeedId(null);
    }
  };

  const handleDelete = async (feedId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm("Remove this feed and its articles?")) return;
    try {
      setError(null);
      await api.deleteFeed(feedId);
      if (selectedFeedId === feedId) {
        setSelectedFeedId(null);
        await loadData(null);
      } else {
        await loadData(selectedFeedId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete feed");
    }
  };

  const handleImportAndListen = async (item: FeedItem) => {
    try {
      setImportingItemId(item.id);
      setError(null);
      const doc = await api.importFeedItem(item.id);
      onSaved(doc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import article");
      setImportingItemId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick subscribe form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubscribe();
        }}
        className="flex gap-2"
      >
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste RSS, Atom, or Substack URL (e.g. https://.../feed)"
          className={inputCls}
          disabled={subscribing}
        />
        <button
          type="submit"
          disabled={subscribing || !urlInput.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          {subscribing ? <Loader2 size={16} className="animate-spin" /> : <Rss size={16} />}
          Subscribe
        </button>
      </form>

      {/* Preset suggestions pill row */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Presets:</span>
        {PRESET_FEEDS.map((preset) => {
          const isSubscribed = feeds.some((f) => f.url === preset.url);
          return (
            <button
              key={preset.name}
              type="button"
              onClick={() => {
                const existing = feeds.find((f) => f.url === preset.url);
                if (existing) {
                  setSelectedFeedId(existing.id);
                } else {
                  void handleSubscribe(preset.url);
                }
              }}
              disabled={subscribing}
              className={`rounded-full border px-2.5 py-1 transition-colors ${
                isSubscribed
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {isSubscribed ? "✓ " : "+ "}
              {preset.name}
            </button>
          );
        })}
      </div>

      <ErrorBox message={error} />

      {/* Subscribed feeds horizontal pills */}
      {feeds.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            type="button"
            onClick={() => setSelectedFeedId(null)}
            className={`rounded-lg px-2.5 py-1.5 font-medium whitespace-nowrap transition-colors ${
              selectedFeedId === null
                ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            All Feeds
          </button>
          {feeds.map((feed) => {
            const isSelected = selectedFeedId === feed.id;
            const isRefreshing = refreshingFeedId === feed.id;
            return (
              <div
                key={feed.id}
                onClick={() => setSelectedFeedId(feed.id)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                <span>{feed.title}</span>
                {feed.unreadCount !== undefined && feed.unreadCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                      isSelected
                        ? "bg-emerald-700 text-white dark:bg-emerald-600"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    }`}
                  >
                    {feed.unreadCount}
                  </span>
                )}
                <button
                  type="button"
                  title="Refresh feed"
                  disabled={isRefreshing}
                  onClick={(e) => void handleRefresh(feed.id, e)}
                  className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                </button>
                <button
                  type="button"
                  title="Delete feed"
                  onClick={(e) => void handleDelete(feed.id, e)}
                  className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Feed items list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {loading
              ? "Loading articles…"
              : items.length === 0
              ? "No feed items found"
              : `Showing ${items.length} article${items.length === 1 ? "" : "s"}`}
          </span>
          {selectedFeedId && (
            <button
              type="button"
              onClick={() => void handleRefresh(selectedFeedId)}
              disabled={refreshingFeedId === selectedFeedId}
              className="flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <RefreshCw
                size={12}
                className={refreshingFeedId === selectedFeedId ? "animate-spin" : ""}
              />
              Refresh Feed
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="animate-spin text-zinc-400" size={24} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <Rss size={32} className="mb-2 text-zinc-400 opacity-60" />
            <p className="font-medium">No feeds subscribed yet</p>
            <p className="mt-1 text-xs">
              Subscribe to an RSS or newsletter feed above or click one of the presets to get started!
            </p>
          </div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {items.map((item) => {
              const isImporting = importingItemId === item.id;
              const dateStr = item.publishedAt
                ? new Date(item.publishedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "";
              return (
                <div
                  key={item.id}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${
                    item.isRead
                      ? "border-zinc-200/60 bg-zinc-50/50 opacity-80 dark:border-zinc-800/60 dark:bg-zinc-900/40"
                      : "border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {item.feedTitle && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {item.feedTitle}
                        </span>
                      )}
                      {dateStr && <span>{dateStr}</span>}
                      {item.author && <span>· by {item.author}</span>}
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1 text-sm font-medium text-zinc-900 hover:text-emerald-600 dark:text-zinc-100 dark:hover:text-emerald-400"
                    >
                      <span className="line-clamp-2">{item.title}</span>
                      <ExternalLink size={12} className="shrink-0 opacity-0 group-hover:opacity-100" />
                    </a>
                    {item.summary && (
                      <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {item.summary}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 pt-1">
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={() => void handleImportAndListen(item)}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                    >
                      {isImporting ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Headphones size={13} />
                      )}
                      <span>🎧 Import & Listen</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
    <Modal title="Import to VoxShelf" onClose={onClose} wide>
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
      {tab === "audio" && <AudioTab onSaved={onSaved} />}
      {tab === "upload" && <UploadTab onSaved={onSaved} />}
      {tab === "scan" && <ScanTab onSaved={onSaved} />}
      {tab === "rss" && <RssTab onSaved={onSaved} />}
      {tab === "gdocs" && <UrlTab kind="gdocs" onSaved={onSaved} />}
      {tab === "article" && <UrlTab kind="article" onSaved={onSaved} />}
      {tab === "paste" && <PasteTab onSaved={onSaved} />}
    </Modal>
  );
}
