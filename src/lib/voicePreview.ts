"use client";

// Shared voice-audition preview player: a single dedicated Audio element so a
// preview never fights the main document playback. The main player engine
// calls stopVoicePreview() whenever document audio starts.

import { api } from "./client";
import { loadMuted, loadVolume } from "./volume";
import {
  WebSpeechPlayer,
  deviceVoiceName,
  isDeviceVoice,
  isWebSpeechSupported,
} from "./webSpeech";

let previewAudio: HTMLAudioElement | null = null;
/** Bumped on every play/stop so a stale fetch can't hijack the element. */
let playToken = 0;
let previewSpeech: WebSpeechPlayer | null = null;

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
  if (previewAudio) {
    try {
      if (
        !previewAudio.paused &&
        !previewAudio.ended &&
        previewAudio.src !== ""
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  try {
    return isWebSpeechSupported() && window.speechSynthesis.speaking;
  } catch {
    return false;
  }
}

/**
 * Immediately silence a cloud (/api/tts) voice preview, if any — without
 * touching speechSynthesis, so the device document engine (or a paused
 * utterance awaiting resume) survives.
 */
export function stopCloudPreview(): void {
  playToken += 1;
  if (!previewAudio) return;
  try {
    previewAudio.pause();
  } catch {
    // ignore
  }
  notifyEnded();
}

/** Immediately silence any in-flight or playing voice preview. */
export function stopVoicePreview(): void {
  stopCloudPreview();
  try {
    previewSpeech?.cancel();
    if (isWebSpeechSupported()) window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
  notifyEnded();
}

/**
 * Speak a short audition sample for a `device:` voice directly in the
 * browser (no network). Resolves once the utterance starts.
 */
export async function playDeviceVoicePreview(voice: string): Promise<void> {
  const token = ++playToken;
  if (!previewSpeech) previewSpeech = new WebSpeechPlayer();
  const engine = previewSpeech;
  const name = deviceVoiceName(voice) ?? voice;
  await new Promise<void>((resolve, reject) => {
    engine.speak(
      { idx: 0, text: `Hi, I'm the ${name} voice on VoxShelf.` },
      deviceVoiceName(voice),
      1,
      loadMuted() ? 0 : loadVolume(),
      {
        onEnd: () => {
          if (token === playToken) notifyEnded();
          resolve();
        },
        onError: (err) => {
          if (token === playToken) notifyEnded();
          const msg = err instanceof Error ? err.message : String(err ?? "");
          // Superseded previews resolve silently like their cloud twin.
          if (/interrupted|canceled|cancelled/i.test(msg)) resolve();
          else reject(err instanceof Error ? err : new Error(msg));
        },
      },
    );
    // speak() is synchronous; the utterance is now queued or failed.
    if (token === playToken) resolve();
  });
}

/**
 * Fetch a short audition sample for `voice` from /api/tts and play it.
 * Resolves once playback starts; resolves silently when superseded by a
 * newer preview (or by stopVoicePreview) while the sample was loading.
 */
export async function playVoicePreview(voice: string): Promise<void> {
  if (isDeviceVoice(voice)) {
    stopCloudPreview();
    await playDeviceVoicePreview(voice);
    return;
  }
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
