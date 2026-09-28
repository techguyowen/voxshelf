"use client";

import {
  Bookmark as BookmarkIcon,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Bookmark, DocumentDetail } from "@/lib/types";

type DrawerTab = "summary" | "explain" | "bookmarks";

export interface TextSelection {
  text: string;
  context: string;
}

export function AIDrawer({
  open,
  onClose,
  doc,
  currentIdx,
  selection,
  bookmarks,
  onJump,
  onAddBookmark,
  onDeleteBookmark,
}: {
  open: boolean;
  onClose: () => void;
  doc: DocumentDetail;
  currentIdx: number;
  selection: TextSelection | null;
  bookmarks: Bookmark[];
  onJump: (idx: number) => void;
  onAddBookmark: (note: string) => void;
  onDeleteBookmark: (id: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("summary");
  const [summary, setSummary] = useState("");
  const [summaryLen, setSummaryLen] = useState<"short" | "detailed">("short");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [explainBusy, setExplainBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    setSummary("");
    setExplanation("");
    setError(null);
  }, [doc.id]);

  // When the user selects new text while the drawer is open, switch to Explain.
  useEffect(() => {
    if (open && selection) setTab("explain");
  }, [open, selection]);

  async function generateSummary() {
    setSummaryBusy(true);
    setError(null);
    try {
      const out = await api.summarize({
        documentId: doc.id,
        length: summaryLen,
      });
      setSummary(out.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summary failed.");
    } finally {
      setSummaryBusy(false);
    }
  }

  async function explain() {
    if (!selection) return;
    setExplainBusy(true);
    setError(null);
    try {
      const out = await api.explain(selection.text, selection.context);
      setExplanation(out.explanation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Explanation failed.");
    } finally {
      setExplainBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="AI assistant">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl animate-fade-up dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Sparkles size={17} className="text-emerald-600 dark:text-emerald-400" />
            AI Assistant
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Close assistant"
          >
            <X size={19} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {(
            [
              { id: "summary", label: "Summary" },
              { id: "explain", label: "Explain" },
              { id: "bookmarks", label: `Bookmarks (${bookmarks.length})` },
            ] as { id: DrawerTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === t.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          {tab === "summary" && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                One-click summary of “{doc.title}”.
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={summaryLen}
                  onChange={(e) => setSummaryLen(e.target.value as "short" | "detailed")}
                  className="rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="short">Short</option>
                  <option value="detailed">Detailed</option>
                </select>
                <button
                  onClick={() => void generateSummary()}
                  disabled={summaryBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                >
                  {summaryBusy && <Loader2 size={15} className="animate-spin" />}
                  {summary ? "Regenerate" : "Summarize"}
                </button>
              </div>
              {summaryBusy && !summary ? (
                <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
                  <Loader2 className="animate-spin" size={16} /> Reading document…
                </div>
              ) : summary ? (
                <div className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-sm leading-relaxed dark:bg-zinc-800/60">
                  {summary}
                </div>
              ) : null}
            </div>
          )}

          {tab === "explain" && (
            <div className="space-y-3">
              {selection ? (
                <>
                  <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      Selected
                    </p>
                    <p className="mt-1 text-sm font-medium">“{selection.text}”</p>
                  </div>
                  <button
                    onClick={() => void explain()}
                    disabled={explainBusy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {explainBusy && <Loader2 size={15} className="animate-spin" />}
                    Explain this
                  </button>
                  {explanation && (
                    <div className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-sm leading-relaxed dark:bg-zinc-800/60">
                      {explanation}
                    </div>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Select any word or phrase in the reader, then come back here
                  for an instant explanation.
                </p>
              )}
            </div>
          )}

          {tab === "bookmarks" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={`Note for sentence ${currentIdx + 1} (optional)`}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  onClick={() => {
                    onAddBookmark(note);
                    setNote("");
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <BookmarkIcon size={14} /> Add
                </button>
              </div>
              {bookmarks.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No bookmarks yet. Bookmark the sentence you’re on to find it
                  again later.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bookmarks.map((b) => (
                    <li
                      key={b.id}
                      className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <button
                        onClick={() => onJump(b.sentenceIdx)}
                        className="block w-full text-left"
                      >
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Sentence {b.sentenceIdx + 1}
                        </p>
                        {b.note && (
                          <p className="mt-0.5 text-sm font-medium">{b.note}</p>
                        )}
                        {b.sentencePreview && (
                          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                            {b.sentencePreview}
                          </p>
                        )}
                      </button>
                      <div className="mt-1.5 flex justify-end">
                        <button
                          onClick={() => onDeleteBookmark(b.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
