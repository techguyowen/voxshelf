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
import {
  getOfflineDocument,
  isDocumentOnDevice,
  removeDocumentFromDevice,
} from "@/lib/offlineStore";
import { applyAutoSkip, loadAutoSkip, saveAutoSkip, type AutoSkipOptions } from "@/lib/autoSkip";
import { estimateTtsCostUsd, formatUsd } from "@/lib/pricing";
import {
  cumulativeWordCounts,
  formatTimeLeftBadge,
  wordsRemainingFrom,
} from "@/lib/readingTime";
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
import { PrerenderModal } from "./PrerenderModal";
import {
  AppearanceMenu,
  appearanceFontClass,
  loadAppearance,
  saveAppearance,
  type AppearancePrefs,
} from "./AppearanceMenu";
import { useUI } from "./AppShell";
import { AutoSkipModal } from "./AutoSkipModal";
import { PlayerBar } from "./PlayerBar";

const PREFS_KEY = "vf-reader-prefs";

const DEFAULT_PREFS: ReaderPrefs = {
  font: "sans",
  fontSize: 18,
  lineHeight: 1.8,
  rulerMode: false,
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
    const raw = localStorage.getItem(PREFS_KEY);
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
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function WordSpans({
  text,
  activeWord,
}: {
  text: string;
  activeWord: number;
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
          {part}
        </span>,
      );
    }
  });
  return <>{nodes}</>;
}

/** Render sentence text with user highlight <mark> ranges applied. */
function HighlightedText({ text, highlights }: { text: string; highlights: Highlight[] }) {
  if (highlights.length === 0) return <>{text}</>;
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
  if (merged.length === 0) return <>{text}</>;
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach((r, i) => {
    if (r.start > pos) nodes.push(<span key={`t${i}`}>{text.slice(pos, r.start)}</span>);
    nodes.push(
      <mark key={r.id} className={`vf-hl vf-hl-${r.color}`}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    pos = r.end;
  });
  if (pos < text.length) nodes.push(<span key="tail">{text.slice(pos)}</span>);
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
  onPlay: (idx: number) => void;
}) {
  return (
    <p
      data-idx={sentence.idx}
      onClick={clickable ? () => onPlay(sentence.idx) : undefined}
      className={`vf-sentence${active ? " vf-sentence-active" : ""}${near ? " vf-sentence-near" : ""}${skipped ? " vf-sentence-skipped" : ""}`}
      style={clickable ? undefined : { cursor: "default" }}
      title={skipped ? "Skipped by auto-skip" : clickable ? "Click to play from here" : undefined}
    >
      {active ? (
        <WordSpans text={displayText} activeWord={activeWord} />
      ) : (
        <HighlightedText text={sentence.text} highlights={highlights} />
      )}
      {loading && (
        <Loader2 size={14} className="ml-2 inline animate-spin text-emerald-600" />
      )}
    </p>
  );
});

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
  const [offlineMode, setOfflineMode] = useState(false);
  const [onDevice, setOnDevice] = useState<{
    onDevice: boolean;
    bytes: number;
    downloadedAt?: string;
  } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const { openShortcuts, shortcutsOpen } = useUI();

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
    api
      .getDocument(docId)
      .then((d) => {
        if (!live) return;
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
          alert(e instanceof Error ? e.message : "Could not remove download."),
        );
    } else {
      setDownloadOpen(true);
    }
  }, [onDevice, docId, refreshOnDevice]);

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
      player.playFrom(idx);
    },
    [player, appearance.clickToListen],
  );

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

  // Auto-scroll the active sentence into view while playing.
  const firstScroll = useRef(true);
  useEffect(() => {
    if (!doc) return;
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
        Math.max(8, rect.left + rect.width / 2 - 140),
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
        })
        .catch((e) => alert(e instanceof Error ? e.message : "Highlight failed."));
    },
    [doc, selection, selAnchor, hlNote, clearSelection],
  );

  const deleteHighlight = useCallback(
    (id: string) => {
      if (!doc) return;
      api.deleteHighlight(doc.id, id).catch(() => {});
      setHighlights((list) => list.filter((h) => h.id !== id));
    },
    [doc],
  );

  const addBookmark = useCallback(
    (note: string) => {
      if (!doc) return;
      api
        .addBookmark(doc.id, player.currentIdx, note || undefined)
        .then((b) => setBookmarks((list) => [...list, b].sort((a, c) => a.sentenceIdx - c.sentenceIdx)))
        .catch((e) => alert(e instanceof Error ? e.message : "Bookmark failed."));
    },
    [doc, player],
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
      setAiOpen(false);
      player.playFrom(idx);
      requestAnimationFrame(() => {
        articleRef.current
          ?.querySelector(`[data-idx="${idx}"]`)
          ?.scrollIntoView({ block: "center" });
      });
    },
    [player],
  );

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
        player.toggle();
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey) void player.skip(-15);
        else player.prev();
        break;
      case "ArrowRight":
        e.preventDefault();
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
      default: {
        // Shift+arrows handled above; ignore other shifted keys.
        // ("?" cheat-sheet toggle lives in AppShell.)
        if (e.shiftKey) return;
        const k = e.key.toLowerCase();
        if (k === "b") addBookmark("");
        else if (k === "r")
          setPrefs((p) => ({ ...p, rulerMode: !p.rulerMode }));
        else if (k === "a") openAi("summary");
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
    <div className="mx-auto w-full max-w-3xl pb-72 pt-4">
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
        {highlights.length > 0 && (
          <button
            onClick={() => openAi("highlights")}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:hover:bg-amber-900"
            title="Open highlights and notes"
          >
            <Highlighter size={12} />
            {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
          </button>
        )}
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
          />
        </div>
      )}

      <div
        className="mb-4 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={overallPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Reading progress"
      >
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${overallPct}%` }}
        />
      </div>

      <div
        ref={articleRef}
        onMouseUp={updateSelection}
        onTouchEnd={updateSelection}
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
              onPlay={handlePlay}
            />
          );
        })}
      </div>

      <p className="mt-3 text-center text-xs text-zinc-400">
        Click any sentence to play from there · Select text, then open the AI
        assistant to explain it
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
                title={`Highlight ${c.id}`}
                aria-label={`Highlight ${c.id}`}
                className="h-7 w-7 rounded-full border-2 border-transparent transition-transform hover:scale-110 hover:border-zinc-900 dark:hover:border-white"
                style={{ backgroundColor: c.swatch }}
              />
            ))}
            <button
              onClick={() => setHlNoteOpen((v) => !v)}
              title="Add note"
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium ${hlNoteOpen ? "bg-zinc-200 dark:bg-zinc-700" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
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
            <div className="mt-2 flex gap-1.5">
              <input
                autoFocus
                value={hlNote}
                onChange={(e) => setHlNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveHighlight("yellow");
                }}
                placeholder="Add a note, then pick a color…"
                className="w-56 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
          )}
        </div>
      )}

      <PlayerBar player={player} doc={doc} onOpenAI={() => openAi("summary")} />
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
        initialTab={aiTab}
      />
    </div>
  );
}
