"use client";

import { Loader2, Pencil, Play, Plus, Search, Trash2, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { PronunciationRule } from "@/lib/types";
import { Modal } from "./Modal";

const inputCls =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900";

function applyPreview(
  text: string,
  word: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (!word.trim()) return text;
  try {
    const pattern = `\\b${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;
    return text.replace(new RegExp(pattern, caseSensitive ? "g" : "gi"), replacement);
  } catch {
    return text;
  }
}

export function PronunciationModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewText, setPreviewText] = useState("The quick brown fox jumps over the lazy dog.");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    api
      .listPronunciations()
      .then((res) => {
        if (live) {
          setRules(res.rules);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Failed to load rules.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        r.word.toLowerCase().includes(q) ||
        r.replacement.toLowerCase().includes(q),
    );
  }, [rules, query]);

  function resetForm() {
    setEditingId(null);
    setWord("");
    setReplacement("");
    setCaseSensitive(false);
  }

  function startEdit(rule: PronunciationRule) {
    setEditingId(rule.id);
    setWord(rule.word);
    setReplacement(rule.replacement);
    setCaseSensitive(rule.caseSensitive);
  }

  async function save() {
    if (!word.trim() || !replacement.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.savePronunciation({
        id: editingId ?? undefined,
        word: word.trim(),
        replacement: replacement.trim(),
        caseSensitive,
      });
      setRules(res.rules);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rule.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this pronunciation rule?")) return;
    setError(null);
    try {
      await api.deletePronunciation(id);
      setRules((list) => list.filter((r) => r.id !== id));
      if (editingId === id) resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete rule.");
    }
  }

  async function preview(rule?: { word: string; replacement: string; caseSensitive: boolean }) {
    const r = rule ?? { word, replacement, caseSensitive };
    if (!r.word.trim() || !r.replacement.trim() || previewBusy) return;
    setPreviewBusy(true);
    setError(null);
    try {
      audioRef.current?.pause();
      const spoken = applyPreview(previewText, r.word, r.replacement, r.caseSensitive);
      const res = await api.tts({ text: spoken.slice(0, 1000) });
      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.src = res.url;
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <Modal title="Pronunciation Dictionary" onClose={onClose} wide>
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}

        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Teach VoxShelf how to say tricky words. Rules apply to every new
          synthesis — wrap a word in <code className="font-mono text-xs">/slashes/</code> to
          use a raw regex pattern.
        </p>

        <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {editingId ? "Edit rule" : "Add rule"}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="Word, e.g. read (or /regex/)"
              className={inputCls}
              aria-label="Word to replace"
            />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Say instead, e.g. red"
              className={inputCls}
              aria-label="Replacement pronunciation"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              Case sensitive
            </label>
            <span className="ml-auto flex gap-2">
              {editingId && (
                <button
                  onClick={resetForm}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => void preview()}
                disabled={previewBusy || !word.trim() || !replacement.trim()}
                className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                title="Hear the rule applied to the sample sentence"
              >
                {previewBusy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Volume2 size={13} />
                )}
                Preview
              </button>
              <button
                onClick={() => void save()}
                disabled={saving || !word.trim() || !replacement.trim()}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                {saving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Plus size={13} />
                )}
                {editingId ? "Save" : "Add rule"}
              </button>
            </span>
          </div>
          <input
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="Sample sentence for previews…"
            className={`${inputCls} mt-2`}
            aria-label="Sample sentence for TTS preview"
          />
        </div>

        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${rules.length} rule${rules.length === 1 ? "" : "s"}…`}
            className={`${inputCls} pl-9`}
            aria-label="Search rules"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" /> Loading rules…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {rules.length === 0
              ? "No rules yet — add one above."
              : `No rules match "${query.trim()}".`}
          </p>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {filtered.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{r.word}</span>
                  <span className="mx-1.5 text-zinc-400">→</span>
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {r.replacement}
                  </span>
                  {r.caseSensitive && (
                    <span className="ml-2 rounded-full bg-zinc-200 px-1.5 py-px text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      Aa
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void preview(r)}
                  disabled={previewBusy}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  title="Preview this rule"
                  aria-label={`Preview rule ${r.word}`}
                >
                  <Play size={15} />
                </button>
                <button
                  onClick={() => startEdit(r)}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  title="Edit rule"
                  aria-label={`Edit rule ${r.word}`}
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void remove(r.id)}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                  title="Delete rule"
                  aria-label={`Delete rule ${r.word}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
