"use client";

import { Loader2, Square } from "lucide-react";
import { useEffect, useState } from "react";
import {
  isVoicePreviewPlaying,
  playVoicePreview,
  stopVoicePreview,
  subscribePreviewEnd,
} from "@/lib/voicePreview";
import { useToast } from "./Toast";

/**
 * "🔊 Preview" audition button shared by SettingsModal and PlayerBar.
 * Fetches a short sample from /api/tts, plays it, and shows a spinner while
 * loading. Clicking again (or starting main playback) stops the preview.
 */
export function VoicePreviewButton({
  voice,
  className,
}: {
  voice: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const toast = useToast();

  useEffect(() => subscribePreviewEnd(() => {
    setLoading(false);
    setPlaying(false);
  }), []);

  // Never leak preview audio after unmount (e.g. modal closed mid-sample).
  useEffect(() => () => stopVoicePreview(), []);

  async function onClick() {
    if (loading) return;
    if (playing) {
      stopVoicePreview();
      setPlaying(false);
      return;
    }
    setLoading(true);
    try {
      await playVoicePreview(voice);
      setPlaying(isVoicePreviewPlaying());
    } catch (e) {
      // Aborts happen when a newer preview supersedes this one; stay silent.
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "Voice preview failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={loading}
      className={
        className ??
        "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }
      aria-label={playing ? `Stop ${voice} voice preview` : `Preview ${voice} voice`}
      title={`Hear a sample of the ${voice} voice`}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : playing ? (
        <Square size={14} />
      ) : (
        <span aria-hidden="true">🔊</span>
      )}
      {loading ? "Loading…" : playing ? "Stop" : "Preview"}
    </button>
  );
}
