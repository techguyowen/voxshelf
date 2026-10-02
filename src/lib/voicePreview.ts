"use client";

// Shared voice-audition preview player: a single dedicated Audio element so a
// preview never fights the main document playback. The main player engine
// calls stopVoicePreview() whenever document audio starts.

import { api } from "./client";
import { loadMuted, loadVolume } from "./volume";

let previewAudio: HTMLAudioElement | null = null;
/** Bumped on every play/stop so a stale fetch can't hijack the element. */
let playToken = 0;

type EndListener = () => void;
const endListeners = new Set<EndListener>();

function notifyEnded(): void {
  for (const fn of endListeners) {
    try {
      fn();
    } catch {
      // Listener errors must never break playback.
    }
  }
}

function getPreviewAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }
  if (!previewAudio) {
    previewAudio = new Audio();
    previewAudio.preload = "auto";
    previewAudio.addEventListener("ended", () => notifyEnded());
    previewAudio.addEventListener("error", () => notifyEnded());
  }
  return previewAudio;
}

/** Subscribe to preview end/stop events. Returns an unsubscribe function. */
export function subscribePreviewEnd(fn: EndListener): () => void {
  endListeners.add(fn);
  return () => {
    endListeners.delete(fn);
  };
}

export function isVoicePreviewPlaying(): boolean {
  if (!previewAudio) return false;
  try {
    return !previewAudio.paused && !previewAudio.ended && previewAudio.src !== "";
  } catch {
    return false;
  }
}

/** Immediately silence any in-flight or playing voice preview. */
export function stopVoicePreview(): void {
  playToken += 1;
  if (!previewAudio) return;
  try {
    previewAudio.pause();
  } catch {
    // ignore
  }
  notifyEnded();
}

/**
 * Fetch a short audition sample for `voice` from /api/tts and play it.
 * Resolves once playback starts; resolves silently when superseded by a
 * newer preview (or by stopVoicePreview) while the sample was loading.
 */
export async function playVoicePreview(voice: string): Promise<void> {
  const token = ++playToken;
  const audio = getPreviewAudio();
  if (!audio) throw new Error("Audio preview is unavailable in this browser.");
  try {
    audio.pause();
  } catch {
    // ignore
  }
  const res = await api.tts({
    text: `Hi, I'm the ${voice} voice on VoxShelf.`,
    voice,
  });
  if (token !== playToken) return;
  try {
    audio.volume = loadVolume();
    audio.muted = loadMuted();
  } catch {
    // ignore
  }
  audio.src = res.url;
  audio.playbackRate = 1;
  try {
    await audio.play();
  } catch (e) {
    if (token !== playToken) return;
    throw e;
  }
}
