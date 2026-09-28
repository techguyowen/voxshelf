import { dbGet, dbRun } from "./db";
import type { PublicSettings } from "./types";
import { DEFAULT_VOICE, isValidVoice } from "./voices";

export const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
export const DEFAULT_TEXT_MODEL = "gemini-3.8-flash";

export function getSetting(key: string, fallback = ""): string {
  try {
    const row = dbGet<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      key,
    );
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: string): void {
  dbRun(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    key,
    value,
    new Date().toISOString(),
  );
}

/** Resolution order: explicit request key -> stored setting -> environment. */
export function resolveApiKey(explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const stored = getSetting("gemini_api_key", "").trim();
  if (stored) return stored;
  return (process.env.GEMINI_API_KEY || "").trim();
}

export function getDefaultVoice(): string {
  const v = getSetting("default_voice", DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  return isValidVoice(v) ? v : DEFAULT_VOICE;
}

export function getDefaultSpeed(): number {
  const raw = Number(getSetting("default_speed", "1"));
  if (!Number.isFinite(raw)) return 1;
  return Math.min(4.5, Math.max(0.5, raw));
}

export function getTtsModel(): string {
  return (
    getSetting("tts_model", "").trim() ||
    process.env.GEMINI_TTS_MODEL?.trim() ||
    DEFAULT_TTS_MODEL
  );
}

export function getTextModel(): string {
  return (
    getSetting("text_model", "").trim() ||
    process.env.GEMINI_TEXT_MODEL?.trim() ||
    DEFAULT_TEXT_MODEL
  );
}

export function getPublicSettings(): PublicSettings {
  return {
    hasApiKey: Boolean(resolveApiKey()),
    serverKeyConfigured: Boolean((process.env.GEMINI_API_KEY || "").trim()),
    defaultVoice: getDefaultVoice(),
    defaultSpeed: getDefaultSpeed(),
    ttsModel: getTtsModel(),
    textModel: getTextModel(),
  };
}
