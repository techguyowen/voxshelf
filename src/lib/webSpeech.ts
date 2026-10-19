// On-device Web Speech API synthesis: a zero-cost, zero-API-key fallback
// engine that speaks directly in the browser (works offline with locally
// installed voices). Device voices are stored as `device:<VoiceName>`.

import { DEVICE_VOICE_PREFIX } from "./voices";

export interface WebSpeechSentence {
  idx: number;
  text: string;
}

export interface WebSpeechCallbacks {
  /** Fired with the utterance char index (real word-boundary karaoke). */
  onWord?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

/** True when the browser exposes speechSynthesis (client-only). */
export function isWebSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** True for `device:<VoiceName>` values (on-device engine, never /api/tts). */
export function isDeviceVoice(voice: string): boolean {
  return voice.startsWith(DEVICE_VOICE_PREFIX);
}

/** Strip the `device:` prefix; null/empty when no concrete voice is named. */
export function deviceVoiceName(voice: string | null): string | null {
  if (!voice || !isDeviceVoice(voice)) return null;
  const name = voice.slice(DEVICE_VOICE_PREFIX.length).trim();
  return name ? name : null;
}

/** Build a storable `device:<VoiceName>` value from a system voice name. */
export function toDeviceVoiceValue(name: string): string {
  return `${DEVICE_VOICE_PREFIX}${name}`;
}

/**
 * Voices load asynchronously in most browsers (Chrome populates the list
 * after `voiceschanged`). Resolves with whatever is available, waiting for
 * the event when the first read is empty. Never rejects.
 */
export function getWebSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isWebSpeechSupported()) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(synth.getVoices());
    };
    try {
      synth.addEventListener("voiceschanged", done, { once: true });
    } catch {
      // Older browsers without EventTarget support fall through to the timer.
    }
    // Fallback: some browsers never fire the event (or have no voices).
    window.setTimeout(done, 1500);
  });
}

/**
 * Pick the best default system voice: document/browser language first, then
 * English, then the browser default, then whatever exists. Returns a
 * storable `device:<name>` value, or null when no voices are available.
 */
export function pickDefaultDeviceVoice(
  voices: SpeechSynthesisVoice[],
): string | null {
  if (voices.length === 0) return null;
  const docLang =
    typeof document !== "undefined"
      ? document.documentElement.lang || ""
      : "";
  const navLang =
    typeof navigator !== "undefined" ? navigator.language || "" : "";
  const preferred = (docLang || navLang || "en").slice(0, 2).toLowerCase();
  const byLang = voices.find(
    (v) => v.lang && v.lang.slice(0, 2).toLowerCase() === preferred,
  );
  if (byLang) return toDeviceVoiceValue(byLang.name);
  const english = voices.find(
    (v) => v.lang && v.lang.slice(0, 2).toLowerCase() === "en",
  );
  if (english) return toDeviceVoiceValue(english.name);
  const browserDefault = voices.find((v) => v.default);
  if (browserDefault) return toDeviceVoiceValue(browserDefault.name);
  return toDeviceVoiceValue(voices[0].name);
}

/** Resolve the default device voice value, loading voices if needed. */
export async function getDefaultDeviceVoice(): Promise<string | null> {
  return pickDefaultDeviceVoice(await getWebSpeechVoices());
}

/**
 * Map a boundary char offset to the word index used by the karaoke
 * renderer (whitespace-split tokens, same as the cloud engine's display).
 */
export function charIndexToWordIndex(
  text: string,
  charIndex: number,
): number {
  if (!text) return -1;
  const clamped = Math.min(text.length, Math.max(0, charIndex));
  const parts = text.split(/(\s+)/);
  let pos = 0;
  let wordIdx = -1;
  let lastWordIdx = 0;
  for (const part of parts) {
    const isWord = part !== "" && !/^\s+$/.test(part);
    const nextPos = pos + part.length;
    if (isWord) {
      wordIdx += 1;
      lastWordIdx = wordIdx;
    }
    if (clamped >= pos && clamped < nextPos) return lastWordIdx;
    pos = nextPos;
  }
  return lastWordIdx;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2.5, Math.max(0.5, rate));
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/**
 * Thin controller over window.speechSynthesis for one utterance at a time.
 * Every speak() cancels the previous utterance so engines never overlap.
 */
export class WebSpeechPlayer {
  private generation = 0;

  speak(
    sentence: WebSpeechSentence,
    voiceName: string | null,
    rate: number,
    volume: number,
    callbacks: WebSpeechCallbacks = {},
  ): void {
    if (!isWebSpeechSupported()) {
      callbacks.onError?.(
        new Error("On-device speech is not supported in this browser."),
      );
      return;
    }
    const synth = window.speechSynthesis;
    const gen = ++this.generation;
    try {
      synth.cancel();
    } catch {
      // ignore
    }

    const utterance = new SpeechSynthesisUtterance(sentence.text);
    const voices = synth.getVoices();
    const match =
      (voiceName && voices.find((v) => v.name === voiceName)) || null;
    utterance.voice =
      match ?? this.pickFallbackVoice(voices) ?? null;
    utterance.rate = clampRate(rate);
    utterance.volume = clampVolume(volume);

    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (gen !== this.generation) return;
      callbacks.onWord?.(event.charIndex);
    };
    utterance.onend = () => {
      if (gen !== this.generation) return;
      callbacks.onEnd?.();
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (gen !== this.generation) return;
      callbacks.onError?.(
        new Error(`On-device speech failed (${event.error}).`),
      );
    };

    try {
      synth.speak(utterance);
    } catch (err) {
      callbacks.onError?.(err);
    }
  }

  pause(): void {
    if (!isWebSpeechSupported()) return;
    try {
      window.speechSynthesis.pause();
    } catch {
      // ignore
    }
  }

  resume(): void {
    if (!isWebSpeechSupported()) return;
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }
  }

  cancel(): void {
    this.generation += 1;
    if (!isWebSpeechSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }

  speaking(): boolean {
    if (!isWebSpeechSupported()) return false;
    try {
      return window.speechSynthesis.speaking;
    } catch {
      return false;
    }
  }

  paused(): boolean {
    if (!isWebSpeechSupported()) return false;
    try {
      return window.speechSynthesis.paused;
    } catch {
      return false;
    }
  }

  /** First voice matching document/browser language, else browser default. */
  private pickFallbackVoice(
    voices: SpeechSynthesisVoice[],
  ): SpeechSynthesisVoice | null {
    if (voices.length === 0) return null;
    const docLang =
      typeof document !== "undefined"
        ? document.documentElement.lang || ""
        : "";
    const navLang =
      typeof navigator !== "undefined" ? navigator.language || "" : "";
    const preferred = (docLang || navLang || "en").slice(0, 2).toLowerCase();
    return (
      voices.find(
        (v) => v.lang && v.lang.slice(0, 2).toLowerCase() === preferred,
      ) ??
      voices.find((v) => v.lang && v.lang.slice(0, 2).toLowerCase() === "en") ??
      voices.find((v) => v.default) ??
      voices[0]
    );
  }
}
