"use client";

// Global playback store: a shared HTMLAudioElement plus a pub/sub snapshot
// so a floating mini-player (and lock-screen controls) keep working when the
// reader view unmounts during navigation.

export type GlobalStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface NowPlayingMeta {
  docId: string;
  title: string;
  sentenceIdx: number;
  sentenceCount: number;
  snippet: string;
  speed: number;
  clipProgress: number;
  status: GlobalStatus;
}

export interface EngineControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  skip: (seconds: number) => void;
  setSpeed: (v: number) => void;
  /** Advance one sentence with autoplay (background ended-chaining). */
  advance: () => void;
}

type Listener = (meta: NowPlayingMeta | null) => void;

const listeners = new Set<Listener>();
let current: NowPlayingMeta | null = null;
let engineDocId: string | null = null;
let engine: EngineControls | null = null;

let sharedAudio: HTMLAudioElement | null = null;
let wired = false;

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {
      // Subscriber errors must never break playback.
    }
  }
}

function patch(patch: Partial<NowPlayingMeta>): void {
  if (!current) return;
  current = { ...current, ...patch };
  emit();
}

function syncMediaSession(): void {
  try {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: "VoxShelf",
      album: `Sentence ${current.sentenceIdx + 1} of ${current.sentenceCount}`,
    });
  } catch {
    // ignore
  }
}

function wireMediaSession(): void {
  try {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => engine?.play());
    navigator.mediaSession.setActionHandler("pause", () => engine?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => engine?.prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => engine?.next());
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      engine?.skip(-(details.seekOffset ?? 15));
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      engine?.skip(details.seekOffset ?? 15);
    });
  } catch {
    // Unsupported actions on this platform.
  }
}

/** Lazily-created shared audio element (client-only, survives navigation). */
export function getSharedAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
  }
  if (!wired && sharedAudio) {
    wired = true;
    // Background ended-chaining: when the reader unmounts mid-playback,
    // the registered engine keeps advancing sentences.
    sharedAudio.addEventListener("ended", () => {
      if (!current) {
        // no-op
      } else if (current.sentenceIdx < current.sentenceCount - 1) {
        patch({ sentenceIdx: current.sentenceIdx + 1, clipProgress: 0 });
      } else {
        patch({ status: "paused", clipProgress: 1 });
      }
      try {
        engine?.advance();
      } catch {
        // ignore
      }
    });
    sharedAudio.addEventListener("play", () => patch({ status: "playing" }));
    sharedAudio.addEventListener("pause", () => {
      // Only downgrade to paused (a loading state is owned by the engine).
      if (current && current.status === "playing") patch({ status: "paused" });
      else emit();
    });
    wireMediaSession();
  }
  return sharedAudio;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getNowPlaying(): NowPlayingMeta | null {
  return current;
}

export function publishNowPlaying(meta: NowPlayingMeta | null): void {
  current = meta;
  if (meta) syncMediaSession();
  emit();
}

export function clearNowPlaying(): void {
  const audio = getSharedAudio();
  if (audio) {
    try {
      audio.pause();
    } catch {
      // ignore
    }
  }
  engine = null;
  engineDocId = null;
  current = null;
  emit();
}

export function registerEngine(docId: string, controls: EngineControls): void {
  engineDocId = docId;
  engine = controls;
  wireMediaSession();
}

export function getEngine(): { docId: string; controls: EngineControls } | null {
  if (!engine || !engineDocId) return null;
  return { docId: engineDocId, controls: engine };
}

/**
 * Reader views call this on unmount. Playback intentionally continues in
 * the background; the engine stays registered so the mini-player and
 * lock-screen controls keep working.
 */
export function releaseEngine(docId: string): void {
  if (engineDocId !== docId) return;
  patch({ status: getSharedAudio()?.paused === false ? "playing" : "paused" });
}
