import path from "path";
import { mkdirSync } from "fs";

/** Root data directory for the sqlite db + audio cache (persisted volume). */
export const DATA_DIR: string =
  process.env.DATA_DIR || path.join(process.cwd(), "data");

export const DB_PATH: string =
  process.env.DB_PATH || path.join(DATA_DIR, "voxshelf.db");

/** Pre-rename database filename, auto-migrated on first boot (see db.ts). */
export const LEGACY_DB_PATH: string = path.join(DATA_DIR, "vocalflow.db");

export const AUDIO_DIR: string = path.join(DATA_DIR, "audio");

export const UPLOAD_DIR: string = path.join(DATA_DIR, "uploads");

export function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AUDIO_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
}
