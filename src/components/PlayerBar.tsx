"use client";

import {
  ChevronDown,
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { DocumentDetail, VoiceInfo } from "@/lib/types";
import type { Player } from "@/hooks/usePlayer";

function formatSleep(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerBar({
  player,
  doc,
  onOpenAI,
}: {
  player: Player;
  doc: DocumentDetail;
  onOpenAI: () => void;
}) {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [styleDraft, setStyleDraft] = useState(player.stylePrompt);

  useEffect(() => {
    api
      .voices()
      .then((v) => setVoices(v.voices))
      .catch(() => setVoices([]));
  }, []);

  useEffect(() => {
    setStyleDraft(player.stylePrompt);
  }, [player.stylePrompt]);

  const total = doc.sentenceCount;
  const overall =
    total <= 0
      ? 0
      : Math.min(100, ((player.currentIdx + player.clipProgress) / total) * 100);
  const playing = player.status === "playing";
  const busy = player.status === "loading";

  const iconBtn =
    "rounded-full p-2.5 text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div
        className="h-1 w-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={Math.round(overall)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Overall progress"
      >
        <div
          className="h-full bg-emerald-500 transition-[width]"
          style={{ width: `${overall}%` }}
        />
      </div>

      <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2">
        {player.error && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <span className="flex-1 truncate">{player.error}</span>
            <button
              onClick={player.dismissError}
              className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900"
              aria-label="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button onClick={player.prev} className={iconBtn} aria-label="Previous sentence" title="Previous sentence">
            <SkipBack size={20} />
          </button>
          <button
            onClick={() => void player.skip(-15)}
            className={`${iconBtn} relative`}
            aria-label="Back 15 seconds"
            title="Back 15s"
          >
            <RotateCcw size={21} />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold">
              15
            </span>
          </button>
          <button
            onClick={player.toggle}
            className="mx-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-70 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
          >
            {busy ? (
              <Loader2 size={22} className="animate-spin" />
            ) : playing ? (
              <Pause size={22} />
            ) : (
              <Play size={22} className="ml-0.5" />
            )}
          </button>
          <button
            onClick={() => void player.skip(15)}
            className={`${iconBtn} relative`}
            aria-label="Forward 15 seconds"
            title="Forward 15s"
          >
            <RotateCw size={21} />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold">
              15
            </span>
          </button>
          <button onClick={player.next} className={iconBtn} aria-label="Next sentence" title="Next sentence">
            <SkipForward size={20} />
          </button>

          <div className="ml-1 min-w-0 flex-1">
            <p className="truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {busy && player.loadingIdx !== null
                ? `Synthesizing ${player.loadingIdx + 1}…`
                : `Sentence ${player.currentIdx + 1} / ${total.toLocaleString()}`}
              {player.sleepLeft !== null && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                  <Timer size={11} />
                  {formatSleep(player.sleepLeft)}
                </span>
              )}
            </p>
            <p className="truncate text-xs font-medium">
              {doc.sentences[player.currentIdx]?.text.slice(0, 80) || doc.title}
            </p>
          </div>

          <button
            onClick={() => setExpanded((v) => !v)}
            className={`${iconBtn} shrink-0`}
            aria-label={expanded ? "Hide player options" : "Show player options"}
            aria-expanded={expanded}
          >
            <ChevronDown
              size={20}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <span className="w-10 shrink-0 text-xs font-semibold tabular-nums">
            {player.speed.toFixed(1)}×
          </span>
          <input
            type="range"
            min={0.5}
            max={4.5}
            step={0.1}
            value={player.speed}
            onChange={(e) => player.setSpeed(Number(e.target.value))}
            className="min-w-0 flex-1"
            aria-label="Playback speed"
          />
          <select
            value={player.voice}
            onChange={(e) => player.setVoice(e.target.value)}
            className="w-32 shrink-0 rounded-lg border border-zinc-300 px-1.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 sm:w-40"
            aria-label="Voice"
            title="Narration voice"
          >
            {voices.length === 0 && <option>{player.voice}</option>}
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} · {v.description}
              </option>
            ))}
          </select>
        </div>

        {expanded && (
          <div className="mt-2 space-y-2 border-t border-zinc-200 pt-2 animate-fade-up dark:border-zinc-800">
            <input
              value={styleDraft}
              onChange={(e) => setStyleDraft(e.target.value)}
              onBlur={() => player.setStylePrompt(styleDraft.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  player.setStylePrompt(styleDraft.trim());
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Style prompt (e.g. “warm bedtime-story voice”) — applies to new sentences"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Narration style prompt"
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                <Timer size={14} />
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    player.setSleep(v === "" ? null : Number(v));
                    e.target.value = "";
                  }}
                  className="rounded-lg border border-zinc-300 px-1.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label="Sleep timer"
                >
                  <option value="">
                    {player.sleepLeft !== null
                      ? `Sleep ${formatSleep(player.sleepLeft)}`
                      : "Sleep timer"}
                  </option>
                  <option value="5">5 min</option>
                  <option value="10">10 min</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">60 min</option>
                  <option value="90">90 min</option>
                </select>
              </label>
              {player.sleepLeft !== null && (
                <button
                  onClick={() => player.setSleep(null)}
                  className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              )}
              <a
                href={`/api/documents/${doc.id}/audio?download=1&voice=${encodeURIComponent(player.voice)}&style=${encodeURIComponent(player.stylePrompt)}`}
                className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                title="Download the whole document as one WAV file"
              >
                <Download size={13} /> Audio
              </a>
              <button
                onClick={onOpenAI}
                className="ml-auto flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                <Sparkles size={13} /> AI Assistant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
