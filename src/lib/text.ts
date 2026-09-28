// Text utilities: sentence splitting, TTS chunking, counts. Shared server/client.

const ABBREVIATIONS = [
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "mt",
  "vs",
  "etc",
  "fig",
  "no",
  "al",
  "gen",
  "rep",
  "sen",
  "gov",
  "lt",
  "col",
  "sgt",
  "cmdr",
  "capt",
  "rev",
  "hon",
  "pres",
  "dept",
  "univ",
  "ave",
  "blvd",
  "rd",
  "ln",
  "e\\.g",
  "i\\.e",
];

const DOT = "∯"; // placeholder for protected periods

export interface SplitSentence {
  text: string;
  start: number;
  end: number;
}

function protect(text: string): string {
  let out = text;
  // Protect decimal numbers: 3.14 -> 3∯14
  out = out.replace(/(\d)\.(\d)/g, `$1${DOT}$2`);
  // Protect common abbreviations (case-insensitive).
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp(`\\b(${abbr})\\.`, "gi");
    out = out.replace(re, `$1${DOT}`);
  }
  // Protect initials: "J. K. Rowling" -> "J∯ K∯ Rowling"
  out = out.replace(/(?:^|\s)([A-Z])\.(\s|$)/g, ` $1${DOT}$2`);
  return out;
}

function restore(text: string): string {
  return text.replaceAll(DOT, ".");
}

/**
 * Split text into sentences, tracking char offsets into the normalized text.
 * Normalization collapses whitespace runs (including newlines) to single spaces.
 */
export function splitSentences(input: string): SplitSentence[] {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const guarded = protect(normalized);
  // Split after sentence-ending punctuation followed by whitespace + capital/digit/quote,
  // or at paragraph-ish boundaries. Keep the punctuation attached.
  const parts = guarded.split(/(?<=[.!?…]["'”’)]?)\s+(?=[A-Z0-9"'“‘(\[])/);

  const result: SplitSentence[] = [];
  let cursor = 0;
  for (const part of parts) {
    const sentence = restore(part).trim();
    if (!sentence) continue;
    const start = normalized.indexOf(sentence, cursor);
    const safeStart = start >= 0 ? start : cursor;
    const end = safeStart + sentence.length;
    result.push({ text: sentence, start: safeStart, end });
    cursor = end;
  }
  return result;
}

/**
 * Break a (possibly long) sentence into chunks small enough for one TTS call.
 * Prefers clause boundaries (commas, semicolons, conjunctions).
 */
export function chunkForTts(text: string, maxChars = 950): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const clauses = clean.split(/(?<=[,;:—–-])\s+|\s+(?:and|but|or|so|because|while|although|however)\s+/i);
  const chunks: string[] = [];
  let current = "";
  const push = (c: string) => {
    // Hard-split any remaining overlong piece at whitespace.
    let rest = c.trim();
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < maxChars * 0.4) cut = maxChars;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  };

  for (const clause of clauses) {
    const candidate = current ? `${current} ${clause}` : clause;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) push(current);
      current = clause;
    }
  }
  if (current) push(current);
  return chunks.filter(Boolean);
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return text.trim() ? words.length : 0;
}

/** Rough spoken duration estimate (~850 chars/min for English narration). */
export function estimateDurationMs(text: string): number {
  return Math.round((text.length / 850) * 60_000);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
