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
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { getSharedAudio } from "@/lib/globalPlayer";
import { haptic } from "@/lib/haptics";
import {
  VOLUME_CHANGE_EVENT,
  loadMuted,
  loadVolume,
  saveMuted,
  saveVolume,
} from "@/lib/volume";
import { VoicePreviewButton } from "./VoicePreviewButton";
import {
  cumulativeWordCounts,
  formatTimeLeftBadge,
  wordsRemainingFrom,
} from "@/lib/readingTime";
import type { DocumentDetail, VoiceInfo } from "@/lib/types";
import type { Player } from "@/hooks/usePlayer";

function formatSleep(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const SPEED_STEPS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

const STYLE_PRESETS: { label: string; prompt: string }[] = [
  { label: "🎙️ Documentary Narrator", prompt: "Deep, authoritative, cinematic documentary narrator" },
  { label: "🌙 Bedtime Story", prompt: "Warm, gentle, soothing, calm bedtime story tone" },
  { label: "⚡ Energetic News", prompt: "Crisp, engaging, fast-paced news broadcast voice" },
  { label: "💼 Tech Lecturer", prompt: "Clear, precise, professional academic lecture pace" },
  { label: "🎭 Dramatic Story", prompt: "Expressive, rich, emotive storytelling with vocal range" },
];

/** Animated 3-bar equalizer shown while audio is playing. */
function Equalizer() {
  return (
    <span className="vf-eq" aria-hidden="true">
      <span className="vf-eq-bar" style={{ animationDelay: "0ms" }} />
      <span className="vf-eq-bar" style={{ animationDelay: "0.22s" }} />
      <span className="vf-eq-bar" style={{ animationDelay: "0.44s" }} />
    </span>
  );
}

/**
 * Volume icon button with a hover/touch popover slider (0-100%). Clicking
 * the icon toggles mute; dragging the slider sets the shared audio element's
 * volume. Both persist to localStorage.
 */
function VolumeControl({ iconBtn }: { iconBtn: string }) {
  const [volume, setVolume] = useState<number>(() =>
    typeof window === "undefined" ? 1 : loadVolume(),
  );
  const [muted, setMuted] = useState<boolean>(() =>
    typeof window === "undefined" ? false : loadMuted(),
  );
  const [open, setOpen] = useState(false);
  const lastAudible = useRef(volume > 0 ? volume : 0.8);

  useEffect(() => {
    setVolume(loadVolume());
    setMuted(loadMuted());
  }, []);

  // External mute toggles (e.g. the "M" keyboard shortcut) sync back here.
  useEffect(() => {
    const sync = () => {
      setVolume(loadVolume());
      setMuted(loadMuted());
    };
    window.addEventListener(VOLUME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(VOLUME_CHANGE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (volume > 0) lastAudible.current = volume;
    const audio = getSharedAudio();
    if (audio) {
      try {
        audio.volume = volume;
        audio.muted = muted;
      } catch {
        // ignore
      }
    }
    saveVolume(volume);
    saveMuted(muted);
  }, [volume, muted]);

  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const toggleMute = () => {
    haptic();
    if (muted || volume === 0) {
      // Unmute: restore the last audible level when sitting at zero.
      if (volume === 0) setVolume(lastAudible.current);
      setMuted(false);
    } else {
      setMuted(true);
    }
  };

  const onIconClick = () => {
    // Touch devices have no hover: the first tap reveals the slider instead
    // of instantly muting, so the popover stays reachable.
    const touchOnly =
      typeof window !== "undefined" &&
      window.matchMedia("(hover: none)").matches;
    if (touchOnly && !open) {
      setOpen(true);
      return;
    }
    toggleMute();
  };

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={onIconClick}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={iconBtn}
        aria-label={silent ? "Unmute" : "Mute"}
        title={silent ? "Unmute" : "Mute"}
        aria-expanded={open}
      >
        <Icon size={20} />
      </button>
      <div
        className={`absolute bottom-full right-0 mb-1 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-xl transition-opacity dark:border-zinc-700 dark:bg-zinc-900 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        role="group"
        aria-label="Volume"
      >
        <Icon size={16} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(volume * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVolume(v);
            if (v > 0) setMuted(false);
          }}
          className="h-11 w-28 cursor-pointer"
          aria-label="Volume"
          aria-valuetext={`${Math.round(volume * 100)} percent${muted ? ", muted" : ""}`}
          tabIndex={open ? 0 : -1}
        />
        <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
          {muted ? "Muted" : `${Math.round(volume * 100)}%`}
        </span>
      </div>
    </div>
  );
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

  const sentenceWordCum = useMemo(
    () => cumulativeWordCounts(doc.sentences.map((s) => s.text)),
    [doc],
  );
  const wordsLeft = wordsRemainingFrom(
    sentenceWordCum,
    player.currentIdx,
    player.clipProgress,
  );
  const timeLeftLabel = formatTimeLeftBadge(wordsLeft, player.speed);

  const iconBtn =
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2.5 text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800";

  const currentTone =
    voices.find((v) => v.name === player.voice)?.description ?? "";

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

      <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
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
          <button
            onClick={() => {
              haptic();
              player.prev();
            }}
            className={iconBtn}
            aria-label="Previous sentence"
            title="Previous sentence"
          >
            <SkipBack size={20} />
          </button>
          <button
            onClick={() => {
              haptic();
              void player.skip(-15);
            }}
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
            onClick={() => {
              haptic();
              player.toggle();
            }}
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
            onClick={() => {
              haptic();
              void player.skip(15);
            }}
            className={`${iconBtn} relative`}
            aria-label="Forward 15 seconds"
            title="Forward 15s"
          >
            <RotateCw size={21} />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-0.5 text-[8px] font-bold">
              15
            </span>
          </button>
          <button
            onClick={() => {
              haptic();
              player.next();
            }}
            className={iconBtn}
            aria-label="Next sentence"
            title="Next sentence"
          >
            <SkipForward size={20} />
          </button>

          <div className="ml-1 min-w-0 flex-1">
            <p className="truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {busy && player.loadingIdx !== null
                ? `Synthesizing ${player.loadingIdx + 1}…`
                : `Sentence ${player.currentIdx + 1} / ${total.toLocaleString()}`}
              <span
                className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-emerald-700 dark:text-emerald-400"
                title={`${wordsLeft.toLocaleString()} words remaining · estimate at 150 wpm`}
              >
                <Timer size={11} />
                {timeLeftLabel}
              </span>
              {player.sleepLeft !== null ? (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                  ⏳ {formatSleep(player.sleepLeft)}
                </span>
              ) : (
                player.sleepEndOfDoc && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                    <Timer size={11} />
                    End of doc
                  </span>
                )
              )}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs font-medium">
              {playing && <Equalizer />}
              <span className="truncate">
                {doc.sentences[player.currentIdx]?.text.slice(0, 80) || doc.title}
              </span>
            </p>
          </div>

          <VolumeControl iconBtn={iconBtn} />

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
            className="h-11 min-w-0 flex-1 cursor-pointer"
            aria-label="Playback speed"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            {currentTone && (
              <span
                className="hidden rounded-full bg-zinc-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 sm:inline"
                title={`Voice tone: ${currentTone}`}
              >
                {currentTone}
              </span>
            )}
            <select
              value={player.voice}
              onChange={(e) => player.setVoice(e.target.value)}
              className="h-11 w-32 shrink-0 rounded-lg border border-zinc-300 px-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 sm:w-40"
              aria-label="Voice"
              title={currentTone ? `Narration voice — ${currentTone}` : "Narration voice"}
            >
              {voices.length === 0 && <option>{player.voice}</option>}
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} · {v.description}
                </option>
              ))}
            </select>
            <VoicePreviewButton voice={player.voice} />
          </div>
        </div>

        {expanded && (
          <div className="mt-2 space-y-2 border-t border-zinc-200 pt-2 animate-fade-up dark:border-zinc-800">
            <div
              className="flex gap-1.5 overflow-x-auto pb-0.5"
              role="group"
              aria-label="Quick playback speeds"
            >
              {SPEED_STEPS.map((s) => {
                const active = Math.abs(player.speed - s) < 0.05;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      haptic();
                      player.setSpeed(s);
                    }}
                    aria-pressed={active}
                    className={`min-h-[44px] shrink-0 rounded-full px-3 text-xs font-semibold tabular-nums ${
                      active
                        ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
                        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {s.toFixed(2).replace(/0$/, "")}x
                  </button>
                );
              })}
            </div>
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
              className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Narration style prompt"
            />
            <div
              className="flex gap-1.5 overflow-x-auto pb-0.5"
              role="group"
              aria-label="Style prompt presets"
            >
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    haptic();
                    setStyleDraft(p.prompt);
                    player.setStylePrompt(p.prompt);
                  }}
                  className="min-h-[36px] shrink-0 rounded-full bg-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  title={p.prompt}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => {
                  haptic();
                  setStyleDraft("");
                  player.setStylePrompt("");
                }}
                className="min-h-[36px] shrink-0 rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                title="Clear the style prompt"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                <Timer size={14} />
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "end") player.setSleep("end");
                    else player.setSleep(v === "" ? null : Number(v));
                    e.target.value = "";
                  }}
                  className="min-h-[44px] rounded-lg border border-zinc-300 px-1.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label="Sleep timer"
                >
                  <option value="">
                    {player.sleepLeft !== null
                      ? `⏳ ${formatSleep(player.sleepLeft)}`
                      : player.sleepEndOfDoc
                        ? "End of document"
                        : "Sleep timer"}
                  </option>
                  <option value="5">5 min</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">60 min</option>
                  <option value="end">End of document</option>
                </select>
              </label>
              {(player.sleepLeft !== null || player.sleepEndOfDoc) && (
                <button
                  onClick={() => player.setSleep(null)}
                  className="flex min-h-[44px] items-center rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              )}
              <a
                href={`/api/documents/${doc.id}/audio?download=1&voice=${encodeURIComponent(player.voice)}&style=${encodeURIComponent(player.stylePrompt)}`}
                className="flex min-h-[44px] items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                title="Download the whole document as one WAV file"
              >
                <Download size={13} /> Audio
              </a>
              <button
                onClick={onOpenAI}
                className="ml-auto flex min-h-[44px] items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
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
