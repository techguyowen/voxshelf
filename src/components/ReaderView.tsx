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
  Sparkles,
  StickyNote,
  Timer,
  TriangleAlert,
  Type,
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
} from "@/lib/types";
import { AIDrawer, type TextSelection } from "./AIDrawer";
import { DownloadToDeviceModal } from "./DownloadToDeviceModal";
import { TOCDrawer } from "./TOCDrawer";
import { PrerenderModal } from "./PrerenderModal";
import { PronunciationModal } from "./PronunciationModal";
import {
  AppearanceMenu,
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

type AiTab = "summary" | "explain" | "chat" | "quiz" | "cards" | "podcast" | "bookmarks" | "highlights";

export function ReaderView({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [appearance, setAppearance] = useState<AppearancePrefs>(() =>
    typeof window === "undefined" ? { cursorColor: "yellow", highlightSentence: true, font: "atkinson", autoPlay: false, clickToListen: true } : loadAppearance(),
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

  const player = usePlayer(doc, { onProgress: persistProgress, filterSentence });
  const handlePlay = useCallback(
    (idx: number) => {
      if (!appearance.clickToListen) return;
      haptic();
      setResumeDismissed(true);
      resumeAutoScroll();
      player.playFrom(idx);
    },
    [player, appearance.clickToListen, resumeAutoScroll],
  );

  // Publish now-playing metadata for the floating mini-player + lock screen.
  // clipProgress is quantized so background subscribers aren't spammed.
  const quantizedProgress = Math.round(player.clipProgress * 20) / 20;
  useEffect(() => {
    if (!doc) return;
    publishNowPlaying({
      docId: doc.id,
      title: doc.title,
      sentenceIdx: player.currentIdx,
      sentenceCount: doc.sentenceCount,
      snippet: (doc.sentences[player.currentIdx]?.text ?? "").slice(0, 80),
      speed: player.speed,
      clipProgress: Math.round(player.clipProgress * 20) / 20,
      status: player.status,
    });
  }, [doc, player.currentIdx, player.speed, quantizedProgress, player.status]);

  // Periodic reading-session pings while audio is actually playing.
  const livePlayerRef = useRef({ idx: 0, speed: 1 });
  livePlayerRef.current = { idx: player.currentIdx, speed: player.speed };
  const sessionAnchorRef = useRef(0);
  const docTextsRef = useRef<string[]>([]);
  useEffect(() => {
    sessionAnchorRef.current = player.currentIdx;
    if (doc) docTextsRef.current = doc.sentences.map((s) => s.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  useEffect(() => {
    if (!doc || player.status !== "playing") return;
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
  }, [doc, player.status]);

  // Auto-play as soon as the file opens (optional).
  const autoPlayedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || !appearance.autoPlay) return;
    if (autoPlayedRef.current === doc.id) return;
    autoPlayedRef.current = doc.id;
    const t = setTimeout(() => player.play(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, appearance.autoPlay]);

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
    if (player.status !== "playing" && player.status !== "loading" && !firstScroll.current) {
      return;
    }
    const el = articleRef.current?.querySelector(
      `[data-idx="${player.currentIdx}"]`,
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
  }, [doc, player.currentIdx, player.status]);

  // Background tab resync & mobile lockscreen wakeup: when the tab/screen
  // becomes visible again mid-playback, re-sync the audio cursor state and
  // smoothly scroll the active sentence back into center view so the visual
  // state never lags behind the audio.
  const liveResyncRef = useRef({ idx: 0, status: player.status, resync: player.resync });
  liveResyncRef.current = { idx: player.currentIdx, status: player.status, resync: player.resync };
  useEffect(() => {
    const wake = () => {
      const live = liveResyncRef.current;
      if (live.status !== "playing" && live.status !== "loading") return;
      live.resync();
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
  }, []);

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
      if (dx < 0) player.next();
      else player.prev();
    },
    [doc, player, resumeAutoScroll, updateSelection],
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
        .addBookmark(doc.id, player.currentIdx, note || undefined)
        .then((b) => {
          setBookmarks((list) => [...list, b].sort((a, c) => a.sentenceIdx - c.sentenceIdx));
          toast.success(`Bookmarked sentence ${player.currentIdx + 1}.`);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Bookmark failed."));
    },
    [doc, player, toast],
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
      player.playFrom(idx);
      requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-idx="${idx}"]`)
          ?.scrollIntoView({ block: "center" });
      });
    },
    [player, resumeAutoScroll],
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
    player.playFrom(idx);
    requestAnimationFrame(() => {
      articleRef.current
        ?.querySelector(`[data-idx="${idx}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [doc, player, resumeAutoScroll]);

  /** TOC chapter jump: scroll to center, keep playing only if playing. */
  const jumpToChapter = useCallback(
    (idx: number) => {
      haptic();
      setTocOpen(false);
      setResumeDismissed(true);
      resumeAutoScroll();
      if (player.status === "playing" || player.status === "loading") {
        player.playFrom(idx);
      } else {
        player.seekTo(idx);
      }
      requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-idx="${idx}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [player, resumeAutoScroll],
  );

  /** Global mute toggle (the "M" shortcut); PlayerBar syncs via event. */
  const toggleMute = useCallback(() => {
    haptic();
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
  }, []);

  const overallPct = useMemo(() => {
    if (!doc || doc.sentenceCount <= 1) return 0;
    return Math.min(
      100,
      Math.round(
        ((player.currentIdx + player.clipProgress) / (doc.sentenceCount - 1)) * 100,
      ),
    );
  }, [doc, player.currentIdx, player.clipProgress]);

  // --- Dynamic "time left" estimate (updates with sentence + speed) ---
  const sentenceWordCum = useMemo(
    () => cumulativeWordCounts(doc?.sentences.map((s) => s.text) ?? []),
    [doc],
  );
  const wordsLeft = wordsRemainingFrom(
    sentenceWordCum,
    player.currentIdx,
    player.clipProgress,
  );
  const timeLeftLabel = formatTimeLeftBadge(wordsLeft, player.speed);
  const docCostUsd = doc ? estimateTtsCostUsd(doc.totalChars) : 0;

  // --- Keyboard shortcuts ("?"/cheat-sheet toggle lives in AppShell) ---
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      if (aiOpen) setAiOpen(false);
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
        player.toggle();
        break;
      case "ArrowLeft":
        e.preventDefault();
        haptic();
        if (e.shiftKey) void player.skip(-15);
        else player.prev();
        break;
      case "ArrowRight":
        e.preventDefault();
        haptic();
        if (e.shiftKey) void player.skip(15);
        else player.next();
        break;
      case "ArrowUp":
        e.preventDefault();
        player.setSpeed(Math.round((player.speed + 0.1) * 10) / 10);
        break;
      case "ArrowDown":
        e.preventDefault();
        player.setSpeed(Math.round((player.speed - 0.1) * 10) / 10);
        break;
      case "[":
        e.preventDefault();
        player.setSpeed(Math.round((player.speed - 0.1) * 10) / 10);
        break;
      case "]":
        e.preventDefault();
        player.setSpeed(Math.round((player.speed + 0.1) * 10) / 10);
        break;
      default: {
        // Shift+arrows handled above; ignore other shifted keys.
        // ("?" cheat-sheet toggle lives in AppShell.)
        if (e.shiftKey) return;
        const k = e.key.toLowerCase();
        if (k === "b") addBookmark("");
        else if (k === "r")
          setPrefs((p) => ({ ...p, rulerMode: !p.rulerMode }));
        else if (k === "a") openAi("summary");
        else if (k === "p") openAi("podcast");
        else if (k === "j") {
          haptic();
          player.next();
        } else if (k === "k") {
          haptic();
          player.prev();
        } else if (k === "m") toggleMute();
        else if (k === "t") setTocOpen((v) => !v);
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
        currentIdx={player.currentIdx}
        clipProgress={player.clipProgress}
        speed={player.speed}
        cum={sentenceWordCum}
        onJump={(idx) => {
          setResumeDismissed(true);
          resumeAutoScroll();
          player.playFrom(idx);
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
          return (
            <SentenceItem
              key={s.idx}
              sentence={s}
              displayText={filtered?.text ?? s.text}
              active={s.idx === player.currentIdx}
              near={Math.abs(s.idx - player.currentIdx) === 1}
              loading={s.idx === player.loadingIdx && player.status === "loading"}
              activeWord={s.idx === player.currentIdx ? player.currentWord : -1}
              skipped={filtered?.skipped ?? false}
              clickable={appearance.clickToListen}
              highlights={highlightsBySentence.get(s.idx) || []}
              bionic={prefs.bionicReading}
              dimmed={prefs.focusMask}
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
                      player.speed,
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

      <PlayerBar player={player} doc={doc} onOpenAI={() => openAi("summary")} />
      {pronOpen && <PronunciationModal onClose={() => setPronOpen(false)} />}
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
          currentIdx={player.currentIdx}
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
        currentIdx={player.currentIdx}
        onJump={jumpToChapter}
      />
      <AIDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        doc={doc}
        currentIdx={player.currentIdx}
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
    </div>
  );
}
