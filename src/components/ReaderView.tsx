"use client";

import {
  ArrowLeft,
  BookmarkPlus,
  FastForward,
  Focus,
  Highlighter,
  Keyboard,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  StickyNote,
  Timer,
  TriangleAlert,
  Type,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlayer } from "@/hooks/usePlayer";
import { api, formatBytes } from "@/lib/client";
import { getSharedAudio } from "@/lib/globalPlayer";
import {
  getOfflineDocument,
  isDocumentOnDevice,
  removeDocumentFromDevice,
} from "@/lib/offlineStore";
import { applyAutoSkip, loadAutoSkip, saveAutoSkip, type AutoSkipOptions } from "@/lib/autoSkip";
import { publishNowPlaying } from "@/lib/globalPlayer";
import { haptic } from "@/lib/haptics";
import { estimateTtsCostUsd, formatUsd } from "@/lib/pricing";
import {
  countWords,
  cumulativeWordCounts,
  estimateSecondsLeft,
  formatDuration,
  formatTimeLeftBadge,
  wordsRemainingFrom,
} from "@/lib/readingTime";
import {
  emitVolumeChange,
  loadMuted,
  loadVolume,
  saveMuted,
  saveVolume,
} from "@/lib/volume";
import type {
  Bookmark,
  DocumentDetail,
  Highlight,
  HighlightColor,
  PrerenderStats,
  ReaderPrefs,
  Sentence,
  SentenceDialogueTag,
} from "@/lib/types";
import { AIDrawer, type TextSelection } from "./AIDrawer";
import { DialogueCastModal } from "./DialogueCastModal";
import { DownloadToDeviceModal } from "./DownloadToDeviceModal";
import { TOCDrawer } from "./TOCDrawer";
import { PrerenderModal } from "./PrerenderModal";
import { PronunciationModal } from "./PronunciationModal";
import {
  AppearanceMenu,
  DEFAULT_APPEARANCE,
  appearanceFontClass,
  loadAppearance,
  pageWidthClass,
  saveAppearance,
  type AppearancePrefs,
} from "./AppearanceMenu";
import { useUI } from "./AppShell";
import { AutoSkipModal } from "./AutoSkipModal";
import { PlayerBar } from "./PlayerBar";
import { useToast } from "./Toast";

const PREFS_KEY = "vs-reader-prefs";
const LEGACY_PREFS_KEY = "vf-reader-prefs";

const DEFAULT_PREFS: ReaderPrefs = {
  font: "sans",
  fontSize: 18,
  lineHeight: 1.8,
  rulerMode: false,
  bionicReading: false,
  focusMask: false,
  pageWidth: "comfortable",
};

const HIGHLIGHT_SWATCHES: { id: HighlightColor; swatch: string }[] = [
  { id: "yellow", swatch: "#facc15" },
  { id: "blue", swatch: "#38bdf8" },
  { id: "green", swatch: "#34d399" },
  { id: "purple", swatch: "#a78bfa" },
  { id: "pink", swatch: "#fb7185" },
];

function loadPrefs(): ReaderPrefs {
  try {
    const raw =
      localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      font: "sans",
      fontSize:
        typeof parsed.fontSize === "number"
          ? Math.min(30, Math.max(14, parsed.fontSize))
          : 18,
      lineHeight:
        typeof parsed.lineHeight === "number"
          ? Math.min(2.6, Math.max(1.3, parsed.lineHeight))
          : 1.8,
      rulerMode: parsed.rulerMode === true,
      bionicReading: parsed.bionicReading === true,
      focusMask: parsed.focusMask === true,
      pageWidth:
        parsed.pageWidth === "narrow" ||
        parsed.pageWidth === "comfortable" ||
        parsed.pageWidth === "wide"
          ? parsed.pageWidth
          : "comfortable",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Split a word into prefix symbols, bold bionic head, tail, and suffix symbols. */
function bionicParts(token: string): { prefix: string; head: string; tail: string; suffix: string } {
  const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’-]+)(.*)$/u);
  if (!match) {
    const half = Math.ceil(token.length / 2);
    return { prefix: "", head: token.slice(0, half), tail: token.slice(half), suffix: "" };
  }
  const prefix = match[1] || "";
  const core = match[2] || "";
  const suffix = match[3] || "";

  if (core.length <= 1) {
    return { prefix, head: core, tail: "", suffix };
  }

  // True bionic reading fixation ratios:
  // 1-3 letters -> 1 letter bold
  // 4-6 letters -> 2 letters bold
  // 7-9 letters -> 3 letters bold
  // 10+ letters -> 4-5 letters bold
  let n = 1;
  if (core.length <= 3) n = 1;
  else if (core.length <= 6) n = 2;
  else if (core.length <= 9) n = 3;
  else n = Math.min(5, Math.ceil(core.length * 0.45));

  return {
    prefix,
    head: core.slice(0, n),
    tail: core.slice(n),
    suffix,
  };
}

function BionicWord({ word }: { word: string }) {
  const { prefix, head, tail, suffix } = bionicParts(word);
  return (
    <span className="inline">
      {prefix}
      <b className="font-extrabold text-zinc-950 dark:text-white" style={{ fontWeight: 800 }}>
        {head}
      </b>
      {tail && <span className="font-normal opacity-85 dark:opacity-80">{tail}</span>}
      {suffix}
    </span>
  );
}

/** Render a text chunk word-by-word, with optional bionic heads. */
function TextChunk({ text, bionic }: { text: string; bionic: boolean }) {
  if (!bionic) return <>{text}</>;
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) =>
        p === "" || /^\s+$/.test(p) ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i}>
            <BionicWord word={p} />
          </span>
        ),
      )}
    </>
  );
}

function WordSpans({
  text,
  activeWord,
  bionic,
}: {
  text: string;
  activeWord: number;
  bionic: boolean;
}) {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(\s+)/);
  let w = -1;
  parts.forEach((part, i) => {
    if (part === "" || /^\s+$/.test(part)) {
      nodes.push(<span key={i}>{part}</span>);
    } else {
      w += 1;
      const mine = w;
      nodes.push(
        <span
          key={i}
          className={`vf-word${mine === activeWord ? " vf-word-active" : ""}`}
        >
          {bionic ? <BionicWord word={part} /> : part}
        </span>,
      );
    }
  });
  return <>{nodes}</>;
}

/** Render sentence text with user highlight <mark> ranges applied. */
function HighlightedText({
  text,
  highlights,
  bionic,
}: {
  text: string;
  highlights: Highlight[];
  bionic: boolean;
}) {
  if (highlights.length === 0) return <TextChunk text={text} bionic={bionic} />;
  type Range = { start: number; end: number; color: HighlightColor; id: string };
  const ranges: Range[] = [];
  for (const h of highlights) {
    if (!h.text) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(h.text, from);
      if (at === -1) break;
      ranges.push({ start: at, end: at + h.text.length, color: h.color, id: h.id });
      from = at + 1;
      break; // one mark per highlight keeps overlapping notes readable
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) continue; // skip overlaps
    merged.push(r);
  }
  if (merged.length === 0) return <TextChunk text={text} bionic={bionic} />;
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach((r, i) => {
    if (r.start > pos)
      nodes.push(
        <span key={`t${i}`}>
          <TextChunk text={text.slice(pos, r.start)} bionic={bionic} />
        </span>,
      );
    nodes.push(
      <mark key={r.id} className={`vf-hl vf-hl-${r.color}`}>
        <TextChunk text={text.slice(r.start, r.end)} bionic={bionic} />
      </mark>,
    );
    pos = r.end;
  });
  if (pos < text.length)
    nodes.push(
      <span key="tail">
        <TextChunk text={text.slice(pos)} bionic={bionic} />
      </span>,
    );
  return <>{nodes}</>;
}

const SentenceItem = memo(function SentenceItem({
  sentence,
  displayText,
  active,
  near,
  loading,
  activeWord,
  skipped,
  clickable,
  highlights,
  bionic,
  dimmed,
  dialogueTag,
  onPlay,
}: {
  sentence: Sentence;
  displayText: string;
  active: boolean;
  near: boolean;
  loading: boolean;
  activeWord: number;
  skipped: boolean;
  clickable: boolean;
  highlights: Highlight[];
  bionic: boolean;
  dimmed: boolean;
  dialogueTag?: SentenceDialogueTag | null;
  onPlay: (idx: number) => void;
}) {
  return (
    <p
      data-idx={sentence.idx}
      onClick={clickable ? () => onPlay(sentence.idx) : undefined}
      className={`vf-sentence${active ? " vf-sentence-active" : ""}${near ? " vf-sentence-near" : ""}${skipped ? " vf-sentence-skipped" : ""}${dimmed && !active ? " opacity-30" : ""}${dimmed ? " transition-opacity" : ""}`}
      style={clickable ? undefined : { cursor: "default" }}
      title={skipped ? "Skipped by auto-skip" : clickable ? "Click to play from here" : undefined}
    >
      {dialogueTag && (
        <span
          className={`mr-1.5 inline-flex select-none items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide align-baseline ${
            dialogueTag.isDialogue
              ? "border border-purple-200/70 bg-purple-100 text-purple-800 dark:border-purple-800/60 dark:bg-purple-950/80 dark:text-purple-300"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
          title={`Speaker: ${dialogueTag.character} (Voice: ${dialogueTag.voice})`}
        >
          <span role="img" aria-hidden="true" className="text-[10px]">
            {dialogueTag.isDialogue ? "🎭" : "📖"}
          </span>
          {dialogueTag.character}:
        </span>
      )}
      {active ? (
        <WordSpans text={displayText} activeWord={activeWord} bionic={bionic} />
      ) : (
        <HighlightedText text={sentence.text} highlights={highlights} bionic={bionic} />
      )}
      {loading && (
        <Loader2 size={14} className="ml-2 inline animate-spin text-emerald-600" />
      )}
    </p>
  );
});

function formatSleepCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Segmented timeline: sentence density ticks, hover preview, click to jump. */
function TimelineScrubber({
  doc,
  currentIdx,
  clipProgress,
  speed,
  cum,
  onJump,
}: {
  doc: DocumentDetail;
  currentIdx: number;
  clipProgress: number;
  speed: number;
  cum: number[];
  onJump: (idx: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const total = doc.sentences.length;
  const overall =
    total <= 1
      ? 0
      : Math.min(100, ((currentIdx + clipProgress) / (total - 1)) * 100);

  const ticks = useMemo(() => {
    if (total <= 1) return [];
    const step = Math.max(1, Math.floor(total / 120));
    const out: number[] = [];
    for (let i = 0; i < total; i += step) out.push(i);
    return out;
  }, [total]);

  const idxFromClientX = useCallback(
    (clientX: number): number => {
      const el = barRef.current;
      if (!el || total === 0) return 0;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.min(total - 1, Math.floor(frac * total));
    },
    [total],
  );

  const hoverLeft =
    hoverIdx === null || total <= 1 ? 0 : (hoverIdx / (total - 1)) * 100;
  const hoverSentence = hoverIdx !== null ? doc.sentences[hoverIdx] : undefined;
  const hoverWords =
    hoverIdx === null ? 0 : wordsRemainingFrom(cum, hoverIdx, 0);

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label="Document timeline"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={currentIdx + 1}
      aria-valuetext={`Sentence ${currentIdx + 1} of ${total}`}
      className="group relative mb-4 h-7 cursor-pointer outline-none"
      onMouseMove={(e) => setHoverIdx(idxFromClientX(e.clientX))}
      onMouseLeave={() => setHoverIdx(null)}
      onClick={(e) => {
        haptic();
        onJump(idxFromClientX(e.clientX));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onJump(Math.max(0, currentIdx - 1));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onJump(Math.min(total - 1, currentIdx + 1));
        }
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-visible rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${overall}%` }}
        />
      </div>
      {ticks.map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-zinc-500/50 dark:bg-zinc-400/40"
          style={{ left: total <= 1 ? "0%" : `${(i / (total - 1)) * 100}%` }}
        />
      ))}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-600 bg-white shadow dark:border-emerald-400 dark:bg-zinc-900"
        style={{ left: `${overall}%` }}
      />
      {hoverIdx !== null && hoverSentence && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full z-10 mb-1 w-64 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: `${Math.min(88, Math.max(12, hoverLeft))}%` }}
        >
          <p className="text-[11px] font-semibold tabular-nums">
            Sentence {hoverIdx + 1} / {total}
            <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">
              {hoverWords > 0
                ? `${formatDuration(estimateSecondsLeft(hoverWords, speed))} left`
                : "End"}
            </span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
            {hoverSentence.text.slice(0, 140)}
          </p>
        </div>
      )}
    </div>
  );
}

function computeWordIndex(text: string, charOffset: number): number {
  if (charOffset <= 0) return 0;
  const clampedOffset = Math.min(text.length, Math.max(0, charOffset));
  const parts = text.split(/(\s+)/);
  let currentPos = 0;
  let wordIdx = -1;
  let lastWordIdx = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isWord = part !== "" && !/^\s+$/.test(part);
    const nextPos = currentPos + part.length;
    if (isWord) {
      wordIdx++;
      lastWordIdx = wordIdx;
    }
    if (clampedOffset >= currentPos && clampedOffset < nextPos) {
      return lastWordIdx;
    }
    currentPos = nextPos;
  }
  return lastWordIdx;
}

function formatAudioClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const ORIG_SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function OriginalAudioPlayerBar({
  doc,
  isPlaying,
  currentTime,
  duration,
  speed,
  volume,
  muted,
  onTogglePlay,
  onSeek,
  onSkip,
  onSpeedChange,
  onToggleMute,
  onSwitchToGemini,
  onOpenNotes,
}: {
  doc: DocumentDetail;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  volume: number;
  muted: boolean;
  onTogglePlay: () => void;
  onSeek: (val: number) => void;
  onSkip: (secs: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleMute: () => void;
  onSwitchToGemini: () => void;
  onOpenNotes: () => void;
}) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-4 py-2.5 shadow-2xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        {/* Scrubber Progress Bar */}
        <div className="flex items-center gap-2">
          <span className="w-10 text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {formatAudioClock(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-emerald-600 dark:accent-emerald-400"
            aria-label="Seek original audio"
          />
          <span className="w-10 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {formatAudioClock(duration)}
          </span>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between">
          {/* Left: Mode Badge & Switcher */}
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <Mic size={12} /> Original Audio
            </span>
            <button
              onClick={onSwitchToGemini}
              className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Switch to Gemini AI Voice narration"
            >
              <Sparkles size={12} className="text-emerald-600 dark:text-emerald-400" />
              <span>Gemini Voice</span>
            </button>
          </div>

          {/* Center: Skip & Play/Pause */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => onSkip(-15)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-0.5 rounded-lg text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
              title="Skip back 15 seconds"
              aria-label="Skip back 15 seconds"
            >
              <RotateCcw size={17} />
              <span className="text-[10px] font-bold">15</span>
            </button>

            <button
              onClick={onTogglePlay}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700 active:scale-95 dark:bg-emerald-500 dark:text-zinc-950"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
            </button>

            <button
              onClick={() => onSkip(15)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-0.5 rounded-lg text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
              title="Skip forward 15 seconds"
              aria-label="Skip forward 15 seconds"
            >
              <span className="text-[10px] font-bold">15</span>
              <RotateCw size={17} />
            </button>
          </div>

          {/* Right: Speed, Volume, Notes */}
          <div className="flex items-center gap-2">
            {/* Speed Selector */}
            <div className="flex items-center rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
              <select
                value={speed}
                onChange={(e) => onSpeedChange(Number(e.target.value))}
                className="bg-transparent px-1.5 py-0.5 text-xs font-semibold text-zinc-700 outline-none dark:text-zinc-300"
                aria-label="Playback speed"
              >
                {ORIG_SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s} className="dark:bg-zinc-900">
                    {s}×
                  </option>
                ))}
              </select>
            </div>

            {/* Volume Toggle */}
            <button
              onClick={onToggleMute}
              className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>

            {/* Notes Button */}
            <button
              onClick={onOpenNotes}
              className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900"
              title="View Structured Notes"
            >
              <StickyNote size={13} />
              <span className="hidden sm:inline">Notes</span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

type AiTab = "notes" | "summary" | "explain" | "chat" | "quiz" | "cards" | "podcast" | "bookmarks" | "highlights";

export function ReaderView({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [appearance, setAppearance] = useState<AppearancePrefs>(() =>
    typeof window === "undefined" ? { ...DEFAULT_APPEARANCE } : loadAppearance(),
  );
  const [autoSkip, setAutoSkip] = useState<AutoSkipOptions>(() =>
    typeof window === "undefined"
      ? { enabled: false, mode: "ai", skipHeaders: true, skipFooters: true, skipFootnotes: true, skipTables: true, skipFormulas: true, skipCitations: true, skipUrls: true, skipParentheses: false, skipBrackets: false, skipBraces: false }
      : loadAutoSkip(),
  );
  const [showAppearance, setShowAppearance] = useState(false);
  const [showAutoSkip, setShowAutoSkip] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<AiTab>("summary");
  const [tocOpen, setTocOpen] = useState(false);
  const [castOpen, setCastOpen] = useState(false);

  const hasOriginalAudio = Boolean(doc?.originalAudioUrl);
  const [playbackSource, setPlaybackSource] = useState<"original" | "gemini">("original");

  // Original Audio state
  const origAudioRef = useRef<HTMLAudioElement | null>(null);
  const [origIsPlaying, setOrigIsPlaying] = useState(false);
  const [origCurrentTime, setOrigCurrentTime] = useState(0);
  const [origDuration, setOrigDuration] = useState(0);
  const [origSpeed, setOrigSpeed] = useState(1);
  const [origVolume, setOrigVolume] = useState(() => loadVolume());
  const [origMuted, setOrigMuted] = useState(() => loadMuted());

  useEffect(() => {
    if (doc?.originalAudioUrl) {
      setPlaybackSource("original");
    } else {
      setPlaybackSource("gemini");
    }
  }, [doc?.id, doc?.originalAudioUrl]);

  useEffect(() => {
    const audio = origAudioRef.current;
    if (!audio) return;
    audio.playbackRate = origSpeed;
  }, [origSpeed]);

  useEffect(() => {
    const audio = origAudioRef.current;
    if (!audio) return;
    audio.volume = origMuted ? 0 : origVolume;
  }, [origVolume, origMuted]);

  const playOriginal = useCallback((seekTime?: number) => {
    const audio = origAudioRef.current;
    if (!audio) return;
    if (typeof seekTime === "number" && Number.isFinite(seekTime)) {
      audio.currentTime = seekTime;
      setOrigCurrentTime(seekTime);
    }
    audio.play().catch(() => {});
  }, []);

  const pauseOriginal = useCallback(() => {
    const audio = origAudioRef.current;
    if (!audio) return;
    audio.pause();
  }, []);

  const toggleOriginal = useCallback(() => {
    const audio = origAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const seekOriginal = useCallback(
    (time: number) => {
      const audio = origAudioRef.current;
      if (!audio) return;
      const dur = origDuration || audio.duration || 0;
      const clamped = Math.max(0, Math.min(dur, time));
      audio.currentTime = clamped;
      setOrigCurrentTime(clamped);
    },
    [origDuration],
  );

  const skipOriginal = useCallback(
    (secs: number) => {
      const audio = origAudioRef.current;
      if (!audio) return;
      const dur = origDuration || audio.duration || 0;
      const clamped = Math.max(0, Math.min(dur, audio.currentTime + secs));
      audio.currentTime = clamped;
      setOrigCurrentTime(clamped);
    },
    [origDuration],
  );

  const setOrigAudioSpeed = useCallback((s: number) => {
    const clamped = Math.max(0.5, Math.min(3.0, Math.round(s * 100) / 100));
    setOrigSpeed(clamped);
  }, []);

  const toggleOrigMute = useCallback(() => {
    setOrigMuted((m) => {
      const next = !m;
      saveMuted(next);
      return next;
    });
  }, []);

  const jumpToSentenceOriginal = useCallback(
    (sentenceIdx: number) => {
      if (!doc || !doc.sentences[sentenceIdx]) return;
      const totalChars = Math.max(
        1,
        doc.totalChars || doc.sentences[doc.sentences.length - 1]?.charEnd || 1,
      );
      const s = doc.sentences[sentenceIdx];
      const dur = origDuration || origAudioRef.current?.duration || 0;
      const targetTime = s && dur > 0 ? (s.charStart / totalChars) * dur : 0;
      seekOriginal(targetTime);
    },
    [doc, origDuration, seekOriginal],
  );

  function openAi(tab: AiTab = "summary") {
    setAiTab(tab);
    setAiOpen(true);
  }
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [selAnchor, setSelAnchor] = useState<{ sentenceIdx: number; x: number; y: number } | null>(null);
  const [hlNote, setHlNote] = useState("");
  const [hlNoteOpen, setHlNoteOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [prerenderOpen, setPrerenderOpen] = useState(false);
  const [prerenderStats, setPrerenderStats] = useState<PrerenderStats | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [pronOpen, setPronOpen] = useState(false);
  const [selectedPronWord, setSelectedPronWord] = useState<string | undefined>(undefined);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const initialProgressRef = useRef<number | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [onDevice, setOnDevice] = useState<{
    onDevice: boolean;
    bytes: number;
    downloadedAt?: string;
  } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const { openShortcuts, shortcutsOpen } = useUI();
  const toast = useToast();
  // Timestamp until which auto-scroll stays paused after manual interaction.
  const autoScrollHoldUntil = useRef(0);
  const resumeAutoScroll = useCallback(() => {
    autoScrollHoldUntil.current = 0;
  }, []);

  useEffect(() => {
    setPrefs(loadPrefs());
    setAppearance(loadAppearance());
    setAutoSkip(loadAutoSkip());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  useEffect(() => {
    saveAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    saveAutoSkip(autoSkip);
  }, [autoSkip]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(null);
    setOfflineMode(false);
    setResumeDismissed(false);
    initialProgressRef.current = null;
    api
      .getDocument(docId)
      .then((d) => {
        if (!live) return;
        initialProgressRef.current = d.progressSentenceIndex;
        setDoc(d);
        setBookmarks(d.bookmarks);
        setHighlights(d.highlights || []);
        setLoading(false);
      })
      .catch(async (e) => {
        // Server unreachable: fall back to the on-device copy, if any.
        try {
          const offline = await getOfflineDocument(docId);
          if (offline && live) {
            setDoc(offline);
            setBookmarks(offline.bookmarks);
            setHighlights(offline.highlights || []);
            setOfflineMode(true);
            setLoading(false);
            return;
          }
        } catch {
          // Ignore and report the original load failure below.
        }
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load document.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [docId]);

  const refreshOnDevice = useCallback(() => {
    isDocumentOnDevice(docId)
      .then(setOnDevice)
      .catch(() => {});
  }, [docId]);

  useEffect(() => {
    refreshOnDevice();
  }, [refreshOnDevice]);

  const handleDeviceButton = useCallback(() => {
    if (onDevice?.onDevice) {
      if (
        !confirm(
          "Remove this book from device storage? You can re-download it anytime.",
        )
      ) {
        return;
      }
      removeDocumentFromDevice(docId)
        .then(() => refreshOnDevice())
        .catch((e) =>
          toast.error(e instanceof Error ? e.message : "Could not remove download."),
        );
    } else {
      setDownloadOpen(true);
    }
  }, [onDevice, docId, refreshOnDevice, toast]);

  const refreshPrerenderStats = useCallback(() => {
    api.getPrerenderStats(docId).then(setPrerenderStats).catch(() => {});
  }, [docId]);

  useEffect(() => {
    refreshPrerenderStats();
  }, [refreshPrerenderStats]);

  const persistProgress = useCallback(
    (sentenceIdx: number, charOffset: number) => {
      api
        .updateDocument(docId, {
          progressSentenceIndex: sentenceIdx,
          progressCharOffset: charOffset,
        })
        .catch(() => {});
      setDoc((d) =>
        d
          ? {
              ...d,
              progressSentenceIndex: sentenceIdx,
              progressCharOffset: charOffset,
            }
          : d,
      );
    },
    [docId],
  );

  const filterSentence = useCallback(
    (text: string) => {
      const out = applyAutoSkip(text, autoSkip);
      return { text: out.text, shouldSkip: out.shouldSkipSentence };
    },
    [autoSkip],
  );

  const dialogueTagsBySentence = useMemo(() => {
    const map = new Map<number, SentenceDialogueTag>();
    if (!doc?.dialogueActing || doc.dialogueActing.enabled === false) return map;
    for (const tag of doc.dialogueActing.tags || []) {
      map.set(tag.sentenceIdx, tag);
    }
    return map;
  }, [doc?.dialogueActing]);

  const player = usePlayer(doc, { onProgress: persistProgress, filterSentence });

  // Compute synchronized karaoke active sentence index
  const activeSentenceIdx = useMemo(() => {
    if (!doc || doc.sentences.length === 0) return 0;
    if (playbackSource === "gemini") {
      return player.currentIdx;
    }
    const totalChars = Math.max(
      1,
      doc.totalChars || doc.sentences[doc.sentences.length - 1]?.charEnd || 1,
    );
    const dur = origDuration || origAudioRef.current?.duration || 1;
    const targetChar = (origCurrentTime / Math.max(1, dur)) * totalChars;

    for (let i = 0; i < doc.sentences.length; i++) {
      const s = doc.sentences[i];
      const nextStart = doc.sentences[i + 1]?.charStart ?? s.charEnd + 999999;
      if (targetChar >= s.charStart && targetChar < nextStart) {
        return s.idx;
      }
    }

    return 0;
  }, [doc, playbackSource, player.currentIdx, origCurrentTime, origDuration]);

  // Compute synchronized karaoke active word index
  const activeWordIdx = useMemo(() => {
    if (playbackSource === "gemini") {
      return player.currentWord;
    }
    if (!doc || !doc.sentences[activeSentenceIdx]) return -1;
    const s = doc.sentences[activeSentenceIdx];
    const totalChars = Math.max(
      1,
      doc.totalChars || doc.sentences[doc.sentences.length - 1]?.charEnd || 1,
    );
    const dur = origDuration || origAudioRef.current?.duration || 1;
    const targetChar = (origCurrentTime / Math.max(1, dur)) * totalChars;
    const offset = targetChar - s.charStart;
    return computeWordIndex(s.text, offset);
  }, [playbackSource, player.currentWord, doc, activeSentenceIdx, origCurrentTime, origDuration]);

  // Mode switching
  const switchToGemini = useCallback(() => {
    pauseOriginal();
    setPlaybackSource("gemini");
    haptic();
    player.playFrom(activeSentenceIdx);
  }, [pauseOriginal, player, activeSentenceIdx]);

  const switchToOriginal = useCallback(() => {
    if (player.status === "playing") player.pause();
    setPlaybackSource("original");
    haptic();
    if (!doc) return;
    const totalChars = Math.max(
      1,
      doc.totalChars || doc.sentences[doc.sentences.length - 1]?.charEnd || 1,
    );
    const s = doc.sentences[player.currentIdx];
    const dur = origDuration || origAudioRef.current?.duration || 0;
    const targetTime = s && dur > 0 ? (s.charStart / totalChars) * dur : 0;
    playOriginal(targetTime);
  }, [player, doc, origDuration, playOriginal]);

  const handlePlay = useCallback(
    (idx: number) => {
      if (!appearance.clickToListen || !doc) return;
      haptic();
      setResumeDismissed(true);
      resumeAutoScroll();
      if (playbackSource === "original") {
        const totalChars = Math.max(
          1,
          doc.totalChars || doc.sentences[doc.sentences.length - 1]?.charEnd || 1,
        );
        const s = doc.sentences[idx];
        const dur = origDuration || origAudioRef.current?.duration || 0;
        const targetTime = s && dur > 0 ? (s.charStart / totalChars) * dur : 0;
        playOriginal(targetTime);
      } else {
        player.playFrom(idx);
      }
    },
    [appearance.clickToListen, doc, playbackSource, origDuration, playOriginal, player, resumeAutoScroll],
  );

  // Publish now-playing metadata for the floating mini-player + lock screen.
  // clipProgress is quantized so background subscribers aren't spammed.
  const quantizedProgress = Math.round(player.clipProgress * 20) / 20;
  useEffect(() => {
    if (!doc) return;
    publishNowPlaying({
      docId: doc.id,
      title: doc.title,
      sentenceIdx: activeSentenceIdx,
      sentenceCount: doc.sentenceCount,
      snippet: (doc.sentences[activeSentenceIdx]?.text ?? "").slice(0, 80),
      speed: playbackSource === "original" ? origSpeed : player.speed,
      clipProgress: playbackSource === "original" ? 0 : quantizedProgress,
      status: playbackSource === "original" ? (origIsPlaying ? "playing" : "paused") : player.status,
    });
  }, [
    doc,
    activeSentenceIdx,
    playbackSource,
    origSpeed,
    origIsPlaying,
    player.speed,
    quantizedProgress,
    player.status,
  ]);

  // Periodic reading-session pings while audio is actually playing.
  const livePlayerRef = useRef({ idx: 0, speed: 1 });
  livePlayerRef.current = {
    idx: activeSentenceIdx,
    speed: playbackSource === "original" ? origSpeed : player.speed,
  };
  const sessionAnchorRef = useRef(0);
  const docTextsRef = useRef<string[]>([]);
  useEffect(() => {
    sessionAnchorRef.current = activeSentenceIdx;
    if (doc) docTextsRef.current = doc.sentences.map((s) => s.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  useEffect(() => {
    const isPlaying =
      playbackSource === "original" ? origIsPlaying : player.status === "playing";
    if (!doc || !isPlaying) return;
    const docId = doc.id;
    const iv = setInterval(() => {
      const { idx, speed } = livePlayerRef.current;
      const texts = docTextsRef.current;
      const from = Math.max(0, Math.min(sessionAnchorRef.current, idx));
      const to = Math.max(0, Math.min(idx, texts.length - 1));
      let words = 0;
      for (let i = from; i <= to; i += 1) words += countWords(texts[i] ?? "");
      if (words <= 0) words = Math.round(15 * 2.5 * speed);
      sessionAnchorRef.current = idx;
      api
        .recordSession({ docId, durationSeconds: 15, wordsRead: words, speed })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, [doc, playbackSource, origIsPlaying, player.status]);

  // Auto-play as soon as the file opens (optional).
  const autoPlayedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || !appearance.autoPlay) return;
    if (autoPlayedRef.current === doc.id) return;
    autoPlayedRef.current = doc.id;
    const t = setTimeout(() => {
      if (doc.originalAudioUrl && playbackSource === "original") {
        playOriginal();
      } else {
        player.play();
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.originalAudioUrl, appearance.autoPlay, playbackSource, playOriginal, player]);

  // Speakable (filtered) text per sentence for display + skip dimming.
  const speakMap = useMemo(() => {
    if (!doc) return new Map<number, { text: string; skipped: boolean }>();
    const m = new Map<number, { text: string; skipped: boolean }>();
    if (!autoSkip.enabled) return m;
    for (const s of doc.sentences) {
      const out = applyAutoSkip(s.text, autoSkip);
      m.set(s.idx, {
        text: out.text && out.text.trim() ? out.text : s.text,
        skipped: out.shouldSkipSentence,
      });
    }
    return m;
  }, [doc, autoSkip]);

  const highlightsBySentence = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) {
      const list = m.get(h.sentenceIdx) || [];
      list.push(h);
      m.set(h.sentenceIdx, list);
    }
    return m;
  }, [highlights]);

  // Persist voice/speed/style choice back to the document (debounced).
  useEffect(() => {
    if (!doc) return;
    const patch: Record<string, unknown> = {};
    if (Math.abs(player.speed - doc.speed) > 0.001) patch.speed = player.speed;
    if (player.voice !== doc.voice) patch.voice = player.voice;
    if ((player.stylePrompt || "") !== (doc.stylePrompt || "")) {
      patch.stylePrompt = player.stylePrompt;
    }
    if (Object.keys(patch).length === 0) return;
    const t = setTimeout(() => {
      api
        .updateDocument(doc.id, patch)
        .then((updated) =>
          setDoc((d) => (d ? { ...d, ...updated } : d)),
        )
        .catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [doc, player.speed, player.voice, player.stylePrompt]);

  // Auto-scroll the active sentence into view while playing — but never
  // fight the user: manual scrolls/touches pause auto-scroll for 4 seconds.
  const firstScroll = useRef(true);
  useEffect(() => {
    const hold = () => {
      autoScrollHoldUntil.current = Date.now() + 4000;
    };
    window.addEventListener("wheel", hold, { passive: true });
    window.addEventListener("touchstart", hold, { passive: true });
    return () => {
      window.removeEventListener("wheel", hold);
      window.removeEventListener("touchstart", hold);
    };
  }, []);
  useEffect(() => {
    if (!doc) return;
    if (Date.now() < autoScrollHoldUntil.current && !firstScroll.current) {
      return;
    }
    const isPlaying =
      playbackSource === "original"
        ? origIsPlaying
        : player.status === "playing" || player.status === "loading";
    if (!isPlaying && !firstScroll.current) {
      return;
    }
    const el = articleRef.current?.querySelector(
      `[data-idx="${activeSentenceIdx}"]`,
    );
    if (el) {
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollIntoView({
        behavior: reduced || firstScroll.current ? "auto" : "smooth",
        block: "center",
      });
    }
    firstScroll.current = false;
  }, [doc, activeSentenceIdx, origIsPlaying, player.status, playbackSource]);

  // Background tab resync & mobile lockscreen wakeup: when the tab/screen
  // becomes visible again mid-playback, re-sync the audio cursor state and
  // smoothly scroll the active sentence back into center view so the visual
  // state never lags behind the audio.
  const liveResyncRef = useRef({ idx: 0, status: player.status, resync: player.resync });
  liveResyncRef.current = { idx: activeSentenceIdx, status: player.status, resync: player.resync };
  useEffect(() => {
    const wake = () => {
      const live = liveResyncRef.current;
      const isPlaying =
        playbackSource === "original"
          ? origIsPlaying
          : live.status === "playing" || live.status === "loading";
      if (!isPlaying) return;
      if (playbackSource === "gemini") {
        live.resync();
      }
      // A backgrounded tab held no manual-scroll intent; clear the hold so
      // the wake-up scroll always lands on the live sentence.
      autoScrollHoldUntil.current = 0;
      const el = articleRef.current?.querySelector(`[data-idx="${live.idx}"]`);
      if (el) {
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSource, origIsPlaying]);

  const updateSelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || "";
    if (!sel || text.length < 2 || text.length > 2000) {
      if (text.length === 0) {
        setSelection(null);
        setSelAnchor(null);
        setHlNoteOpen(false);
      }
      return;
    }
    let context = "";
    let anchorIdx = 0;
    try {
      const node = sel.anchorNode;
      const el =
        node instanceof Element
          ? node.closest("[data-idx]")
          : node?.parentElement?.closest("[data-idx]") ?? null;
      const idx = el ? Number(el.getAttribute("data-idx")) : NaN;
      if (Number.isFinite(idx) && doc) {
        anchorIdx = idx;
        context = [
          doc.sentences[idx - 1]?.text,
          doc.sentences[idx]?.text,
          doc.sentences[idx + 1]?.text,
        ]
          .filter(Boolean)
          .join(" ");
      }
    } catch {
      // ignore
    }
    try {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const x = Math.min(
        window.innerWidth - 300,
        Math.max(12, rect.left + rect.width / 2 - 140),
      );
      setSelAnchor({ sentenceIdx: anchorIdx, x, y: rect.top });
    } catch {
      setSelAnchor({ sentenceIdx: anchorIdx, x: 16, y: 120 });
    }
    setSelection({ text, context });
  }, [doc]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setSelAnchor(null);
    setHlNote("");
    setHlNoteOpen(false);
  }, []);

  // Swipe navigation: horizontal swipes on the article step sentences.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onArticleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  }, []);
  const onArticleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      updateSelection();
      const start = swipeStart.current;
      swipeStart.current = null;
      const t = e.changedTouches[0];
      if (!start || !t || !doc) return;
      // Don't hijack text-selection gestures.
      if (window.getSelection()?.toString().trim()) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      haptic();
      resumeAutoScroll();
      if (dx < 0) {
        if (playbackSource === "original") {
          jumpToSentenceOriginal(Math.min((doc.sentences.length || 1) - 1, activeSentenceIdx + 1));
        } else {
          player.next();
        }
      } else {
        if (playbackSource === "original") {
          jumpToSentenceOriginal(Math.max(0, activeSentenceIdx - 1));
        } else {
          player.prev();
        }
      }
    },
    [doc, playbackSource, activeSentenceIdx, jumpToSentenceOriginal, player, resumeAutoScroll, updateSelection],
  );

  const saveHighlight = useCallback(
    (color: HighlightColor) => {
      if (!doc || !selection || !selAnchor) return;
      api
        .addHighlight(doc.id, {
          sentenceIdx: selAnchor.sentenceIdx,
          text: selection.text,
          color,
          note: hlNote.trim() || undefined,
        })
        .then((h) => {
          setHighlights((list) => [...list, h].sort((a, b) => a.sentenceIdx - b.sentenceIdx));
          clearSelection();
          toast.success("Highlight saved.");
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Highlight failed."));
    },
    [doc, selection, selAnchor, hlNote, clearSelection, toast],
  );

  const deleteHighlight = useCallback(
    (id: string) => {
      if (!doc) return;
      api.deleteHighlight(doc.id, id).catch(() => {});
      setHighlights((list) => list.filter((h) => h.id !== id));
    },
    [doc],
  );

  const updateHighlight = useCallback(
    (id: string, patch: { note?: string | null; color?: HighlightColor }) => {
      if (!doc) return;
      api
        .updateHighlight(doc.id, id, patch)
        .then((updated) => {
          setHighlights((list) =>
            list.map((h) => (h.id === id ? { ...h, ...updated } : h)),
          );
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed."));
    },
    [doc, toast],
  );

  const addBookmark = useCallback(
    (note: string) => {
      if (!doc) return;
      haptic();
      api
        .addBookmark(doc.id, activeSentenceIdx, note || undefined)
        .then((b) => {
          setBookmarks((list) => [...list, b].sort((a, c) => a.sentenceIdx - c.sentenceIdx));
          toast.success(`Bookmarked sentence ${activeSentenceIdx + 1}.`);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Bookmark failed."));
    },
    [doc, activeSentenceIdx, toast],
  );

  const deleteBookmark = useCallback(
    (id: string) => {
      if (!doc) return;
      api.deleteBookmark(doc.id, id).catch(() => {});
      setBookmarks((list) => list.filter((b) => b.id !== id));
    },
    [doc],
  );

  const jumpTo = useCallback(
    (idx: number) => {
      haptic();
      setAiOpen(false);
      setResumeDismissed(true);
      resumeAutoScroll();
      if (playbackSource === "original") {
        jumpToSentenceOriginal(idx);
      } else {
        player.playFrom(idx);
      }
      requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-idx="${idx}"]`)
          ?.scrollIntoView({ block: "center" });
      });
    },
    [playbackSource, jumpToSentenceOriginal, player, resumeAutoScroll],
  );

  const jumpToResume = useCallback(() => {
    if (!doc) return;
    haptic();
    setResumeDismissed(true);
    resumeAutoScroll();
    const idx = Math.max(
      0,
      Math.min(doc.sentenceCount - 1, initialProgressRef.current ?? 0),
    );
    if (playbackSource === "original") {
      jumpToSentenceOriginal(idx);
    } else {
      player.playFrom(idx);
    }
    requestAnimationFrame(() => {
      articleRef.current
        ?.querySelector(`[data-idx="${idx}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [doc, playbackSource, jumpToSentenceOriginal, player, resumeAutoScroll]);

  /** TOC chapter jump: scroll to center, keep playing only if playing. */
  const jumpToChapter = useCallback(
    (idx: number) => {
      haptic();
      setTocOpen(false);
      setResumeDismissed(true);
      resumeAutoScroll();
      if (playbackSource === "original") {
        jumpToSentenceOriginal(idx);
      } else {
        if (player.status === "playing" || player.status === "loading") {
          player.playFrom(idx);
        } else {
          player.seekTo(idx);
        }
      }
      requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-idx="${idx}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [playbackSource, jumpToSentenceOriginal, player, resumeAutoScroll],
  );

  /** Global mute toggle (the "M" shortcut); PlayerBar syncs via event. */
  const toggleMute = useCallback(() => {
    haptic();
    if (playbackSource === "original") {
      toggleOrigMute();
      return;
    }
    const audio = getSharedAudio();
    const currentlyMuted = audio ? audio.muted : loadMuted();
    const next = !currentlyMuted;
    if (audio) {
      try {
        audio.muted = next;
        if (!next && audio.volume === 0) audio.volume = 0.8;
      } catch {
        // ignore
      }
    }
    saveMuted(next);
    if (!next && loadVolume() === 0) saveVolume(0.8);
    emitVolumeChange();
  }, [playbackSource, toggleOrigMute]);

  const overallPct = useMemo(() => {
    if (!doc) return 0;
    if (playbackSource === "original" && origDuration > 0) {
      return Math.min(100, Math.round((origCurrentTime / origDuration) * 100));
    }
    if (doc.sentenceCount <= 1) return 0;
    return Math.min(
      100,
      Math.round(
        ((activeSentenceIdx + (playbackSource === "original" ? 0 : player.clipProgress)) / (doc.sentenceCount - 1)) * 100,
      ),
    );
  }, [doc, playbackSource, origDuration, origCurrentTime, activeSentenceIdx, player.clipProgress]);

  // --- Dynamic "time left" estimate (updates with sentence + speed) ---
  const sentenceWordCum = useMemo(
    () => cumulativeWordCounts(doc?.sentences.map((s) => s.text) ?? []),
    [doc],
  );
  const wordsLeft = wordsRemainingFrom(
    sentenceWordCum,
    activeSentenceIdx,
    playbackSource === "original" ? 0 : player.clipProgress,
  );
  const activeSpeed = playbackSource === "original" ? origSpeed : player.speed;
  const timeLeftLabel = formatTimeLeftBadge(wordsLeft, activeSpeed);
  const docCostUsd = doc ? estimateTtsCostUsd(doc.totalChars) : 0;

  // --- Keyboard shortcuts ("?"/cheat-sheet toggle lives in AppShell) ---
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      if (castOpen) setCastOpen(false);
      else if (aiOpen) setAiOpen(false);
      else if (tocOpen) setTocOpen(false);
      else if (showAutoSkip) setShowAutoSkip(false);
      else if (showAppearance) setShowAppearance(false);
      return;
    }
    if (shortcutsOpen || !doc) return;
    const t = e.target;
    if (
      t instanceof HTMLElement &&
      (t.isContentEditable ||
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT")
    ) {
      return;
    }
    switch (e.key) {
      case " ":
        e.preventDefault();
        haptic();
        if (playbackSource === "original") {
          toggleOriginal();
        } else {
          player.toggle();
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        haptic();
        if (playbackSource === "original") {
          if (e.shiftKey) skipOriginal(-15);
          else jumpToSentenceOriginal(Math.max(0, activeSentenceIdx - 1));
        } else {
          if (e.shiftKey) void player.skip(-15);
          else player.prev();
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        haptic();
        if (playbackSource === "original") {
          if (e.shiftKey) skipOriginal(15);
          else jumpToSentenceOriginal(Math.min((doc.sentences.length || 1) - 1, activeSentenceIdx + 1));
        } else {
          if (e.shiftKey) void player.skip(15);
          else player.next();
        }
        break;
      case "ArrowUp":
      case "]":
        e.preventDefault();
        if (playbackSource === "original") {
          setOrigAudioSpeed(Math.round((origSpeed + 0.1) * 10) / 10);
        } else {
          player.setSpeed(Math.round((player.speed + 0.1) * 10) / 10);
        }
        break;
      case "ArrowDown":
      case "[":
        e.preventDefault();
        if (playbackSource === "original") {
          setOrigAudioSpeed(Math.round((origSpeed - 0.1) * 10) / 10);
        } else {
          player.setSpeed(Math.round((player.speed - 0.1) * 10) / 10);
        }
        break;
      default: {
        // Shift+arrows handled above; ignore other shifted keys.
        // ("?" cheat-sheet toggle lives in AppShell.)
        if (e.shiftKey) return;
        const k = e.key.toLowerCase();
        if (k === "b") addBookmark("");
        else if (k === "n") openAi("notes");
        else if (k === "r")
          setPrefs((p) => ({ ...p, rulerMode: !p.rulerMode }));
        else if (k === "a") openAi("summary");
        else if (k === "p") openAi("podcast");
        else if (k === "j") {
          haptic();
          if (playbackSource === "original") {
            jumpToSentenceOriginal(Math.min((doc.sentences.length || 1) - 1, activeSentenceIdx + 1));
          } else {
            player.next();
          }
        } else if (k === "k") {
          haptic();
          if (playbackSource === "original") {
            jumpToSentenceOriginal(Math.max(0, activeSentenceIdx - 1));
          } else {
            player.prev();
          }
        } else if (k === "m") toggleMute();
        else if (k === "t") setTocOpen((v) => !v);
        else if (k === "c") setCastOpen((v) => !v);
        break;
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fontCls = appearanceFontClass(appearance.font);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-500">
        <Loader2 className="animate-spin" size={18} /> Loading document…
      </div>
    );
  }

  if (loadError || !doc) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <TriangleAlert size={28} className="mx-auto text-amber-500" />
        <p className="mt-3 font-semibold">Couldn’t open this document</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {loadError || "Document not found."}
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Back to library
        </Link>
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full ${pageWidthClass(prefs.pageWidth)} pb-72 pt-4`}>
      <div className="mb-3 flex items-center gap-2">
        <Link
          href="/"
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Back to library"
        >
          <ArrowLeft size={19} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight sm:text-xl">
            {doc.title}
          </h1>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {doc.author ? `${doc.author} · ` : ""}
            {doc.wordCount.toLocaleString()} words · {overallPct}% played
          </p>
        </div>
        <button
          onClick={() => setShowAppearance((v) => !v)}
          className={`rounded-lg p-2 ${showAppearance ? "bg-zinc-200 dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
          aria-label="Reading appearance"
          title="Font & layout"
        >
          <Type size={19} />
        </button>
        <button
          onClick={() => setShowAutoSkip(true)}
          className={`rounded-lg p-2 ${autoSkip.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
          aria-label="Auto-skip settings"
          title="Auto-skip content"
        >
          <FastForward size={19} />
        </button>
        <button
          onClick={() => setPronOpen(true)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Phonetic Pronunciations"
          title="Phonetic Pronunciations"
        >
          <Volume2 size={15} />
          <span className="hidden sm:inline">Phonetic Pronunciations</span>
        </button>
        <button
          onClick={() => setPrefs((p) => ({ ...p, rulerMode: !p.rulerMode }))}
          className={`rounded-lg p-2 ${prefs.rulerMode ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
          aria-label="Toggle reading ruler"
          title="Reading ruler (R)"
          aria-pressed={prefs.rulerMode}
        >
          <Focus size={19} />
        </button>
        <button
          onClick={() => addBookmark("")}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Bookmark current sentence"
          title="Bookmark current sentence (B)"
        >
          <BookmarkPlus size={19} />
        </button>
        <button
          onClick={() => setTocOpen((v) => !v)}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold ${tocOpen ? "bg-zinc-200 dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
          aria-label="Open table of contents"
          title="Table of contents (T)"
          aria-expanded={tocOpen}
        >
          <span role="img" aria-hidden="true">
            📑
          </span>
          <span className="hidden sm:inline">TOC</span>
        </button>
        <button
          onClick={() => openAi("notes")}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
            doc.audioNotes
              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
              : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
          aria-label="Audio Notes"
          title="Notes & Takeaways (N)"
        >
          <StickyNote size={15} />
          <span className="hidden sm:inline">Notes</span>
        </button>
        <button
          onClick={() => setCastOpen(true)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
            doc.dialogueActing && doc.dialogueActing.enabled !== false
              ? "bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:hover:bg-purple-900"
              : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
          aria-label="Cast / Dialogue Acting"
          title="Cast / Dialogue Acting (🎭)"
        >
          <span role="img" aria-hidden="true">
            🎭
          </span>
          <span className="hidden sm:inline">Cast</span>
          {doc.dialogueActing && doc.dialogueActing.characters.length > 0 && (
            <span className="rounded-full bg-purple-200/80 px-1 text-[10px] tabular-nums font-bold text-purple-800 dark:bg-purple-900 dark:text-purple-200">
              {doc.dialogueActing.characters.length}
            </span>
          )}
        </button>
        <button
          onClick={() => openAi("summary")}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Open AI assistant"
          title="AI assistant (A)"
        >
          <Sparkles size={19} />
        </button>
        <button
          onClick={openShortcuts}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard size={19} />
        </button>
        <button
          onClick={() => setPrerenderOpen(true)}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold ${
            prerenderStats?.isFullyCached
              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
              : "bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:hover:bg-amber-900"
          }`}
          aria-label="Pre-render offline audio"
          title={
            prerenderStats
              ? `Offline audio: ${prerenderStats.percentCached}% cached — click to pre-render`
              : "Pre-render offline audio"
          }
        >
          <Zap size={15} />
          <span className="tabular-nums">
            {prerenderStats ? `${prerenderStats.percentCached}%` : "…"}
          </span>
          <span className="hidden sm:inline">Pre-render</span>
        </button>
        <button
          onClick={() => openAi("podcast")}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          aria-label="Generate AI podcast"
          title="Generate AI podcast"
        >
          <Mic size={15} />
          <span className="hidden sm:inline">🎙️ Podcast</span>
        </button>
        <button
          onClick={handleDeviceButton}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold ${
            onDevice?.onDevice
              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
              : "bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:hover:bg-sky-900"
          }`}
          aria-label={
            onDevice?.onDevice
              ? "Remove this book from device storage"
              : "Download this book to the device"
          }
          title={
            onDevice?.onDevice
              ? `Saved on this device (${formatBytes(onDevice.bytes)}) — click to remove`
              : "Download book + audio to this device for offline listening"
          }
        >
          📱<span className="hidden sm:inline">{onDevice?.onDevice ? "Saved" : "Download"}</span>
        </button>
      </div>

      {/* Dual Playback Switcher */}
      {hasOriginalAudio && (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-50/40 p-2.5 backdrop-blur-sm dark:border-emerald-500/20 dark:bg-emerald-950/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Audio:
            </span>
            <div className="inline-flex rounded-xl bg-zinc-200/80 p-0.5 dark:bg-zinc-800">
              <button
                type="button"
                onClick={switchToOriginal}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  playbackSource === "original"
                    ? "bg-white text-emerald-800 shadow-sm dark:bg-zinc-900 dark:text-emerald-300"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                <Mic size={13} />
                <span>Original Audio</span>
              </button>
              <button
                type="button"
                onClick={switchToGemini}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  playbackSource === "gemini"
                    ? "bg-white text-emerald-800 shadow-sm dark:bg-zinc-900 dark:text-emerald-300"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                <Sparkles size={13} />
                <span>Gemini Voice</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openAi("notes")}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-600/30 bg-emerald-100/60 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-200/60 dark:border-emerald-500/30 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
          >
            <StickyNote size={14} />
            <span>Structured Notes</span>
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
          title={`${wordsLeft.toLocaleString()} words remaining · estimate at 150 wpm`}
          aria-live="polite"
        >
          <Timer size={12} />
          {timeLeftLabel}
        </span>
        {player.sleepLeft !== null ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
            ⏳ {formatSleepCountdown(player.sleepLeft)}
            <button
              onClick={() => player.setSleep(null)}
              aria-label="Cancel sleep timer"
              className="rounded-full p-0.5 hover:bg-amber-200 dark:hover:bg-amber-900"
            >
              <X size={12} />
            </button>
          </span>
        ) : player.sleepEndOfDoc ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
            Stops at end of document
            <button
              onClick={() => player.setSleep(null)}
              aria-label="Cancel sleep timer"
              className="rounded-full p-0.5 hover:bg-amber-200 dark:hover:bg-amber-900"
            >
              <X size={12} />
            </button>
          </span>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-zinc-200/70 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <Timer size={12} />
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "end") player.setSleep("end");
                else if (v) player.setSleep(Number(v));
                e.target.value = "";
              }}
              className="cursor-pointer bg-transparent outline-none dark:bg-zinc-800"
              aria-label="Sleep timer"
            >
              <option value="">Sleep</option>
              <option value="5">5 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
              <option value="end">End of document</option>
            </select>
          </label>
        )}
        <span
          className="inline-flex items-center gap-1 rounded-full bg-zinc-200/70 px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          title={`Full-document synthesis estimate for ${doc.totalChars.toLocaleString()} characters at ~$0.02 / 100k chars`}
        >
          Est. cost: {formatUsd(docCostUsd)} (Free tier eligible)
        </span>
        {autoSkip.enabled && (
          <button
            onClick={() => setShowAutoSkip(true)}
            className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:hover:bg-sky-900"
            title="Auto-skip is on — click to configure"
          >
            <FastForward size={12} />
            Auto-skip {autoSkip.mode === "ai" ? "AI" : "Rules"}
          </button>
        )}
        <button
          onClick={() => openAi("highlights")}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            highlights.length > 0
              ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:hover:bg-amber-900"
              : "bg-zinc-200/70 text-zinc-600 hover:bg-zinc-300/70 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
          title="Open notes & highlights drawer"
        >
          <Highlighter size={12} />
          {highlights.length > 0
            ? `${highlights.length} note${highlights.length === 1 ? "" : "s"} / highlight${highlights.length === 1 ? "" : "s"}`
            : "Notes & Highlights"}
        </button>
        {onDevice?.onDevice && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white dark:bg-emerald-500 dark:text-zinc-950"
            title={`Saved on this device (${formatBytes(onDevice.bytes)}) — reads and plays with no network`}
          >
            📱 Offline Ready
          </span>
        )}
        {offlineMode && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white dark:bg-amber-500 dark:text-zinc-950"
            title="Server unreachable — reading and listening from the on-device copy"
          >
            Offline — playing from this device
          </span>
        )}
      </div>

      {showAppearance && (
        <div className="mb-4">
          <AppearanceMenu
            prefs={appearance}
            onChange={setAppearance}
            fontSize={prefs.fontSize}
            lineHeight={prefs.lineHeight}
            onFontSize={(v) => setPrefs((p) => ({ ...p, fontSize: v }))}
            onLineHeight={(v) => setPrefs((p) => ({ ...p, lineHeight: v }))}
            bionicReading={prefs.bionicReading}
            focusMask={prefs.focusMask}
            onBionicReading={(v) => setPrefs((p) => ({ ...p, bionicReading: v }))}
            onFocusMask={(v) => setPrefs((p) => ({ ...p, focusMask: v }))}
            pageWidth={prefs.pageWidth}
            onPageWidth={(v) => setPrefs((p) => ({ ...p, pageWidth: v }))}
            onOpenPronunciations={() => setPronOpen(true)}
          />
        </div>
      )}

      <TimelineScrubber
        doc={doc}
        currentIdx={activeSentenceIdx}
        clipProgress={playbackSource === "original" ? 0 : player.clipProgress}
        speed={playbackSource === "original" ? origSpeed : player.speed}
        cum={sentenceWordCum}
        onJump={(idx) => {
          setResumeDismissed(true);
          resumeAutoScroll();
          if (playbackSource === "original") {
            jumpToSentenceOriginal(idx);
          } else {
            player.playFrom(idx);
          }
        }}
      />

      <div
        ref={articleRef}
        onMouseUp={updateSelection}
        onTouchStart={onArticleTouchStart}
        onTouchEnd={onArticleTouchEnd}
        onKeyUp={updateSelection}
        data-cursor={appearance.cursorColor}
        data-highlight={appearance.highlightSentence ? "on" : "off"}
        className={`${fontCls}${prefs.rulerMode ? " ruler-mode" : ""} space-y-2.5 rounded-xl border border-zinc-200 bg-white p-4 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900`}
        style={{ fontSize: prefs.fontSize, lineHeight: prefs.lineHeight }}
      >
        {doc.sentences.map((s) => {
          const filtered = speakMap.get(s.idx);
          const isActive = s.idx === activeSentenceIdx;
          return (
            <SentenceItem
              key={s.idx}
              sentence={s}
              displayText={filtered?.text ?? s.text}
              active={isActive}
              near={Math.abs(s.idx - activeSentenceIdx) === 1}
              loading={playbackSource === "gemini" && s.idx === player.loadingIdx && player.status === "loading"}
              activeWord={isActive ? activeWordIdx : -1}
              skipped={playbackSource === "gemini" ? (filtered?.skipped ?? false) : false}
              clickable={appearance.clickToListen}
              highlights={highlightsBySentence.get(s.idx) || []}
              bionic={prefs.bionicReading}
              dimmed={prefs.focusMask}
              dialogueTag={dialogueTagsBySentence.get(s.idx) || null}
              onPlay={handlePlay}
            />
          );
        })}
      </div>

      <p className="mt-3 text-center text-xs text-zinc-400">
        Click any sentence to play from there · Select text to add notes or highlight · Open Notes drawer to copy with context
      </p>

      {/* Floating selection toolbar: 1-click highlight + note */}
      {selection && selAnchor && (
        <div
          className="fixed z-40 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: selAnchor.x, top: Math.max(60, selAnchor.y - 8), transform: "translateY(-100%)" }}
          role="toolbar"
          aria-label="Highlight selection"
        >
          <div className="flex items-center gap-1.5">
            {HIGHLIGHT_SWATCHES.map((c) => (
              <button
                key={c.id}
                onClick={() => saveHighlight(c.id)}
                title={`Highlight & save note (${c.id})`}
                aria-label={`Highlight ${c.id}`}
                className="h-7 w-7 rounded-full border-2 border-transparent transition-transform hover:scale-110 hover:border-zinc-900 dark:hover:border-white shadow-sm"
                style={{ backgroundColor: c.swatch }}
              />
            ))}
            <button
              onClick={() => setHlNoteOpen((v) => !v)}
              title="Add note to selection"
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${hlNoteOpen ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
            >
              <StickyNote size={14} /> Note
            </button>
            <button
              onClick={() => {
                if (!selection) return;
                setSelectedPronWord(selection.text.trim());
                setPronOpen(true);
              }}
              title="Create a pronunciation rule for the selected text"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Volume2 size={14} /> Pronounce as...
            </button>
            <button
              onClick={clearSelection}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
          {hlNoteOpen && (
            <div className="mt-2 flex gap-1.5 items-center">
              <input
                autoFocus
                value={hlNote}
                onChange={(e) => setHlNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveHighlight("yellow");
                }}
                placeholder="Type your note, then press Enter or click a color…"
                className="w-64 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={() => saveHighlight("yellow")}
                className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950"
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}

      {(initialProgressRef.current ?? 0) > 0 &&
        !resumeDismissed &&
        player.status === "idle" && (
          <div className="pointer-events-none fixed inset-x-0 bottom-44 z-30 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-zinc-900 py-2 pl-4 pr-2 text-sm text-white shadow-xl animate-fade-up dark:bg-zinc-100 dark:text-zinc-900">
              <span className="truncate">
                Resume from sentence #{(initialProgressRef.current ?? 0) + 1} (
                {Math.max(
                  1,
                  Math.round(
                    wordsRemainingFrom(
                      sentenceWordCum,
                      initialProgressRef.current ?? 0,
                      0,
                    ) /
                      150 /
                      (playbackSource === "original" ? origSpeed : player.speed),
                  ),
                )}{" "}
                min left)
              </span>
              <button
                onClick={jumpToResume}
                className="shrink-0 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
              >
                Jump
              </button>
              <button
                onClick={() => setResumeDismissed(true)}
                aria-label="Dismiss resume suggestion"
                className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white dark:text-zinc-500 dark:hover:bg-zinc-300 dark:hover:text-zinc-900"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

      {doc.originalAudioUrl && (
        <audio
          ref={origAudioRef}
          src={doc.originalAudioUrl}
          preload="metadata"
          onPlay={() => setOrigIsPlaying(true)}
          onPause={() => setOrigIsPlaying(false)}
          onTimeUpdate={(e) => setOrigCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setOrigDuration(e.currentTarget.duration)}
          onEnded={() => setOrigIsPlaying(false)}
        />
      )}

      {hasOriginalAudio && playbackSource === "original" ? (
        <OriginalAudioPlayerBar
          doc={doc}
          isPlaying={origIsPlaying}
          currentTime={origCurrentTime}
          duration={origDuration}
          speed={origSpeed}
          volume={origVolume}
          muted={origMuted}
          onTogglePlay={toggleOriginal}
          onSeek={seekOriginal}
          onSkip={skipOriginal}
          onSpeedChange={setOrigAudioSpeed}
          onToggleMute={toggleOrigMute}
          onSwitchToGemini={switchToGemini}
          onOpenNotes={() => openAi("notes")}
        />
      ) : (
        <PlayerBar player={player} doc={doc} onOpenAI={() => openAi("summary")} />
      )}
      {pronOpen && (
        <PronunciationModal
          initialWord={selectedPronWord}
          onClose={() => {
            setPronOpen(false);
            setSelectedPronWord(undefined);
          }}
        />
      )}
      <AutoSkipModal
        open={showAutoSkip}
        onClose={() => setShowAutoSkip(false)}
        options={autoSkip}
        onChange={setAutoSkip}
      />
      {prerenderOpen && (
        <PrerenderModal
          docId={doc.id}
          title={doc.title}
          currentIdx={activeSentenceIdx}
          onClose={() => {
            setPrerenderOpen(false);
            refreshPrerenderStats();
          }}
          onDone={setPrerenderStats}
        />
      )}
      {downloadOpen && (
        <DownloadToDeviceModal
          doc={{ ...doc, voice: player.voice, stylePrompt: player.stylePrompt }}
          onClose={() => {
            setDownloadOpen(false);
            refreshOnDevice();
          }}
          onDone={refreshOnDevice}
        />
      )}
      <TOCDrawer
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        sentences={doc.sentences}
        currentIdx={activeSentenceIdx}
        onJump={jumpToChapter}
      />
      <AIDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        doc={doc}
        currentIdx={activeSentenceIdx}
        selection={selection}
        bookmarks={bookmarks}
        onJump={jumpTo}
        onAddBookmark={addBookmark}
        onDeleteBookmark={deleteBookmark}
        highlights={highlights}
        onDeleteHighlight={deleteHighlight}
        onUpdateHighlight={updateHighlight}
        initialTab={aiTab}
      />
      <DialogueCastModal
        open={castOpen}
        onClose={() => setCastOpen(false)}
        doc={doc}
        onUpdateDoc={(updated) => setDoc(updated)}
      />
    </div>
  );
}
