// Gemini pricing estimates for VoxShelf's cost-transparency UI.
// Shared by server code (audioCache) and client components.

/** Gemini TTS: ~$0.02 per 100k characters (~$0.20 / 1M chars). */
export const TTS_USD_PER_CHAR = 0.02 / 100_000;

/** Gemini text/OCR: ~$0.075 per 1M tokens. */
export const TEXT_USD_PER_1M_TOKENS = 0.075;

/** Free-tier rate limits shown in the transparency section. */
export const FREE_TIER_LIMITS = "15 RPM / 1M TPM";

/** Estimated TTS cost in USD for a character count. */
export function estimateTtsCostUsd(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return chars * TTS_USD_PER_CHAR;
}

/**
 * Format a small USD amount for display.
 * Sub-cent values render as "<$0.01" so a full document reads naturally.
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  if (amount < 10) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(2)}`;
}

/** Compact character count, e.g. 1.2M / 45.6K / 812. */
export function formatChars(chars: number): string {
  if (!Number.isFinite(chars) || chars <= 0) return "0";
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M`;
  if (chars >= 10_000) return `${(chars / 1000).toFixed(1)}K`;
  if (chars >= 1000) return `${(chars / 1000).toFixed(2)}K`;
  return `${Math.round(chars)}`;
}
