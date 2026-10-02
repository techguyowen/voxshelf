"use client";

import { Expand, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearNowPlaying,
  getEngine,
  getNowPlaying,
  subscribe,
  type NowPlayingMeta,
} from "@/lib/globalPlayer";
import { haptic } from "@/lib/haptics";

export function FloatingMiniPlayer() {
  const pathname = usePathname();
  const [meta, setMeta] = useState<NowPlayingMeta | null>(() =>
    typeof window === "undefined" ? null : getNowPlaying(),
  );

  useEffect(() => subscribe(setMeta), []);

  if (!meta) return null;
  // The full reader is visible — no need for the mini-player.
  if (pathname === `/reader/${meta.docId}`) return null;

  const engine = getEngine()?.docId === meta.docId ? getEngine()?.controls : null;
  const playing = meta.status === "playing";
  const pct =
    meta.sentenceCount > 0
      ? Math.min(100, ((meta.sentenceIdx + meta.clipProgress) / meta.sentenceCount) * 100)
      : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-200 bg-white/95 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
        <div
          className="h-0.5 w-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall progress"
        >
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            onClick={() => {
              haptic();
              engine?.skip(-15);
            }}
            className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Back 15 seconds"
            title="Back 15s"
          >
            <RotateCcw size={18} />
          </button>
          <button
            onClick={() => {
              haptic();
              engine?.toggle();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={19} /> : <Play size={19} className="ml-0.5" />}
          </button>
          <button
            onClick={() => {
              haptic();
              engine?.skip(15);
            }}
            className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Forward 15 seconds"
            title="Forward 15s"
          >
            <RotateCw size={18} />
          </button>

          <div className="ml-1 min-w-0 flex-1">
            <p className="truncate text-xs font-semibold leading-tight">
              {meta.title}
              <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-px text-[10px] font-bold tabular-nums text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                {meta.speed.toFixed(1)}×
              </span>
            </p>
            <p className="truncate text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
              S{meta.sentenceIdx + 1}/{meta.sentenceCount} · {meta.snippet}
            </p>
          </div>

          <Link
            href={`/reader/${meta.docId}`}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            title="Expand reader"
          >
            <Expand size={13} />
            <span className="hidden sm:inline">Reader</span>
          </Link>
          <button
            onClick={() => clearNowPlaying()}
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Dismiss mini player"
            title="Stop and dismiss"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
