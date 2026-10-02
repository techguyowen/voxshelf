import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  getEngine,
  getNowPlaying,
  getSharedAudio,
  registerEngine,
  releaseEngine,
} from "@/lib/globalPlayer";
import { offlineAudioUrl } from "@/lib/offlineStore";
import type { DocumentDetail } from "@/lib/types";
import { stopVoicePreview } from "@/lib/voicePreview";
import { applyStoredVolume, loadVolume } from "@/lib/volume";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface SentenceFilter {
  (text: string): { text: string; shouldSkip: boolean };
}

export interface UsePlayerOpts {
  onProgress?: (sentenceIdx: number, charOffset: number) => void;
  /** Auto-skip filter: cleans speakable text and flags whole-sentence skips. */
  filterSentence?: SentenceFilter;
}

interface Clip {
  url: string;
  durationMs: number;
}

function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(4.5, Math.max(0.5, v));
}

interface WordTiming {
  index: number;
  word: string;
  startFrac: number;
  endFrac: number;
}

const wordTimingCache = new Map<string, WordTiming[]>();

function getSentenceWordTimings(text: string): WordTiming[] {
  const cached = wordTimingCache.get(text);
  if (cached) return cached;

  const parts = text.split(/(\s+)/);
  const words: string[] = [];
  parts.forEach((p) => {
    if (p !== "" && !/^\s+$/.test(p)) {
      words.push(p);
    }
  });

  if (words.length === 0) return [];

  // Realistic human speech & TTS pacing weights:
  // Every word requires a minimum articulation time (base 3.5), plus character
  // length, syllable vowel counts, numbers, and punctuation breath pauses.
  const weights: number[] = words.map((w) => {
    const cleanWord = w.replace(/[^\p{L}\p{N}]/gu, "");
    let weight = 3.5 + cleanWord.length * 0.85;

    // Syllable / vowel count heuristic
    const vowelCount = (cleanWord.match(/[aeiouyáéíóúäëïöü]/gi) || []).length;
    weight += vowelCount * 1.2;

    // Numbers take longer to speak
    const digits = (cleanWord.match(/\d/g) || []).length;
    if (digits > 0) {
      weight += digits * 2.8;
    }

    // Punctuation pauses
    if (/[,;:]$/.test(w) || /[-—–]$/.test(w)) weight += 3.0;
    else if (/[.!?]["']?$/.test(w)) weight += 4.5;

    return Math.max(2.5, weight);
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return [];

  let accum = 0;
  const timings: WordTiming[] = words.map((word, index) => {
    const startFrac = accum / totalWeight;
    accum += weights[index];
    const endFrac = accum / totalWeight;
    return { index, word, startFrac, endFrac };
  });

  if (wordTimingCache.size > 2000) wordTimingCache.clear();
  wordTimingCache.set(text, timings);
  return timings;
}

export function computeActiveWordIndex(
  text: string,
  currentTime: number,
  duration: number,
): number {
  if (!text || !Number.isFinite(duration) || duration <= 0) return -1;
  const timings = getSentenceWordTimings(text);
  if (timings.length === 0) return -1;
  if (timings.length === 1) return 0;

  // Gemini TTS audio clips have ~60-100ms lead-in and ~250-400ms trailing pause
  const leadIn = Math.min(0.12, Math.max(0.05, duration * 0.04));
  const tailMargin = Math.min(0.40, Math.max(0.15, duration * 0.08));
  const speechDur = Math.max(0.1, duration - leadIn - tailMargin);

  if (currentTime < leadIn) return 0;
  if (currentTime >= duration - tailMargin) return timings.length - 1;

  const frac = Math.min(1, Math.max(0, (currentTime - leadIn) / speechDur));

  for (let i = 0; i < timings.length; i++) {
    if (frac >= timings[i].startFrac && frac < timings[i].endFrac) {
      return timings[i].index;
    }
  }
  return timings.length - 1;
}

/**
 * Sentence-chained audio engine. Each sentence is synthesized (or cache-hit)
 * via /api/tts on demand, played through a single HTMLAudioElement, and the
 * next sentences are prefetched. MediaSession integration gives lock-screen
 * metadata and background controls on mobile.
 */
export function usePlayer(doc: DocumentDetail | null, opts: UsePlayerOpts = {}) {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [speed, setSpeedState] = useState(1);
  const [voice, setVoiceState] = useState("Kore");
  const [stylePrompt, setStylePromptState] = useState("");
  const [clipProgress, setClipProgress] = useState(0);
  const [currentWord, setCurrentWord] = useState(-1);
  const [sleepLeft, setSleepLeft] = useState<number | null>(null);
  const [sleepEndOfDoc, setSleepEndOfDoc] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef(new Map<string, Clip>());
  const inflightRef = useRef(new Map<string, Promise<Clip>>());
  const opRef = useRef(0);
  const docRef = useRef(doc);
  const statusRef = useRef(status);
  const currentIdxRef = useRef(currentIdx);
  const speedRef = useRef(speed);
  const voiceRef = useRef(voice);
  const styleRef = useRef(stylePrompt);
  const onProgressRef = useRef(opts.onProgress);
  const filterRef = useRef(opts.filterSentence);
  const sleepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);

  docRef.current = doc;
  statusRef.current = status;
  currentIdxRef.current = currentIdx;
  speedRef.current = speed;
  voiceRef.current = voice;
  styleRef.current = stylePrompt;
  onProgressRef.current = opts.onProgress;
  filterRef.current = opts.filterSentence;

  /** Speakable text for a sentence after the auto-skip filter. */
  const speakText = useCallback((idx: number): string => {
    const raw = docRef.current?.sentences[idx]?.text ?? "";
    const f = filterRef.current;
    if (!f) return raw;
    try {
      const out = f(raw);
      return out.text && out.text.trim() ? out.text : raw;
    } catch {
      return raw;
    }
  }, []);

  const isSkipped = useCallback((idx: number): boolean => {
    const d = docRef.current;
    const f = filterRef.current;
    if (!d || !f || idx < 0 || idx >= d.sentences.length) return false;
    try {
      return f(d.sentences[idx].text).shouldSkip === true;
    } catch {
      return false;
    }
  }, []);

  /** Resolve to the nearest readable sentence, preferring direction `dir`. */
  const resolveReadable = useCallback(
    (idx: number, dir: 1 | -1): number => {
      const d = docRef.current;
      if (!d || d.sentences.length === 0) return idx;
      const clamped = Math.max(0, Math.min(d.sentences.length - 1, idx));
      if (!isSkipped(clamped)) return clamped;
      let i = clamped + dir;
      while (i >= 0 && i < d.sentences.length) {
        if (!isSkipped(i)) return i;
        i += dir;
      }
      // Nothing readable in this direction: try the other way.
      i = clamped - dir;
      while (i >= 0 && i < d.sentences.length) {
        if (!isSkipped(i)) return i;
        i -= dir;
      }
      return clamped;
    },
    [isSkipped],
  );

  const cacheKey = useCallback(
    (idx: number) => `${docRef.current?.id}:${idx}:${voiceRef.current}:${styleRef.current}`,
    [],
  );

  const ensureAudio = useCallback(
    (idx: number): Promise<Clip> => {
      const d = docRef.current;
      if (!d || idx < 0 || idx >= d.sentences.length) {
        return Promise.reject(new Error("Sentence out of range."));
      }
      const speak = speakText(idx);
      const key = `${d.id}:${idx}:${voiceRef.current}:${styleRef.current}:${speak.length}:${speak.slice(0, 48)}`;
      const hit = cacheRef.current.get(key);
      if (hit) return Promise.resolve(hit);
      const pending = inflightRef.current.get(key);
      if (pending) return pending;
      const p = (async (): Promise<Clip> => {
        // Offline-first: when the sentence has device-cached audio for the
        // current voice, serve it straight from CacheStorage with no
        // server connection (the service worker serves the request).
        const sentence = docRef.current?.sentences[idx];
        const hash = sentence?.audioHash;
        const voiceMatches =
          voiceRef.current === docRef.current?.voice &&
          (styleRef.current || "") ===
            (docRef.current?.stylePrompt || "");
        if (hash && voiceMatches && typeof caches !== "undefined") {
          try {
            const offlineUrl = offlineAudioUrl(hash);
            const cached = await caches.match(offlineUrl);
            if (cached) {
              const clip = {
                url: offlineUrl,
                durationMs: sentence?.audioDurationMs ?? 0,
              };
              cacheRef.current.set(key, clip);
              return clip;
            }
          } catch {
            // Fall through to the network path.
          }
        }
        const res = await api.tts({
          text: speak,
          voice: voiceRef.current,
          stylePrompt: styleRef.current || undefined,
        });
        const clip = { url: res.url, durationMs: res.durationMs };
        cacheRef.current.set(key, clip);
        return clip;
      })().finally(() => {
        inflightRef.current.delete(key);
      });
      inflightRef.current.set(key, p);
      return p;
    },
    [speakText],
  );

  const reportProgress = useCallback((idx: number) => {
    const d = docRef.current;
    if (!d) return;
    onProgressRef.current?.(idx, d.sentences[idx]?.charEnd ?? 0);
  }, []);

  /** Load a clip into the audio element without playing. Resolves duration (s). */
  const loadClipOnly = useCallback(
    async (idx: number): Promise<number> => {
      const clip = await ensureAudio(idx);
      const audio = audioRef.current;
      if (!audio) throw new Error("Audio unavailable.");
      audio.src = clip.url;
      audio.playbackRate = speedRef.current;
      setCurrentIdx(idx);
      setClipProgress(0);
      setCurrentWord(-1);
      const dur = await new Promise<number>((resolve) => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          resolve(audio.duration);
          return;
        }
        const fallback = setTimeout(
          () => resolve(clip.durationMs > 0 ? clip.durationMs / 1000 : 5),
          1500,
        );
        audio.addEventListener(
          "loadedmetadata",
          () => {
            clearTimeout(fallback);
            resolve(
              Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.duration
                : clip.durationMs / 1000,
            );
          },
          { once: true },
        );
      });
      return dur;
    },
    [ensureAudio],
  );

  const goTo = useCallback(
    async (idx: number, autoplay: boolean) => {
      const d = docRef.current;
      if (!d || d.sentences.length === 0) return;
      // A voice-audition preview must never overlap document audio.
      stopVoicePreview();
      const clamped = resolveReadable(
        idx,
        idx < currentIdxRef.current ? -1 : 1,
      );
      const op = ++opRef.current;
      setError(null);
      setLoadingIdx(clamped);
      if (autoplay) setStatus("loading");
      try {
        const clip = await ensureAudio(clamped);
        if (op !== opRef.current) return;
        const audio = audioRef.current;
        if (!audio) throw new Error("Audio unavailable.");
        audio.src = clip.url;
        audio.playbackRate = speedRef.current;
        setCurrentIdx(clamped);
        setClipProgress(0);
        setCurrentWord(-1);
        setLoadingIdx(null);
        if (autoplay) {
          try {
            await audio.play();
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
            throw e;
          }
          if (op !== opRef.current) {
            audio.pause();
            return;
          }
          setStatus("playing");
        } else {
          setStatus("paused");
        }
        reportProgress(clamped);
        // Pre-buffer the next 3 sentences during playback for zero-latency
        // sentence transitions (N+1 renders instantly; N+2/N+3 stay warm).
        void ensureAudio(clamped + 1).catch(() => {});
        void ensureAudio(clamped + 2).catch(() => {});
        void ensureAudio(clamped + 3).catch(() => {});
      } catch (e) {
        if (op !== opRef.current) return;
        setLoadingIdx(null);
        setStatus("error");
        setError(e instanceof Error ? e.message : "Playback failed.");
      }
    },
    [ensureAudio, reportProgress, resolveReadable],
  );

  const pause = useCallback(() => {
    opRef.current += 1;
    const audio = audioRef.current;
    if (audio) audio.pause();
    setStatus((s) => (s === "playing" || s === "loading" ? "paused" : s));
    reportProgress(currentIdxRef.current);
  }, [reportProgress]);

  const play = useCallback(() => {
    stopVoicePreview();
    const audio = audioRef.current;
    if (
      audio &&
      audio.src &&
      statusRef.current === "paused" &&
      audio.currentTime > 0 &&
      Number.isFinite(audio.duration) &&
      audio.currentTime < audio.duration - 0.1
    ) {
      setError(null);
      void audio
        .play()
        .then(() => setStatus("playing"))
        .catch((e: unknown) => {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Playback failed.");
        });
      return;
    }
    void goTo(currentIdxRef.current, true);
  }, [goTo]);

  const toggle = useCallback(() => {
    if (statusRef.current === "playing") pause();
    else play();
  }, [pause, play]);

  const playFrom = useCallback(
    (idx: number) => {
      void goTo(idx, true);
    },
    [goTo],
  );

  /** Move the cursor without starting playback (TOC jumps while paused). */
  const seekTo = useCallback(
    (idx: number) => {
      void goTo(idx, false);
    },
    [goTo],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      const autoplay = statusRef.current === "playing";
      void goTo(currentIdxRef.current + delta, autoplay);
    },
    [goTo],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  /** Seek by seconds, crossing sentence boundaries when overflowing. */
  const skip = useCallback(
    async (seconds: number) => {
      const d = docRef.current;
      const audio = audioRef.current;
      if (!d || !audio) return;
      const op = ++opRef.current;
      const wasPlaying = statusRef.current === "playing";
      try {
        if (!audio.src) {
          await goTo(
            currentIdxRef.current + (seconds >= 0 ? 1 : -1),
            wasPlaying,
          );
          return;
        }
        let dur =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : null;
        let idx = currentIdxRef.current;
        if (dur === null) {
          dur = await loadClipOnly(idx);
          if (op !== opRef.current) return;
        }
        let target = audio.currentTime + seconds;
        if (target < 0) {
          while (target < 0 && idx > 0) {
            idx -= 1;
            dur = await loadClipOnly(idx);
            if (op !== opRef.current) return;
            target += dur;
          }
          target = Math.max(0, target);
        } else {
          while (target >= dur && idx < d.sentences.length - 1) {
            target -= dur;
            idx += 1;
            dur = await loadClipOnly(idx);
            if (op !== opRef.current) return;
          }
          target = Math.min(Math.max(0, target), Math.max(0, dur - 0.05));
        }
        if (op !== opRef.current) return;
        try {
          audio.currentTime = target;
        } catch {
          // Some browsers throw before metadata; safe to ignore.
        }
        if (idx !== currentIdxRef.current) {
          setCurrentIdx(idx);
          reportProgress(idx);
        }
        if (wasPlaying) {
          try {
            await audio.play();
            setStatus("playing");
          } catch {
            setStatus("paused");
          }
        }
      } catch (e) {
        if (op !== opRef.current) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Seek failed.");
      }
    },
    [goTo, loadClipOnly, reportProgress],
  );

  const setSpeed = useCallback((v: number) => {
    const c = clampSpeed(v);
    setSpeedState(c);
    if (audioRef.current) audioRef.current.playbackRate = c;
  }, []);

  const setVoice = useCallback((v: string) => {
    setVoiceState(v);
  }, []);

  const setStylePrompt = useCallback((v: string) => {
    setStylePromptState(v);
  }, []);

  const clearSleep = useCallback(() => {
    if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current);
    if (sleepTickRef.current) clearInterval(sleepTickRef.current);
    sleepTimeoutRef.current = null;
    sleepTickRef.current = null;
    if (audioRef.current) {
      try {
        // Restore the user's chosen volume (not full blast) after a fade.
        audioRef.current.volume = loadVolume();
      } catch {
        // ignore
      }
    }
    setSleepLeft(null);
    setSleepEndOfDoc(false);
  }, []);

  const setSleep = useCallback(
    (minutes: number | "end" | null) => {
      clearSleep();
      if (minutes === null) return;
      if (minutes === "end") {
        setSleepEndOfDoc(true);
        return;
      }
      if (minutes <= 0) return;
      const end = Date.now() + minutes * 60_000;
      setSleepLeft(minutes * 60);
      if (audioRef.current) {
        try {
          audioRef.current.volume = loadVolume();
        } catch {
          // ignore
        }
      }
      sleepTickRef.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        setSleepLeft(left);
        // Gentle linear fade-out over the final 30 seconds, relative to the
        // user's chosen base volume.
        const audio = audioRef.current;
        if (audio) {
          try {
            const base = loadVolume();
            audio.volume = left <= 30 ? Math.max(0, base * (left / 30)) : base;
          } catch {
            // ignore
          }
        }
        if (left <= 0 && sleepTickRef.current) {
          clearInterval(sleepTickRef.current);
          sleepTickRef.current = null;
        }
      }, 1000);
      sleepTimeoutRef.current = setTimeout(() => {
        pause();
        clearSleep();
      }, minutes * 60_000);
    },
    [clearSleep, pause],
  );

  const dismissError = useCallback(() => {
    setError(null);
    setStatus((s) => (s === "error" ? "paused" : s));
  }, []);

  /**
   * Instantly re-sync visual state from the live audio element. Used when the
   * tab/screen becomes visible again after background playback (including a
   * mobile lockscreen wakeup): rAF ticks and timeupdate events are throttled
   * while hidden, so the karaoke cursor would otherwise lag behind the audio.
   */
  const resync = useCallback(() => {
    const audio = audioRef.current ?? getSharedAudio();
    if (!audio || !audio.src) return;
    const dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const cur = audio.currentTime;
    setClipProgress(Math.min(1, Math.max(0, cur / dur)));
    setCurrentWord(
      computeActiveWordIndex(speakText(currentIdxRef.current), cur, dur),
    );
    try {
      if (
        "mediaSession" in navigator &&
        Number.isFinite(audio.currentTime) &&
        Number.isFinite(audio.duration)
      ) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration),
        });
      }
    } catch {
      // setPositionState throws when no metadata is set; ignore.
    }
  }, [speakText]);

  /** Advance one sentence (delegated from the shared audio `ended` event). */
  const advance = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const idx = currentIdxRef.current;
    if (idx < d.sentences.length - 1) {
      void goTo(idx + 1, true);
    } else {
      setStatus("paused");
      setClipProgress(1);
      reportProgress(idx);
      clearSleep();
    }
  }, [goTo, reportProgress, clearSleep]);

  // --- audio element lifecycle (shared element survives navigation) ---
  useEffect(() => {
    const audio = getSharedAudio();
    if (!audio) return;
    audioRef.current = audio;
    applyStoredVolume(audio);

    const updateProgress = () => {
      if (!audio) return;
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const cur = audio.currentTime;
      const frac = Math.min(1, Math.max(0, cur / dur));
      setClipProgress(frac);

      const sentenceText = speakText(currentIdxRef.current);
      const wordIdx = computeActiveWordIndex(sentenceText, cur, dur);
      setCurrentWord(wordIdx);
    };

    const tick = () => {
      updateProgress();
      if (audio && !audio.paused && !audio.ended) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const onTimeUpdate = () => {
      updateProgress();
      try {
        if ("mediaSession" in navigator && Number.isFinite(audio.currentTime) && Number.isFinite(audio.duration)) {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: Math.min(audio.currentTime, audio.duration),
          });
        }
      } catch {
        // setPositionState throws when no metadata is set; ignore.
      }
    };

    const onPlay = () => {
      if (statusRef.current !== "loading") setStatus("playing");
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    const onPause = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      updateProgress();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // The shared element keeps playing in the background on unmount so
      // navigation never interrupts listening; only detach our listeners.
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportProgress, clearSleep, speakText]);

  // --- reset when the document changes ---
  useEffect(() => {
    if (!doc) return;
    opRef.current += 1;
    const audio = audioRef.current ?? getSharedAudio();
    // Reopening the doc that is already playing in the background:
    // reattach to its transport instead of stopping it.
    const bgEngine = getEngine();
    const bgMeta = getNowPlaying();
    const reattaching =
      !!audio &&
      audio.src !== "" &&
      bgEngine?.docId === doc.id &&
      bgMeta?.docId === doc.id;
    if (reattaching && audio) {
      setStatus(audio.paused ? "paused" : "playing");
      setError(null);
      setLoadingIdx(null);
      setCurrentIdx(
        Math.max(0, Math.min(doc.sentenceCount - 1, bgMeta?.sentenceIdx ?? doc.progressSentenceIndex)),
      );
      setSpeedState(clampSpeed(bgMeta?.speed ?? doc.speed));
      setVoiceState(doc.voice);
      setStylePromptState(doc.stylePrompt || "");
      setClipProgress(bgMeta?.clipProgress ?? 0);
      setCurrentWord(-1);
    } else {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        applyStoredVolume(audio);
      }
      setStatus("idle");
      setError(null);
      setLoadingIdx(null);
      setCurrentIdx(Math.max(0, Math.min(doc.sentenceCount - 1, doc.progressSentenceIndex)));
      setSpeedState(clampSpeed(doc.speed));
      setVoiceState(doc.voice);
      setStylePromptState(doc.stylePrompt || "");
      setClipProgress(0);
      setCurrentWord(-1);
    }
    clearSleep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  // --- Global engine: mini-player + lock-screen controls delegate here. ---
  const engineActionsRef = useRef({
    play,
    pause,
    toggle,
    next,
    prev,
    skip,
    setSpeed,
    advance,
  });
  engineActionsRef.current = {
    play,
    pause,
    toggle,
    next,
    prev,
    skip,
    setSpeed,
    advance,
  };

  useEffect(() => {
    if (!doc) return;
    registerEngine(doc.id, {
      play: () => engineActionsRef.current.play(),
      pause: () => engineActionsRef.current.pause(),
      toggle: () => engineActionsRef.current.toggle(),
      next: () => engineActionsRef.current.next(),
      prev: () => engineActionsRef.current.prev(),
      skip: (s: number) => {
        void engineActionsRef.current.skip(s);
      },
      setSpeed: (v: number) => engineActionsRef.current.setSpeed(v),
      advance: () => engineActionsRef.current.advance(),
    });
    return () => {
      releaseEngine(doc.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !doc) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: doc.title,
        artist: "VoxShelf",
        album: `Sentence ${currentIdx + 1} of ${doc.sentenceCount}`,
      });
    } catch {
      // ignore
    }
  }, [doc, currentIdx]);

  // --- Background tab resync & mobile lockscreen wakeup ---
  // While hidden, rAF/timeupdate callbacks are throttled, so the karaoke
  // cursor lags behind the audio. The moment the tab/screen is visible
  // again, re-sync clip progress + the active word from the live element.
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") resyncRef.current();
    };
    const onFocus = () => resyncRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return {
    status,
    currentIdx,
    error,
    loadingIdx,
    speed,
    voice,
    stylePrompt,
    clipProgress,
    currentWord,
    sleepLeft,
    sleepEndOfDoc,
    play,
    pause,
    toggle,
    playFrom,
    seekTo,
    next,
    prev,
    skip,
    setSpeed,
    setVoice,
    setStylePrompt,
    setSleep,
    dismissError,
    resync,
  };
}

export type Player = ReturnType<typeof usePlayer>;
