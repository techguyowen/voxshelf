// Remaining-listening-time helpers shared by ReaderView and PlayerBar.

/** Baseline narration pace in words per minute at 1x speed. */
export const WORDS_PER_MINUTE = 150;

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Cumulative word counts per sentence index: cum[i] = words in
 * sentences[0..i]. Lets remaining-time lookups stay O(1).
 */
export function cumulativeWordCounts(texts: string[]): number[] {
  const cum: number[] = new Array(texts.length);
  let total = 0;
  for (let i = 0; i < texts.length; i += 1) {
    total += countWords(texts[i]);
    cum[i] = total;
  }
  return cum;
}

export function wordsRemainingFrom(
  cum: number[],
  currentIdx: number,
  clipProgress = 0,
): number {
  if (cum.length === 0) return 0;
  const total = cum[cum.length - 1];
  const before = currentIdx > 0 ? cum[Math.min(currentIdx, cum.length) - 1] : 0;
  const frac = Math.min(1, Math.max(0, clipProgress));
  const currentWords =
    cum[Math.min(currentIdx, cum.length - 1)] - before;
  const remaining =
    total - before - Math.round(currentWords * frac);
  return Math.max(0, remaining);
}

/** Estimated remaining seconds for words at a playback speed. */
export function estimateSecondsLeft(
  wordsRemaining: number,
  speed: number,
): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(0, Math.round((wordsRemaining / (WORDS_PER_MINUTE * s)) * 60));
}

/**
 * Compact duration, e.g. "3m 45s", "45s", "1h 5m".
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Full badge label, e.g. "3m 45s left (at 1.5x)". */
export function formatTimeLeftBadge(
  wordsRemaining: number,
  speed: number,
): string {
  if (wordsRemaining <= 0) return "Done";
  return `${formatDuration(estimateSecondsLeft(wordsRemaining, speed))} left (at ${speed.toFixed(1)}×)`;
}
