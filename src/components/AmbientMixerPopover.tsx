"use client";

import { Waves } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getAmbientState,
  setAmbientPreset,
  setAmbientSyncWithPlayback,
  setAmbientVolume,
  subscribeAmbient,
} from "@/lib/ambientAudio";
import type { AmbientPreset, AmbientState } from "@/lib/types";

const PRESETS: { id: AmbientPreset; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "brown", label: "Brown Noise" },
  { id: "pink", label: "Pink Noise" },
  { id: "rain", label: "Soft Rain" },
  { id: "warm-drone", label: "Warm Drone" },
];

export function AmbientMixerButton({ iconBtnClass }: { iconBtnClass?: string }) {
  const [state, setState] = useState<AmbientState>(() => getAmbientState());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeAmbient(setState), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const active = state.preset !== "off";
  const btn =
    iconBtnClass ??
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2.5 text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`${btn} relative ${active ? "text-sky-600 dark:text-sky-400" : ""}`}
        aria-label="Ambient focus sounds"
        title="Ambient focus sounds"
        aria-expanded={open}
        aria-pressed={active}
      >
        <Waves size={20} />
        {active && (
          <span
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sky-500"
            aria-hidden="true"
          />
        )}
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          role="dialog"
          aria-label="Ambient sound mixer"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Ambient soundscape
          </p>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setAmbientPreset(p.id)}
                aria-pressed={state.preset === p.id}
                className={`min-h-[44px] rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                  state.preset === p.id
                    ? "border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                    : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(state.volume * 100)}
              onChange={(e) => setAmbientVolume(Number(e.target.value) / 100)}
              className="h-11 min-w-0 flex-1 cursor-pointer"
              aria-label="Ambient volume"
            />
            <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">
              {Math.round(state.volume * 100)}%
            </span>
          </div>
          <label className="mt-1 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.syncWithPlayback}
              onChange={(e) => setAmbientSyncWithPlayback(e.target.checked)}
              className="h-4 w-4 accent-sky-600"
            />
            <span>Sync with voice playback</span>
          </label>
        </div>
      )}
    </div>
  );
}
