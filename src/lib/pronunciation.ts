import { dbAll } from "./db";
import type { PronunciationRule } from "./types";

interface RuleRow {
  id: string;
  word: string;
  replacement: string;
  case_sensitive: number;
  created_at: string;
}

function rowToRule(r: RuleRow): PronunciationRule {
  return {
    id: r.id,
    word: r.word,
    replacement: r.replacement,
    caseSensitive: r.case_sensitive === 1,
    createdAt: r.created_at,
  };
}

/** Load all pronunciation rules from the database (server-only). */
export function loadPronunciationRules(): PronunciationRule[] {
  try {
    const rows = dbAll<RuleRow>(
      "SELECT id, word, replacement, case_sensitive, created_at FROM pronunciation_dictionary ORDER BY LENGTH(word) DESC",
    );
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

// Short-lived cache so pre-render loops don't hit SQLite per sentence.
let ruleCache: { at: number; rules: PronunciationRule[] } | null = null;
const RULE_CACHE_MS = 10_000;

export function loadPronunciationRulesCached(): PronunciationRule[] {
  const now = Date.now();
  if (ruleCache && now - ruleCache.at < RULE_CACHE_MS) return ruleCache.rules;
  const rules = loadPronunciationRules();
  ruleCache = { at: now, rules };
  return rules;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ParsedPattern {
  source: string;
  wordBoundaries: boolean;
}

/**
 * A rule word wrapped in slashes (e.g. `/\d+st/`) is treated as a raw regex.
 * Anything else is matched literally as a whole word.
 */
function parsePattern(word: string): ParsedPattern | null {
  const w = word.trim();
  if (!w) return null;
  if (w.length >= 2 && w.startsWith("/") && w.lastIndexOf("/") > 0) {
    const lastSlash = w.lastIndexOf("/");
    const source = w.slice(1, lastSlash);
    if (!source) return null;
    try {
      new RegExp(source);
    } catch {
      return null;
    }
    return { source, wordBoundaries: false };
  }
  return { source: escapeRegExp(w), wordBoundaries: true };
}

/**
 * Apply pronunciation substitutions to speakable text. Longer words apply
 * first so overlapping rules resolve to the most specific match.
 */
export function applyPronunciationRules(
  text: string,
  rules?: PronunciationRule[],
): string {
  const list = rules ?? loadPronunciationRulesCached();
  if (!text || list.length === 0) return text;
  let out = text;
  for (const rule of list) {
    if (!rule.replacement && rule.replacement !== "") continue;
    const parsed = parsePattern(rule.word);
    if (!parsed) continue;
    const pattern = parsed.wordBoundaries
      ? `\\b${parsed.source}\\b`
      : parsed.source;
    try {
      const re = new RegExp(pattern, rule.caseSensitive ? "g" : "gi");
      out = out.replace(re, rule.replacement);
    } catch {
      // Skip invalid patterns rather than breaking synthesis.
    }
  }
  return out;
}
