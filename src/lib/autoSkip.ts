// Rule-based (and AI-enhanced heuristic) auto-skip engine for VocalFlow.
// Strips boilerplate from speech audio: headers, footers, footnotes, tables,
// formulas, citations, URLs, and parenthetical/bracketed/braced asides.

export type AutoSkipMode = "ai" | "rules";

export interface AutoSkipOptions {
  enabled: boolean;
  mode: AutoSkipMode;
  skipHeaders: boolean;
  skipFooters: boolean;
  skipFootnotes: boolean;
  skipTables: boolean;
  skipFormulas: boolean;
  skipCitations: boolean;
  skipUrls: boolean;
  skipParentheses: boolean;
  skipBrackets: boolean;
  skipBraces: boolean;
}

export const DEFAULT_AUTOSKIP: AutoSkipOptions = {
  enabled: false,
  mode: "ai",
  skipHeaders: true,
  skipFooters: true,
  skipFootnotes: true,
  skipTables: true,
  skipFormulas: true,
  skipCitations: true,
  skipUrls: true,
  skipParentheses: false,
  skipBrackets: false,
  skipBraces: false,
};

const AUTOSKIP_KEY = "vf-autoskip";

export function loadAutoSkip(): AutoSkipOptions {
  try {
    const raw = localStorage.getItem(AUTOSKIP_KEY);
    if (!raw) return DEFAULT_AUTOSKIP;
    const parsed = JSON.parse(raw) as Partial<AutoSkipOptions>;
    return { ...DEFAULT_AUTOSKIP, ...parsed };
  } catch {
    return DEFAULT_AUTOSKIP;
  }
}

export function saveAutoSkip(opts: AutoSkipOptions): void {
  try {
    localStorage.setItem(AUTOSKIP_KEY, JSON.stringify(opts));
  } catch {
    // private mode etc.
  }
}

const URL_RE =
  /\b(?:https?:\/\/|www\.|ftp:\/\/)[^\s)\]}>"]+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^\s)\]}>"]*)?/gi;

const CITATION_RE = /\([A-Z][A-Za-z'’.-]+(?:\s+et\s+al\.?)?(?:\s*,\s*\d{4}[a-z]?)\)/g;

const LATEX_CMD_RE =
  /\\(?:lambda|frac|sum|int|sqrt|alpha|beta|gamma|delta|theta|pi|sigma|omega|infty|times|div|pm|leq|geq|neq|approx|rightarrow|left|right|begin|end|mathbf|mathit|mathrm|text|overline|underline|hat|bar|dot)\b/;

const PAGE_NUM_RE = /^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$/i;
const PAGE_OF_RE = /\bpages?\s+\d{1,4}\s+of\s+\d{1,4}\b/i;
const FOOTNOTE_LINE_RE = /^\d{1,3}[.)]\s+[A-ZÀ-Ž]/;
const FOOTNOTE_SUP_RE = /\[(\d{1,3})\]/g;
const CHAPTER_RE =
  /^(?:chapter|part|section|volume|book|act|scene|episode|lecture|lesson)\s+[\divxlc]+/i;
const BYLINE_RE = /^(?:by|written by|authored by|edited by|translated by)\s+[A-ZÀ-Ž]/i;

function stripBalanced(text: string, open: string, close: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
    }
    if (depth === 0) out += ch;
  }
  return out;
}

function isAllCapsHeader(text: string, ai: boolean): boolean {
  const letters = text.replace(/[^A-Za-zÀ-ž]/g, "");
  if (letters.length < (ai ? 8 : 12)) return false;
  const upper = (text.match(/[A-ZÀ-Ž]/g) || []).length;
  const ratio = upper / letters.length;
  return ratio > 0.85 && text.length < (ai ? 120 : 80);
}

function looksLikeHeader(text: string, ai: boolean): boolean {
  const t = text.trim();
  if (!t) return false;
  if (CHAPTER_RE.test(t)) return true;
  if (BYLINE_RE.test(t)) return true;
  // Title-case short line ending without sentence punctuation.
  if (t.length < (ai ? 90 : 60) && !/[.!?;:]$/.test(t)) {
    const words = t.split(/\s+/);
    if (words.length >= 2 && words.length <= (ai ? 12 : 8)) {
      const capped = words.filter((w) => /^[A-ZÀ-Ž0-9]/.test(w)).length;
      if (capped / words.length >= 0.6) return true;
    }
  }
  if (isAllCapsHeader(t, ai)) return true;
  return false;
}

function looksLikeFooter(text: string, ai: boolean): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PAGE_NUM_RE.test(t)) return true;
  if (PAGE_OF_RE.test(t) && t.length < 60) return true;
  if (ai && /^[-–—\d\s]+$/.test(t) && /\d/.test(t) && t.length < 30) return true;
  if (/©|all rights reserved|printed in/i.test(t) && t.length < 120) return true;
  return false;
}

function looksLikeFootnote(text: string, ai: boolean): boolean {
  const t = text.trim();
  if (!t) return false;
  if (FOOTNOTE_LINE_RE.test(t)) return true;
  // "Ibid.", "op. cit." style scholarly notes.
  if (/^(?:ibid\.|ibidem|op\.\s*cit\.|loc\.\s*cit\.|cf\.)/i.test(t)) return true;
  if (ai && /^\[\d{1,3}\]\s*\S/.test(t)) return true;
  return false;
}

function looksLikeTable(text: string, ai: boolean): boolean {
  const t = text.trim();
  if (!t) return false;
  const pipes = (t.match(/\|/g) || []).length;
  if (pipes >= 2) return true;
  if (pipes === 1 && /\|[\s\d.,%$€£¥-]+$/.test(t)) return true;
  // Markdown grid separator rows.
  if (/^[\s|:-]+$/.test(t) && t.includes("|")) return true;
  // Tab-separated numeric row.
  if (ai && /\t/.test(t)) {
    const cells = t.split(/\t/).filter((c) => c.trim());
    if (cells.length >= 3) return true;
  }
  return false;
}

function looksLikeFormula(text: string, ai: boolean): boolean {
  const t = text.trim();
  if (!t) return false;
  if (LATEX_CMD_RE.test(t)) return true;
  if (/\\[a-zA-Z]+/.test(t) && /[=^_{}]/.test(t)) return true;
  // Bare equation: short, mostly symbols/digits, has = or inequality.
  const symCount = (t.match(/[=≈≠≤≥±×÷√∫∑∏∂^_{}$]/g) || []).length;
  if (symCount >= 1 && t.length < (ai ? 80 : 50)) {
    const alpha = (t.match(/[A-Za-zÀ-ž]/g) || []).length;
    if (alpha / Math.max(1, t.length) < 0.4) return true;
  }
  return false;
}

/**
 * Apply auto-skip rules to a single sentence.
 * Returns the speakable text plus whether the whole sentence should be
 * skipped (playback advances to the next readable sentence).
 */
export function applyAutoSkip(
  text: string,
  options: AutoSkipOptions,
): { text: string; shouldSkipSentence: boolean } {
  if (!options.enabled) return { text, shouldSkipSentence: false };
  const ai = options.mode === "ai";
  let out = text;

  if (options.skipUrls) {
    out = out.replace(URL_RE, " ");
  }
  if (options.skipCitations) {
    out = out.replace(CITATION_RE, " ");
  }
  if (options.skipParentheses) {
    out = stripBalanced(out, "(", ")");
  }
  if (options.skipBrackets) {
    out = out.replace(FOOTNOTE_SUP_RE, " ");
    out = stripBalanced(out, "[", "]");
  }
  if (options.skipBraces) {
    out = stripBalanced(out, "{", "}");
  }
  if (options.skipFootnotes) {
    // Inline superscript footnote markers like "[1]" even when brackets stay.
    out = out.replace(FOOTNOTE_SUP_RE, " ");
  }

  out = out.replace(/\s{2,}/g, " ").trim();
  // Drop empty punctuation-only residue like "." or "," left after stripping.
  if (/^[\s.,;:!?\-–—'"“”‘’()[\]{}]*$/.test(out)) out = "";

  const original = text.trim();
  let skip = false;
  if (!out) {
    // Everything was stripped: only skip when a strip rule did the work.
    skip =
      options.skipUrls ||
      options.skipCitations ||
      options.skipParentheses ||
      options.skipBrackets ||
      options.skipBraces ||
      options.skipFootnotes;
  }
  if (!skip && options.skipTables && looksLikeTable(original, ai)) skip = true;
  if (!skip && options.skipFormulas && looksLikeFormula(original, ai)) skip = true;
  if (!skip && options.skipFooters && looksLikeFooter(original, ai)) skip = true;
  if (!skip && options.skipFootnotes && looksLikeFootnote(original, ai)) skip = true;
  if (!skip && options.skipHeaders && looksLikeHeader(original, ai)) {
    // Never treat a long multi-clause sentence as a header.
    if (original.length < (ai ? 140 : 100)) skip = true;
  }

  return { text: out, shouldSkipSentence: skip };
}
