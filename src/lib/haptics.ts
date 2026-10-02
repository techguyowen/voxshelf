/** Subtle haptic tap on mobile devices; no-op elsewhere. */
export function haptic(pattern: number | number[] = 12): void {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration is best-effort only.
    }
  }
}
