"use client";

import { AudioLines, BarChart3, Keyboard, Lock, Moon, Plus, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useUI } from "./AppShell";
import { useTheme } from "./ThemeContext";

export function Header({
  onImport,
  onSettings,
  onShortcuts,
  settingsRev,
}: {
  onImport: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  settingsRev: number;
}) {
  const { theme, toggle } = useTheme();
  const { openStats } = useUI();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .settings()
      .then((s) => {
        if (live) setHasKey(s.hasApiKey);
      })
      .catch(() => {
        if (live) setHasKey(null);
      });
    api
      .authStatus()
      .then((s) => {
        if (live) setLocked(s.locked);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [settingsRev]);

  async function lockNow() {
    try {
      await api.authLogout();
    } catch {
      // Cookie may already be gone; reloading still re-locks the UI.
    }
    window.location.reload();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="VoxShelf home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950">
            <AudioLines size={18} strokeWidth={2.5} />
          </span>
          <span className="text-lg font-bold tracking-tight">
            VoxShelf
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Library
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            onClick={onSettings}
            title={
              hasKey === null
                ? "Checking API status…"
                : hasKey
                  ? "Gemini API key configured"
                  : "No Gemini API key — click to add one"
            }
            className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                hasKey === null
                  ? "bg-zinc-400"
                  : hasKey
                    ? "bg-emerald-500"
                    : "bg-amber-500"
              }`}
            />
            <span className="hidden sm:inline">
              {hasKey === null ? "API…" : hasKey ? "API ready" : "No API key"}
            </span>
          </button>

          <button
            onClick={toggle}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </button>

          <button
            onClick={onShortcuts}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={19} />
          </button>

          <button
            onClick={openStats}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Reading stats"
            title="Reading stats"
          >
            <BarChart3 size={19} />
          </button>

          <button
            onClick={onSettings}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={19} />
          </button>

          {locked && (
            <button
              onClick={() => void lockNow()}
              className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Lock now"
              title="Lock now (clears this browser's access)"
            >
              <Lock size={19} />
            </button>
          )}

          <button
            onClick={onImport}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            <Plus size={17} strokeWidth={2.5} />
            <span className="hidden sm:inline">Import</span>
          </button>
        </div>
      </div>
    </header>
  );
}
