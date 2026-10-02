// Shared playback-volume persistence (used by usePlayer + PlayerBar).

export const VF_VOLUME_KEY = "vs-volume";
export const VF_MUTED_KEY = "vs-muted";
const LEGACY_VOLUME_KEY = "vf-volume";
const LEGACY_MUTED_KEY = "vf-muted";

/** Window event fired when volume/mute changes outside the PlayerBar control. */
export const VOLUME_CHANGE_EVENT = "vs-volume-change";

export function emitVolumeChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(VOLUME_CHANGE_EVENT));
  } catch {
    // ignore
  }
}

export function loadVolume(): number {
  try {
    const raw =
      localStorage.getItem(VF_VOLUME_KEY) ?? localStorage.getItem(LEGACY_VOLUME_KEY);
    if (raw === null) return 1;
    const v = Number(raw);
    if (!Number.isFinite(v)) return 1;
    return Math.min(1, Math.max(0, v));
  } catch {
    return 1;
  }
}

export function loadMuted(): boolean {
  try {
    const raw =
      localStorage.getItem(VF_MUTED_KEY) ?? localStorage.getItem(LEGACY_MUTED_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

export function saveVolume(v: number): void {
  try {
    localStorage.setItem(VF_VOLUME_KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    // ignore
  }
}

export function saveMuted(m: boolean): void {
  try {
    localStorage.setItem(VF_MUTED_KEY, m ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Apply the persisted volume/mute state to an audio element. */
export function applyStoredVolume(audio: HTMLAudioElement): void {
  try {
    audio.volume = loadVolume();
    audio.muted = loadMuted();
  } catch {
    // ignore
  }
}
