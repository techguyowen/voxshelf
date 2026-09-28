"use client";

import {
  ArrowLeft,
  BookmarkPlus,
  Focus,
  Loader2,
  Mic,
  Sparkles,
  TriangleAlert,
  Type,
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
import { api } from "@/lib/client";
import type {
  Bookmark,
  DocumentDetail,
  ReaderFont,
  ReaderPrefs,
  Sentence,
} from "@/lib/types";
import { AIDrawer, type TextSelection } from "./AIDrawer";
import { PlayerBar } from "./PlayerBar";

const PREFS_KEY = "vf-reader-prefs";

const DEFAULT_PREFS: ReaderPrefs = {
  font: "sans",
  fontSize: 18,
  lineHeight: 1.8,
  rulerMode: false,
};

function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      font:
        parsed.font === "serif" ||
        parsed.font === "mono" ||
        parsed.font === "dyslexic"
          ? parsed.font
          : "sans",
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

const SentenceItem = memo(function SentenceItem({
  sentence,
  active,
  near,
  loading,
  activeWord,
  onPlay,
}: {
  sentence: Sentence;
  active: boolean;
  near: boolean;
  loading: boolean;
  activeWord: number;
  onPlay: (idx: number) => void;
}) {
  return (
    <p
      data-idx={sentence.idx}
      onClick={() => onPlay(sentence.idx)}
      className={`vf-sentence${active ? " vf-sentence-active" : ""}${near ? " vf-sentence-near" : ""}`}
      title="Click to play from here"
    >
      {active ? (
        <WordSpans text={sentence.text} activeWord={activeWord} />
      ) : (
        sentence.text
      )}
      {loading && (
        <Loader2 size={14} className="ml-2 inline animate-spin text-emerald-600" />
      )}
    </p>
  );
});

const FONT_OPTIONS: { id: ReaderFont; label: string }[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
  { id: "dyslexic", label: "Dyslexia-friendly" },
];

export function ReaderView({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [showFontPanel, setShowFontPanel] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<
    "summary" | "explain" | "chat" | "quiz" | "cards" | "podcast" | "bookmarks"
  >("summary");

  function openAi(
    tab: "summary" | "explain" | "chat" | "quiz" | "cards" | "podcast" | "bookmarks" = "summary",
  ) {
    setAiTab(tab);
    setAiOpen(true);
  }
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(null);
    api
      .getDocument(docId)
      .then((d) => {
        if (!live) return;
        setDoc(d);
        setBookmarks(d.bookmarks);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load document.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [docId]);

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

  const player = usePlayer(doc, { onProgress: persistProgress });
  const handlePlay = useCallback(
    (idx: number) => player.playFrom(idx),
    [player],
  );

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
      setSelection((s) => (s && text.length === 0 ? null : s));
      if (text.length === 0) setSelection(null);
      return;
    }
    let context = "";
    try {
      const node = sel.anchorNode;
      const el =
        node instanceof Element
          ? node.closest("[data-idx]")
          : node?.parentElement?.closest("[data-idx]") ?? null;
      const idx = el ? Number(el.getAttribute("data-idx")) : NaN;
      if (Number.isFinite(idx) && doc) {
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
    setSelection({ text, context });
  }, [doc]);

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

  const fontCls =
    prefs.font === "serif"
      ? "font-serif"
      : prefs.font === "mono"
        ? "font-mono"
        : prefs.font === "dyslexic"
          ? "font-dyslexic reader-dyslexic"
          : "font-readable";

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
          onClick={() => setShowFontPanel((v) => !v)}
          className={`rounded-lg p-2 ${showFontPanel ? "bg-zinc-200 dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
          aria-label="Reading appearance"
          title="Font & layout"
        >
          <Type size={19} />
        </button>
        <button
          onClick={() => setPrefs((p) => ({ ...p, rulerMode: !p.rulerMode }))}
          className={`rounded-lg p-2 ${prefs.rulerMode ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
          aria-label="Toggle reading ruler"
          title="Reading ruler (focus line)"
          aria-pressed={prefs.rulerMode}
        >
          <Focus size={19} />
        </button>
        <button
          onClick={() => addBookmark("")}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Bookmark current sentence"
          title="Bookmark current sentence"
        >
          <BookmarkPlus size={19} />
        </button>
        <button
          onClick={() => openAi("summary")}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Open AI assistant"
          title="AI assistant"
        >
          <Sparkles size={19} />
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
      </div>

      {showFontPanel && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 animate-fade-up sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Font
            </span>
            <select
              value={prefs.font}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, font: e.target.value as ReaderFont }))
              }
              className="w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Size: {prefs.fontSize}px
            </span>
            <input
              type="range"
              min={14}
              max={30}
              step={1}
              value={prefs.fontSize}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, fontSize: Number(e.target.value) }))
              }
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Line height: {prefs.lineHeight.toFixed(1)}
            </span>
            <input
              type="range"
              min={1.3}
              max={2.6}
              step={0.1}
              value={prefs.lineHeight}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, lineHeight: Number(e.target.value) }))
              }
              className="w-full"
            />
          </label>
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
        className={`${fontCls}${prefs.rulerMode ? " ruler-mode" : ""} space-y-2.5 rounded-xl border border-zinc-200 bg-white p-4 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900`}
        style={{ fontSize: prefs.fontSize, lineHeight: prefs.lineHeight }}
      >
        {doc.sentences.map((s) => (
          <SentenceItem
            key={s.idx}
            sentence={s}
            active={s.idx === player.currentIdx}
            near={Math.abs(s.idx - player.currentIdx) === 1}
            loading={s.idx === player.loadingIdx && player.status === "loading"}
            activeWord={s.idx === player.currentIdx ? player.currentWord : -1}
            onPlay={handlePlay}
          />
        ))}
      </div>

      <p className="mt-3 text-center text-xs text-zinc-400">
        Click any sentence to play from there · Select text, then open the AI
        assistant to explain it
      </p>

      <PlayerBar player={player} doc={doc} onOpenAI={() => openAi("summary")} />
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
        initialTab={aiTab}
      />
    </div>
  );
}
