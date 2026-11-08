"use client";

import { useRouter } from "next/navigation";
import {
  AudioLines,
  BarChart3,
  BookOpen,
  Keyboard,
  ListPlus,
  Loader2,
  Palette,
  Search,
  Settings,
  Upload,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { setAmbientPreset } from "@/lib/ambientAudio";
import { api } from "@/lib/client";
import { enqueueDocument } from "@/lib/queue";
import type { GlobalSearchHit } from "@/lib/types";
import { useTheme } from "./ThemeContext";

interface QuickCommand {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

function matchBadge(hit: GlobalSearchHit): string {
  if (hit.matchType === "title") return "Book Title";
  if (hit.matchType === "highlight") return "Highlight";
  return `Sentence #${hit.sentenceIdx + 1}`;
}

export function CommandPaletteModal({
  onClose,
  onOpenImport,
  onOpenBatchAudiobook,
  onOpenSettings,
  onOpenStats,
  onOpenShortcuts,
  onOpenTutorial,
}: {
  onClose: () => void;
  onOpenImport: (tab?: string) => void;
  onOpenBatchAudiobook: () => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  onOpenShortcuts: () => void;
  onOpenTutorial: () => void;
}) {
  const router = useRouter();
  const { setMode } = useTheme();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<QuickCommand[]>(
    () => [
      { id: "import", label: "Import Document / URL / RSS", icon: <Upload size={16} />, run: () => onOpenImport() },
      { id: "batch", label: "Batch Audiobook Studio (Books → Audiobooks)", icon: <AudioLines size={16} />, run: () => onOpenBatchAudiobook() },
      { id: "theme-carolina", label: "Theme: Carolina Blue", icon: <Palette size={16} />, run: () => setMode("carolina") },
      { id: "theme-dark", label: "Theme: Dark Mode", icon: <Palette size={16} />, run: () => setMode("dark") },
      { id: "theme-oled", label: "Theme: OLED Pure Black", icon: <Palette size={16} />, run: () => setMode("oled") },
      { id: "theme-light", label: "Theme: Light Mode", icon: <Palette size={16} />, run: () => setMode("light") },
      { id: "ambient-brown", label: "Ambient Focus Sound: Brown Noise", icon: <Waves size={16} />, run: () => setAmbientPreset("brown") },
      { id: "ambient-rain", label: "Ambient Focus Sound: Soft Rain", icon: <Waves size={16} />, run: () => setAmbientPreset("rain") },
      { id: "ambient-off", label: "Ambient Focus Sound: Turn Off", icon: <Waves size={16} />, run: () => setAmbientPreset("off") },
      { id: "stats", label: "Open Reading Stats", icon: <BarChart3 size={16} />, run: () => onOpenStats() },
      { id: "settings", label: "Open Settings & API Key", icon: <Settings size={16} />, run: () => onOpenSettings() },
      { id: "shortcuts", label: "Keyboard Shortcuts", icon: <Keyboard size={16} />, run: () => onOpenShortcuts() },
      { id: "tutorial", label: "Quickstart Guide", icon: <BookOpen size={16} />, run: () => onOpenTutorial() },
    ],
    [onOpenImport, onOpenBatchAudiobook, onOpenSettings, onOpenStats, onOpenShortcuts, onOpenTutorial, setMode],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let live = true;
    const t = window.setTimeout(() => {
      api
        .searchLibrary(q, 30)
        .then((r) => {
          if (live) setHits(r.hits);
        })
        .catch(() => {
          if (live) setHits([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    setSelected(0);
  }, [query, hits.length, filtered.length]);

  const total = filtered.length + hits.length;

  const runCommand = (cmd: QuickCommand) => {
    cmd.run();
    onClose();
  };

  const openHit = (hit: GlobalSearchHit) => {
    router.push(`/reader/${hit.docId}?s=${hit.sentenceIdx}`);
    onClose();
  };

  const queueHit = (hit: GlobalSearchHit) => {
    enqueueDocument({
      docId: hit.docId,
      title: hit.docTitle,
      author: hit.author,
      sentenceCount: 0,
    });
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (total === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selected < filtered.length) runCommand(filtered[selected]);
      else openHit(hits[selected - filtered.length]);
    }
  };

  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm ${
      active ? "bg-zinc-100 dark:bg-zinc-800" : ""
    }`;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mx-auto mt-[8vh] w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl animate-fade-up dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          {searching ? (
            <Loader2 size={18} className="shrink-0 animate-spin text-zinc-400" />
          ) : (
            <Search size={18} className="shrink-0 text-zinc-400" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search every sentence, highlight, book, or run a command..."
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-zinc-400"
            aria-label="Search library or run a command"
            role="combobox"
            aria-expanded={total > 0}
            aria-controls="cmd-palette-listbox"
            aria-activedescendant={total > 0 ? `cmd-opt-${selected}` : undefined}
          />
          <kbd className="hidden shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 sm:inline dark:border-zinc-700 dark:text-zinc-400">
            ESC
          </kbd>
        </div>

        <div id="cmd-palette-listbox" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {filtered.length > 0 && (
            <div role="group" aria-label="Commands">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Commands
              </p>
              {filtered.map((cmd, i) => (
                <button
                  key={cmd.id}
                  id={`cmd-opt-${i}`}
                  role="option"
                  aria-selected={selected === i}
                  onClick={() => runCommand(cmd)}
                  onMouseEnter={() => setSelected(i)}
                  className={rowClass(selected === i)}
                >
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{cmd.icon}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{cmd.label}</span>
                </button>
              ))}
            </div>
          )}

          {hits.length > 0 && (
            <div role="group" aria-label="Search results">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Library matches
              </p>
              {hits.map((hit, i) => {
                const idx = filtered.length + i;
                return (
                  <div
                    key={`${hit.docId}:${hit.sentenceIdx}:${hit.matchType}`}
                    id={`cmd-opt-${idx}`}
                    role="option"
                    aria-selected={selected === idx}
                    onClick={() => openHit(hit)}
                    onMouseEnter={() => setSelected(idx)}
                    className={`${rowClass(selected === idx)} cursor-pointer`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-semibold">{hit.docTitle}</span>
                        <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                          {matchBadge(hit)}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {hit.snippet}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        queueHit(hit);
                      }}
                      className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-zinc-300 px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      aria-label={`Queue ${hit.docTitle}`}
                      title="Add to listening queue"
                    >
                      <ListPlus size={14} /> Queue
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {total === 0 && (
            <p className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {query.trim().length >= 2 && !searching
                ? "No matches. Try fewer words, or pick a command above."
                : "Type at least 2 characters to search, or pick a command."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
