"use client";

import { ListOrdered, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { chapterStatus, detectChapters } from "@/lib/toc";
import type { Sentence } from "@/lib/types";

// Re-export the detection helpers so callers can import everything chapter
// related from the drawer module.
export { chapterStatus, detectChapters } from "@/lib/toc";
export type { Chapter } from "@/lib/toc";

const STATUS_GLYPH: Record<"done" | "current" | "upcoming", string> = {
  done: "✓",
  current: "●",
  upcoming: "○",
};

const STATUS_CLS: Record<"done" | "current" | "upcoming", string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  current: "text-sky-600 dark:text-sky-400",
  upcoming: "text-zinc-400 dark:text-zinc-500",
};

/**
 * Slide-over Table of Contents drawer: detected chapters/sections with read
 * progress status, sentence index and word count. Clicking a chapter jumps
 * straight to its first sentence.
 */
export function TOCDrawer({
  open,
  onClose,
  sentences,
  currentIdx,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  sentences: Sentence[];
  currentIdx: number;
  onJump: (sentenceIdx: number) => void;
}) {
  const chapters = useMemo(() => detectChapters(sentences), [sentences]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Table of contents"
    >
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-sm flex-col bg-white shadow-2xl animate-slide-in-right dark:bg-zinc-950">
        <div className="flex items-center gap-2.5 border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-lg dark:bg-emerald-950">
            <span role="img" aria-label="Table of contents">
              📑
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 text-base font-semibold">
              <ListOrdered size={17} className="shrink-0 text-zinc-400" />
              Table of Contents
            </h2>
            <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {chapters.length} chapter{chapters.length === 1 ? "" : "s"} ·{" "}
              {sentences.length.toLocaleString()} sentences
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close table of contents"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {chapters.map((c) => {
            const status = chapterStatus(c, currentIdx);
            const active = status === "current";
            return (
              <button
                key={c.index}
                onClick={() => onJump(c.sentenceIdx)}
                className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/50 dark:hover:bg-sky-950"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
                title={`Jump to sentence ${c.sentenceIdx + 1}`}
              >
                <span
                  className={`mt-0.5 shrink-0 text-sm font-bold tabular-nums ${STATUS_CLS[status]}`}
                  aria-label={
                    status === "done"
                      ? "Finished"
                      : status === "current"
                        ? "Currently reading"
                        : "Not started"
                  }
                >
                  {STATUS_GLYPH[status]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {c.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    Sentence {(c.sentenceIdx + 1).toLocaleString()} ·{" "}
                    {c.wordCount.toLocaleString()} word
                    {c.wordCount === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-zinc-200 px-4 py-2.5 text-center text-[11px] text-zinc-400 dark:border-zinc-800">
          <span className="text-emerald-600 dark:text-emerald-400">✓</span>{" "}
          finished
          {" · "}
          <span className="text-sky-600 dark:text-sky-400">●</span> current
          {" · "}
          <span>○</span> upcoming — press{" "}
          <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            T
          </kbd>{" "}
          to toggle
        </div>
      </aside>
    </div>
  );
}
