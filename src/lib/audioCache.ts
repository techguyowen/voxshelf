import { existsSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { AUDIO_DIR, ensureDirs } from "./paths";
import { audioFilePath } from "./audio";
import { dbAll, dbGet, dbRun } from "./db";
import type { CacheStats } from "./types";

export interface CachedAudio {
  hash: string;
  filePath: string;
  bytes: number;
  durationMs: number;
  voice: string;
  useCount: number;
}

interface AudioCacheRow {
  hash: string;
  voice: string;
  style_prompt: string;
  chars: number;
  bytes: number;
  duration_ms: number;
  use_count: number;
}

export function getCachedAudio(hash: string): CachedAudio | null {
  if (!/^[0-9a-f]{8,128}$/i.test(hash)) return null;
  const row = dbGet<AudioCacheRow>(
    "SELECT hash, voice, style_prompt, chars, bytes, duration_ms, use_count FROM audio_cache WHERE hash = ?",
    hash,
  );
  const filePath = audioFilePath(hash);
  if (!row || !existsSync(filePath)) {
    if (row && !existsSync(filePath)) {
      dbRun("DELETE FROM audio_cache WHERE hash = ?", hash);
    }
    return null;
  }
  const ts = new Date().toISOString();
  dbRun(
    "UPDATE audio_cache SET last_used_at = ?, use_count = use_count + 1 WHERE hash = ?",
    ts,
    hash,
  );
  return {
    hash,
    filePath,
    bytes: row.bytes,
    durationMs: row.duration_ms,
    voice: row.voice,
    useCount: row.use_count + 1,
  };
}

export function saveCachedAudio(entry: {
  hash: string;
  voice: string;
  stylePrompt: string;
  textPreview: string;
  chars: number;
  wav: Buffer;
  durationMs: number;
}): CachedAudio {
  ensureDirs();
  const filePath = audioFilePath(entry.hash);
  writeFileSync(filePath, entry.wav);
  const ts = new Date().toISOString();
  dbRun(
    `INSERT INTO audio_cache (hash, voice, style_prompt, text_preview, chars, file_path, bytes, duration_ms, created_at, last_used_at, use_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(hash) DO UPDATE SET voice = excluded.voice, style_prompt = excluded.style_prompt,
       text_preview = excluded.text_preview, chars = excluded.chars, file_path = excluded.file_path,
       bytes = excluded.bytes, duration_ms = excluded.duration_ms, last_used_at = excluded.last_used_at,
       use_count = audio_cache.use_count + 1`,
    entry.hash,
    entry.voice,
    entry.stylePrompt,
    entry.textPreview.slice(0, 200),
    entry.chars,
    filePath,
    entry.wav.length,
    entry.durationMs,
    ts,
    ts,
  );
  const row = dbGet<AudioCacheRow>(
    "SELECT hash, voice, style_prompt, chars, bytes, duration_ms, use_count FROM audio_cache WHERE hash = ?",
    entry.hash,
  );
  return {
    hash: entry.hash,
    filePath,
    bytes: entry.wav.length,
    durationMs: entry.durationMs,
    voice: entry.voice,
    useCount: row?.use_count ?? 1,
  };
}

export function cacheStats(): CacheStats {
  const row = dbGet<{ entries: number; bytes: number }>(
    "SELECT COUNT(*) AS entries, COALESCE(SUM(bytes), 0) AS bytes FROM audio_cache",
  );
  let files = 0;
  try {
    files = readdirSync(AUDIO_DIR).filter((f) => f.endsWith(".wav")).length;
  } catch {
    files = 0;
  }
  return {
    entries: row?.entries ?? 0,
    bytes: row?.bytes ?? 0,
    files,
    audioDir: AUDIO_DIR,
  };
}

export function clearCache(): { removed: number; bytes: number } {
  const rows = dbAll<{ hash: string; bytes: number }>(
    "SELECT hash, bytes FROM audio_cache",
  );
  let removed = 0;
  let bytes = 0;
  for (const r of rows) {
    try {
      unlinkSync(audioFilePath(r.hash));
    } catch {
      // File already gone; still drop the row.
    }
    removed += 1;
    bytes += r.bytes;
  }
  // Remove orphan wav files with no db row.
  try {
    for (const f of readdirSync(AUDIO_DIR)) {
      if (f.endsWith(".wav")) {
        try {
          unlinkSync(`${AUDIO_DIR}/${f}`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  dbRun("DELETE FROM audio_cache");
  dbRun("UPDATE sentences SET audio_hash = NULL, audio_duration_ms = NULL");
  return { removed, bytes };
}
