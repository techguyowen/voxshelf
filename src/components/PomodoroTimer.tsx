"use client";

import { Pause, Play, SkipForward, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "./Toast";

export type PomodoroPhase = "idle" | "focus" | "break";

const PRESETS: { label: string; name: string; focusMin: number; breakMin: number }[] = [
  { label: "25/5", name: "Classic Pomodoro", focusMin: 25, breakMin: 5 },
  { label: "50/10", name: "Deep Study", focusMin: 50, breakMin: 10 },
  { label: "15/3", name: "Quick Sprint", focusMin: 15, breakMin: 3 },
];

export function playPomodoroChime(): void {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    for (const [i, freq] of [659.25, 830.61, 987.77].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    }
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 1400);
  } catch {
    // Audio unavailable; the toast still announces the transition.
  }
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PomodoroTimer() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<PomodoroPhase>("idle");
  const [focusLen, setFocusLen] = useState(25 * 60);
  const [breakLen, setBreakLen] = useState(5 * 60);
  const [remaining, setRemaining] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (phase === "idle" || paused) return;
    if (remaining <= 0) {
      playPomodoroChime();
      if (phase === "focus") {
        setSessions((n) => n + 1);
        toast("Focus session complete! Time for a break.", "success");
        setRemaining(breakLen);
        setPhase("break");
      } else {
        toast("Break over! Ready for another focus session?", "info");
        setRemaining(focusLen);
        setPhase("focus");
      }
      return;
    }
    const t = window.setTimeout(() => {
      setRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [phase, paused, remaining, focusLen, breakLen, toast]);

  const start = (focusMin: number, breakMin: number) => {
    setFocusLen(focusMin * 60);
    setBreakLen(breakMin * 60);
    setRemaining(focusMin * 60);
    setSessions(0);
    setPaused(false);
    setPhase("focus");
    setMenuOpen(false);
  };

  const skip = () => {
    if (phase === "focus") {
      setRemaining(breakLen);
      setPhase("break");
    } else if (phase === "break") {
      setRemaining(focusLen);
      setPhase("focus");
    }
    setPaused(false);
  };

  const cancel = () => {
    setPhase("idle");
    setPaused(false);
    setRemaining(0);
    setSessions(0);
    setMenuOpen(false);
  };

  if (phase === "idle") {
    return (
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="Start a Pomodoro study session"
          title="Pomodoro study sessions"
          className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Timer size={15} /> Pomodoro: Start
        </button>
        {menuOpen && (
          <div
            className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            role="menu"
            aria-label="Pomodoro presets"
          >
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => start(p.focusMin, p.breakMin)}
                role="menuitem"
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="font-semibold tabular-nums">Start {p.label}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const focusing = phase === "focus";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span
        className={`flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-bold tabular-nums ${
          focusing
            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        }`}
        role="timer"
        aria-label={`${focusing ? "Focus" : "Break"} time remaining: ${formatClock(remaining)}`}
      >
        {focusing ? "🎯 Focus" : "☕ Break"} {formatClock(remaining)}
        <span className="opacity-70">#{sessions + 1}</span>
        {paused && <span className="opacity-70">(paused)</span>}
      </span>
      <button
        onClick={() => setPaused((v) => !v)}
        className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-label={paused ? "Resume timer" : "Pause timer"}
        title={paused ? "Resume" : "Pause"}
      >
        {paused ? <Play size={16} /> : <Pause size={16} />}
      </button>
      <button
        onClick={skip}
        className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-label="Skip to next phase"
        title="Skip phase"
      >
        <SkipForward size={16} />
      </button>
      <button
        onClick={cancel}
        className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800"
        aria-label="Cancel Pomodoro session"
        title="Cancel"
      >
        <X size={16} />
      </button>
    </div>
  );
}
