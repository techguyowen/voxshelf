"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  Volume2,
  X,
} from "lucide-react";
import type { DocumentDetail } from "@/lib/types";

interface RSVPModalProps {
  doc: DocumentDetail;
  currentSentenceIdx: number;
  isPlayingAudio?: boolean;
  onSeekSentence: (sentenceIdx: number) => void;
  onClose: () => void;
}

const MIN_WPM = 150;
const MAX_WPM = 1000;
const DEFAULT_WPM = 350;
const WPM_PRESETS = [250, 350, 450, 600, 800];
const WPM_STEP = 25;
const WORD_SKIP = 10;

/** Optimal Recognition Point: the letter the eye fixates on for a word length. */
export function orpIndex(wordLength: number): number {
  if (wordLength <= 1) return 0;
  if (wordLength <= 5) return 1;
  if (wordLength <= 9) return 2;
  if (wordLength <= 13) return 3;
  return 4;
}

/** Slight extra dwell time on punctuation so phrasing stays natural. */
function punctuationMultiplier(word: string): number {
  const m = word.match(/[.!?,](?=["'”’)\]]*$)/);
  if (!m) return 1;
  return m[0] === "," ? 1.3 : 1.6;
}

function delayForWord(word: string, wpm: number): number {
  return (60000 / wpm) * punctuationMultiplier(word);
}

interface Token {
  word: string;
  sentenceIdx: number;
  wordInSentence: number;
}

/** ORP word: prefix muted, ORP letter emerald, suffix bold, ORP dead-center. */
function ORPWord({ word }: { word: string }) {
  const idx = Math.min(orpIndex(word.length), Math.max(0, word.length - 1));
  const prefix = word.slice(0, idx);
  const orp = word[idx] ?? "";
  const suffix = word.slice(idx + 1);
  return (
    <div
      aria-live="off"
      className="flex w-full items-baseline justify-center font-mono text-5xl leading-none tracking-tight sm:text-6xl"
    >
      <span className="w-1/2 shrink-0 truncate text-right font-normal text-zinc-400 dark:text-zinc-500">
        {prefix || "\u00a0"}
      </span>
      <span className="shrink-0 font-bold text-emerald-500">{orp || "\u00a0"}</span>
      <span className="w-1/2 shrink-0 truncate text-left font-bold text-zinc-900 dark:text-zinc-50">
        {suffix || "\u00a0"}
      </span>
    </div>
  );
}

export function RSVPModal({
  doc,
  currentSentenceIdx,
  isPlayingAudio,
  onSeekSentence,
  onClose,
}: RSVPModalProps) {
  const tokens: Token[] = useMemo(
    () =>
      doc.sentences.flatMap((s) =>
        s.text
          .split(/\s+/)
          .filter(Boolean)
          .map((word, wordInSentence) => ({
            word,
            sentenceIdx: s.idx,
            wordInSentence,
          })),
      ),
    [doc],
  );

  const sentenceOrder = useMemo(
    () => [...new Set(tokens.map((t) => t.sentenceIdx))].sort((a, b) => a - b),
    [tokens],
  );

  const startPos = useMemo(() => {
    if (tokens.length === 0) return 0;
    const exact = tokens.findIndex((t) => t.sentenceIdx === currentSentenceIdx);
    if (exact !== -1) return exact;
    const after = tokens.findIndex((t) => t.sentenceIdx > currentSentenceIdx);
    return after !== -1 ? after : 0;
  }, [tokens, currentSentenceIdx]);

  const [pos, setPos] = useState(startPos);
  const [playing, setPlaying] = useState(tokens.length > 0);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const contextRef = useRef<HTMLDivElement>(null);

  const total = tokens.length;
  const cur = total > 0 ? tokens[Math.min(pos, total - 1)] : null;
  const sentencePos = cur ? sentenceOrder.indexOf(cur.sentenceIdx) : -1;

  const overallPct =
    total === 0 ? 0 : Math.min(100, ((Math.min(pos, total - 1) + 1) / total) * 100);
  const sentencePct =
    sentenceOrder.length <= 1 || sentencePos < 0
      ? 0
      : Math.min(100, (sentencePos / (sentenceOrder.length - 1)) * 100);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Word-advance timer. Re-arms each word so WPM/punctuation changes apply instantly.
  useEffect(() => {
    if (!playing || !cur) return;
    if (pos >= total - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(
      () => setPos((p) => Math.min(p + 1, total - 1)),
      delayForWord(cur.word, wpm),
    );
    return () => clearTimeout(t);
  }, [playing, pos, wpm, cur, total]);

  const moveWords = (delta: number) =>
    setPos((p) => Math.min(total - 1, Math.max(0, p + delta)));

  const moveSentence = (delta: 1 | -1) => {
    if (!cur || sentenceOrder.length === 0) return;
    if (delta === -1 && cur.wordInSentence > 0) {
      // First stop: start of the current sentence.
      const first = tokens.findIndex((t) => t.sentenceIdx === cur.sentenceIdx);
      if (first !== -1) {
        setPos(first);
        return;
      }
    }
    const targetOrder = Math.min(
      sentenceOrder.length - 1,
      Math.max(0, sentencePos + delta),
    );
    const first = tokens.findIndex(
      (t) => t.sentenceIdx === sentenceOrder[targetOrder],
    );
    if (first !== -1) setPos(first);
  };

  const adjustWpm = (delta: number) =>
    setWpm((w) => Math.min(MAX_WPM, Math.max(MIN_WPM, w + delta)));

  const exit = () => {
    if (cur) onSeekSentence(cur.sentenceIdx);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exit();
        return;
      }
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
          setPlaying((p) => (pos >= total - 1 ? false : !p));
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) moveSentence(-1);
          else moveWords(-WORD_SKIP);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) moveSentence(1);
          else moveWords(WORD_SKIP);
          break;
        case "[":
          e.preventDefault();
          adjustWpm(-WPM_STEP);
          break;
        case "]":
          e.preventDefault();
          adjustWpm(WPM_STEP);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, total, wpm, cur, sentencePos, tokens, sentenceOrder]);

  // Keep the active word visible in the context bar.
  useEffect(() => {
    contextRef.current
      ?.querySelector("[data-active-word]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pos]);

  const sentenceWords = useMemo(() => {
    if (!cur) return [];
    const s = doc.sentences.find((x) => x.idx === cur.sentenceIdx);
    if (!s) return [];
    return s.text.split(/\s+/).filter(Boolean);
  }, [doc, cur]);

  const ended = total > 0 && pos >= total - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Speed Reader"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4"
      onClick={exit}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-bold">Speed Reader</h2>
          {isPlayingAudio && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
              <Volume2 size={12} />
              Audio playing
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {sentenceOrder.length > 0 && sentencePos >= 0
              ? `Sentence ${sentencePos + 1} of ${sentenceOrder.length}`
              : "No sentences"}
          </span>
          <button
            onClick={exit}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Close Speed Reader"
            title="Close and return to reader (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress bars */}
        <div className="space-y-1.5 px-4 pt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="progressbar"
            aria-label="Document progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overallPct)}
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
            <span>{overallPct.toFixed(1)}% of document</span>
            <span>
              {total > 0 ? `Word ${Math.min(pos, total - 1) + 1} of ${total}` : "0 words"}
              {" · "}
              {sentencePct.toFixed(0)}% sentences
            </span>
          </div>
        </div>

        {/* ORP stage */}
        <div className="px-4 py-6 sm:px-8">
          {cur ? (
            <div className="relative rounded-lg bg-zinc-50 py-6 dark:bg-zinc-950/60">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-zinc-200 dark:bg-zinc-800" />
              <div className="mb-4 flex justify-center">
                <span className="h-2.5 w-1 rounded-full bg-emerald-500" aria-hidden="true" />
              </div>
              <ORPWord word={cur.word} />
              <div className="mt-4 flex justify-center">
                <span className="h-2.5 w-1 rounded-full bg-emerald-500" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-zinc-50 py-10 text-center text-sm text-zinc-500 dark:bg-zinc-950/60 dark:text-zinc-400">
              This document has no words to read.
            </p>
          )}
        </div>

        {/* Sentence context */}
        {cur && (
          <div className="px-4 pb-2 sm:px-8">
            <div
              ref={contextRef}
              className="max-h-24 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-950/60"
              aria-label="Current sentence"
            >
              {sentenceWords.map((w, i) => (
                <span key={i}>
                  <span
                    {...(i === cur.wordInSentence ? { "data-active-word": true } : {})}
                    className={
                      i === cur.wordInSentence
                        ? "rounded bg-emerald-500/25 px-0.5 font-semibold text-emerald-700 dark:text-emerald-300"
                        : undefined
                    }
                  >
                    {w}
                  </span>{" "}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Transport */}
        <div className="flex items-center justify-center gap-1 px-4 py-3">
          <button
            onClick={() => moveSentence(-1)}
            disabled={total === 0}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Back one sentence"
            title="Back one sentence (Shift+Left)"
          >
            <ChevronsLeft size={20} />
          </button>
          <button
            onClick={() => moveWords(-WORD_SKIP)}
            disabled={total === 0}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label={`Back ${WORD_SKIP} words`}
            title={`Back ${WORD_SKIP} words (Left)`}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => {
              if (ended) setPos(0);
              setPlaying((p) => (ended ? true : !p));
            }}
            disabled={total === 0}
            className="mx-1 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
            aria-label={playing ? "Pause" : "Play"}
            title="Play/Pause (Space)"
          >
            {playing ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
          </button>
          <button
            onClick={() => moveWords(WORD_SKIP)}
            disabled={total === 0}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label={`Forward ${WORD_SKIP} words`}
            title={`Forward ${WORD_SKIP} words (Right)`}
          >
            <ChevronRight size={20} />
          </button>
          <button
            onClick={() => moveSentence(1)}
            disabled={total === 0}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200/60 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Forward one sentence"
            title="Forward one sentence (Shift+Right)"
          >
            <ChevronsRight size={20} />
          </button>
        </div>

        {/* Speed */}
        <div className="space-y-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-8">
          <div className="flex items-center gap-3">
            <label
              htmlFor="rsvp-wpm"
              className="text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300"
            >
              {wpm} WPM
            </label>
            <input
              id="rsvp-wpm"
              type="range"
              min={MIN_WPM}
              max={MAX_WPM}
              step={WPM_STEP}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              className="flex-1 accent-emerald-600"
              aria-label="Words per minute"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {WPM_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setWpm(p)}
                aria-pressed={wpm === p}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                  wpm === p
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {p}
              </button>
            ))}
            <span className="ml-auto hidden text-[11px] text-zinc-400 dark:text-zinc-500 sm:inline">
              Space play/pause · ←/→ ±10 words · Shift+←/→ ±1 sentence · [ ] speed ·
              Esc exit
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
