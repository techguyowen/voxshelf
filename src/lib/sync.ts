// Two-way sync engine (local-first, last-write-wins).
//
// One node (usually the Docker server) acts as a passive peer: it only serves
// /api/sync/pull and /api/sync/push. Any other node (desktop app, another
// server) runs the worker in syncWorker.ts, which push/pull loops against it.
// See docs/SYNC.md for the protocol, conflict rules, and limitations.

import { dbAll, dbGet, dbRun } from "./db";

export const SYNC_VERSION = 1;

/** Tables synced, in dependency order (parents before children). */
export const SYNC_TABLES = [
  "folders",
  "documents",
  "settings",
  "pronunciations",
  "bookmarks",
  "highlights",
  "podcasts",
  "sessions",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export type SyncCursors = Record<SyncTable | "tombstones", string>;

export interface SyncSentence {
  idx: number;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface SyncDoc {
  id: string;
  title: string;
  author: string | null;
  sourceType: string;
  sourceUrl: string | null;
  fullText: string;
  totalChars: number;
  wordCount: number;
  sentenceCount: number;
  voice: string;
  stylePrompt: string | null;
  speed: number;
  folderId: string | null;
  tags: string;
  progressSentenceIndex: number;
  progressCharOffset: number;
  progressUpdatedAt: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  metadata: string;
  sentences: SyncSentence[];
}

export interface SyncBookmark {
  id: string;
  docId: string;
  sentenceIdx: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncHighlight {
  id: string;
  docId: string;
  sentenceIdx: number;
  text: string;
  color: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncFolder {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncPodcast {
  id: string;
  docId: string;
  title: string;
  script: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface SyncPronunciation {
  id: string;
  word: string;
  replacement: string;
  caseSensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncSession {
  id: string;
  docId: string;
  durationSeconds: number;
  wordsRead: number;
  speed: number;
  createdAt: string;
}

export interface SyncTombstone {
  table: string;
  rowId: string;
  deletedAt: string;
}

export interface SyncChanges {
  folders: SyncFolder[];
  documents: SyncDoc[];
  settings: SyncSetting[];
  pronunciations: SyncPronunciation[];
  bookmarks: SyncBookmark[];
  highlights: SyncHighlight[];
  podcasts: SyncPodcast[];
  sessions: SyncSession[];
}

export interface SyncPullResult {
  changes: SyncChanges;
  tombstones: SyncTombstone[];
  cursors: SyncCursors;
  hasMore: boolean;
}

export interface SyncApplyResult {
  applied: Record<string, number>;
  conflicts: number;
  rejected: number;
  skippedOrphans: number;
}

/** Settings keys that stay on their own device and never sync. */
const LOCAL_ONLY_SETTINGS = new Set(["schema_version", "gemini_api_key"]);

/** Tombstone-eligible tables (wire name -> real table). */
const TOMBSTONE_TABLES: Record<string, string> = {
  documents: "documents",
  bookmarks: "bookmarks",
  highlights: "highlights",
  folders: "folders",
  podcasts: "podcasts",
  pronunciation_dictionary: "pronunciation_dictionary",
  pronunciations: "pronunciation_dictionary",
};

const DOCS_PER_PAGE = 20;
const ROWS_PER_PAGE = 500;

export function emptyCursors(): SyncCursors {
  return {
    folders: "",
    documents: "",
    settings: "",
    pronunciations: "",
    bookmarks: "",
    highlights: "",
    podcasts: "",
    sessions: "",
    tombstones: "",
  };
}

export function normalizeCursors(input: unknown): SyncCursors {
  const out = emptyCursors();
  if (!input || typeof input !== "object") return out;
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(out) as (keyof SyncCursors)[]) {
    const v = obj[key];
    out[key] = typeof v === "string" ? v.slice(0, 64) : "";
  }
  return out;
}

export function normalizeTables(input: unknown): SyncTable[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return null;
  const set = new Set(SYNC_TABLES as readonly string[]);
  const picked = input.filter(
    (t): t is SyncTable => typeof t === "string" && set.has(t),
  );
  return picked.length > 0 ? picked : null;
}

// ---------- validation helpers (never throw on row data) ----------

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

function optStr(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v.slice(0, max) : null;
}

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function int(v: unknown, min: number, max: number): number | null {
  const n = num(v, min, max);
  return n === null ? null : Math.floor(n);
}

function iso(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function cleanDoc(v: unknown): SyncDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const fullText = str(o.fullText, 2_000_000);
  const updatedAt = iso(o.updatedAt);
  const createdAt = iso(o.createdAt);
  if (!id || fullText === null || !updatedAt || !createdAt) return null;
  if (!Array.isArray(o.sentences) || o.sentences.length > 20000) return null;
  const sentences: SyncSentence[] = [];
  for (const s of o.sentences as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const r = s as Record<string, unknown>;
    const idx = int(r.idx, 0, 20000);
    const text = str(r.text, 20000);
    const charStart = int(r.charStart, 0, 2_000_000);
    const charEnd = int(r.charEnd, 0, 2_000_000);
    if (idx === null || text === null || charStart === null || charEnd === null) {
      return null;
    }
    sentences.push({ idx, text, charStart, charEnd });
  }
  const title = str(o.title, 300);
  const totalChars = int(o.totalChars, 0, 2_000_000);
  const wordCount = int(o.wordCount, 0, 1_000_000);
  const sentenceCount = int(o.sentenceCount, 0, 20000);
  const voice = str(o.voice, 64);
  const speed = num(o.speed, 0.5, 4.5);
  const progressSentenceIndex = int(o.progressSentenceIndex, 0, 20000);
  const progressCharOffset = int(o.progressCharOffset, 0, 2_000_000);
  if (
    title === null ||
    totalChars === null ||
    wordCount === null ||
    sentenceCount === null ||
    voice === null ||
    speed === null ||
    progressSentenceIndex === null ||
    progressCharOffset === null
  ) {
    return null;
  }
  const progressUpdatedAt =
    o.progressUpdatedAt === null || o.progressUpdatedAt === undefined
      ? null
      : iso(o.progressUpdatedAt);
  if (o.progressUpdatedAt !== null && o.progressUpdatedAt !== undefined && !progressUpdatedAt) {
    return null;
  }
  return {
    id,
    title,
    author: optStr(o.author, 300),
    sourceType: str(o.sourceType, 32) ?? "paste",
    sourceUrl: optStr(o.sourceUrl, 2000),
    fullText,
    totalChars,
    wordCount,
    sentenceCount,
    voice,
    stylePrompt: optStr(o.stylePrompt, 1000),
    speed,
    folderId: optStr(o.folderId, 128),
    tags: str(o.tags, 2000) ?? "[]",
    progressSentenceIndex,
    progressCharOffset,
    progressUpdatedAt,
    isArchived: o.isArchived === true,
    createdAt,
    updatedAt,
    metadata: str(o.metadata, 20000) ?? "{}",
    sentences,
  };
}

function cleanBookmark(v: unknown): SyncBookmark | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const docId = str(o.docId, 128);
  const sentenceIdx = int(o.sentenceIdx, 0, 20000);
  const createdAt = iso(o.createdAt);
  const updatedAt = iso(o.updatedAt);
  if (!id || !docId || sentenceIdx === null || !createdAt || !updatedAt) return null;
  return { id, docId, sentenceIdx, note: optStr(o.note, 2000), createdAt, updatedAt };
}

function cleanHighlight(v: unknown): SyncHighlight | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const docId = str(o.docId, 128);
  const sentenceIdx = int(o.sentenceIdx, 0, 20000);
  const text = str(o.text, 2000);
  const createdAt = iso(o.createdAt);
  const updatedAt = iso(o.updatedAt);
  if (!id || !docId || sentenceIdx === null || text === null || !createdAt || !updatedAt) {
    return null;
  }
  return {
    id,
    docId,
    sentenceIdx,
    text,
    color: str(o.color, 32) ?? "yellow",
    note: optStr(o.note, 2000),
    createdAt,
    updatedAt,
  };
}

function cleanFolder(v: unknown): SyncFolder | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const name = str(o.name, 100);
  const createdAt = iso(o.createdAt);
  const updatedAt = iso(o.updatedAt);
  if (!id || !name || !createdAt || !updatedAt) return null;
  return { id, name, color: optStr(o.color, 32), createdAt, updatedAt };
}

function cleanPodcast(v: unknown): SyncPodcast | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const docId = str(o.docId, 128);
  const title = str(o.title, 300);
  const script = str(o.script, 200000);
  const createdAt = iso(o.createdAt);
  const updatedAt = iso(o.updatedAt);
  if (!id || !docId || !title || script === null || !createdAt || !updatedAt) return null;
  return { id, docId, title, script, createdAt, updatedAt };
}

function cleanSetting(v: unknown): SyncSetting | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const key = str(o.key, 128);
  const value = str(o.value, 20000);
  const updatedAt = iso(o.updatedAt);
  if (!key || value === null || !updatedAt) return null;
  if (LOCAL_ONLY_SETTINGS.has(key)) return null;
  return { key, value, updatedAt };
}

function cleanPronunciation(v: unknown): SyncPronunciation | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const word = str(o.word, 200);
  const replacement = str(o.replacement, 500);
  const createdAt = iso(o.createdAt);
  const updatedAt = iso(o.updatedAt);
  if (!id || !word || replacement === null || !createdAt || !updatedAt) return null;
  return { id, word, replacement, caseSensitive: o.caseSensitive === true, createdAt, updatedAt };
}

function cleanSession(v: unknown): SyncSession | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  const docId = str(o.docId, 128);
  const durationSeconds = int(o.durationSeconds, 1, 3600);
  const wordsRead = int(o.wordsRead, 0, 100000);
  const speed = num(o.speed, 0.5, 4.5);
  const createdAt = iso(o.createdAt);
  if (!id || !docId || durationSeconds === null || wordsRead === null || speed === null || !createdAt) {
    return null;
  }
  return { id, docId, durationSeconds, wordsRead, speed, createdAt };
}

function cleanTombstone(v: unknown): SyncTombstone | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const table = typeof o.table === "string" ? o.table : null;
  const rowId = str(o.rowId, 128);
  const deletedAt = iso(o.deletedAt);
  if (!table || !TOMBSTONE_TABLES[table] || !rowId || !deletedAt) return null;
  return { table, rowId, deletedAt };
}

export function cleanChanges(input: unknown): { changes: SyncChanges; rejected: number } {
  const empty: SyncChanges = {
    folders: [],
    documents: [],
    settings: [],
    pronunciations: [],
    bookmarks: [],
    highlights: [],
    podcasts: [],
    sessions: [],
  };
  if (!input || typeof input !== "object") return { changes: empty, rejected: 0 };
  const o = input as Record<string, unknown>;
  let rejected = 0;
  const pick = <T>(key: string, clean: (v: unknown) => T | null): T[] => {
    const arr = o[key];
    if (!Array.isArray(arr)) return [];
    const out: T[] = [];
    for (const v of arr.slice(0, 2000)) {
      const c = clean(v);
      if (c) out.push(c);
      else rejected += 1;
    }
    return out;
  };
  return {
    changes: {
      folders: pick("folders", cleanFolder),
      documents: pick("documents", cleanDoc),
      settings: pick("settings", cleanSetting),
      pronunciations: pick("pronunciations", cleanPronunciation),
      bookmarks: pick("bookmarks", cleanBookmark),
      highlights: pick("highlights", cleanHighlight),
      podcasts: pick("podcasts", cleanPodcast),
      sessions: pick("sessions", cleanSession),
    },
    rejected,
  };
}

export function cleanTombstones(input: unknown): { tombstones: SyncTombstone[]; rejected: number } {
  if (!Array.isArray(input)) return { tombstones: [], rejected: 0 };
  const out: SyncTombstone[] = [];
  let rejected = 0;
  for (const v of input.slice(0, 2000)) {
    const c = cleanTombstone(v);
    if (c) out.push(c);
    else rejected += 1;
  }
  return { tombstones: out, rejected };
}

// ---------- collect: rows newer than the peer's cursor ----------

interface DocumentRow {
  id: string;
  title: string;
  author: string | null;
  source_type: string;
  source_url: string | null;
  full_text: string;
  total_chars: number;
  word_count: number;
  sentence_count: number;
  voice: string;
  style_prompt: string | null;
  speed: number;
  folder_id: string | null;
  tags: string;
  progress_sentence_index: number;
  progress_char_offset: number;
  progress_updated_at: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
  metadata: string;
}

/** Effective write stamp: progress-only plays must sync too. */
export function docStamp(updatedAt: string, progressUpdatedAt: string | null): string {
  return progressUpdatedAt && progressUpdatedAt > updatedAt ? progressUpdatedAt : updatedAt;
}

function collectDocuments(cursor: string): { rows: SyncDoc[]; cursor: string; hasMore: boolean } {
  const docs = dbAll<DocumentRow>(
    `SELECT * FROM documents
     WHERE max(updated_at, ifnull(progress_updated_at, '')) > ?
     ORDER BY max(updated_at, ifnull(progress_updated_at, '')) ASC
     LIMIT ?`,
    cursor,
    DOCS_PER_PAGE,
  );
  const rows: SyncDoc[] = docs.map((d) => {
    const sentences = dbAll<{ idx: number; text: string; char_start: number; char_end: number }>(
      "SELECT idx, text, char_start, char_end FROM sentences WHERE doc_id = ? ORDER BY idx ASC",
      d.id,
    );
    return {
      id: d.id,
      title: d.title,
      author: d.author,
      sourceType: d.source_type,
      sourceUrl: d.source_url,
      fullText: d.full_text,
      totalChars: d.total_chars,
      wordCount: d.word_count,
      sentenceCount: d.sentence_count,
      voice: d.voice,
      stylePrompt: d.style_prompt,
      speed: d.speed,
      folderId: d.folder_id,
      tags: d.tags,
      progressSentenceIndex: d.progress_sentence_index,
      progressCharOffset: d.progress_char_offset,
      progressUpdatedAt: d.progress_updated_at,
      isArchived: d.is_archived === 1,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      metadata: d.metadata ?? "{}",
      sentences: sentences.map((s) => ({
        idx: s.idx,
        text: s.text,
        charStart: s.char_start,
        charEnd: s.char_end,
      })),
    };
  });
  let next = cursor;
  for (const r of rows) {
    const stamp = docStamp(r.updatedAt, r.progressUpdatedAt);
    if (stamp > next) next = stamp;
  }
  return { rows, cursor: next, hasMore: rows.length === DOCS_PER_PAGE };
}

function collectSimple<T>(
  sql: string,
  cursor: string,
  map: (row: Record<string, never>) => T,
  stampOf: (row: T) => string,
): { rows: T[]; cursor: string; hasMore: boolean } {
  const found = dbAll<Record<string, never>>(sql, cursor, ROWS_PER_PAGE).map(map);
  let next = cursor;
  for (const r of found) {
    const stamp = stampOf(r);
    if (stamp > next) next = stamp;
  }
  return { rows: found, cursor: next, hasMore: found.length === ROWS_PER_PAGE };
}

export function collectChanges(
  cursors: SyncCursors,
  tables: SyncTable[] | null = null,
): SyncPullResult {
  const want = new Set<string>(tables ?? SYNC_TABLES);
  const changes: SyncChanges = {
    folders: [],
    documents: [],
    settings: [],
    pronunciations: [],
    bookmarks: [],
    highlights: [],
    podcasts: [],
    sessions: [],
  };
  const next: SyncCursors = { ...cursors };
  let hasMore = false;

  if (want.has("folders")) {
    const r = collectSimple(
      "SELECT * FROM folders WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?",
      cursors.folders,
      (f) => ({
        id: String(f.id),
        name: String(f.name),
        color: (f.color as string | null) ?? null,
        createdAt: String(f.created_at),
        updatedAt: String(f.updated_at),
      }),
      (r) => r.updatedAt,
    );
    changes.folders = r.rows;
    next.folders = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("documents")) {
    const r = collectDocuments(cursors.documents);
    changes.documents = r.rows;
    next.documents = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("settings")) {
    const r = collectSimple(
      `SELECT key, value, updated_at FROM settings
       WHERE updated_at > ? AND key NOT IN ('schema_version', 'gemini_api_key')
       ORDER BY updated_at ASC LIMIT ?`,
      cursors.settings,
      (s) => ({
        key: String(s.key),
        value: String(s.value),
        updatedAt: String(s.updated_at),
      }),
      (r) => r.updatedAt,
    );
    changes.settings = r.rows;
    next.settings = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("pronunciations")) {
    const r = collectSimple(
      "SELECT * FROM pronunciation_dictionary WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?",
      cursors.pronunciations,
      (p) => ({
        id: String(p.id),
        word: String(p.word),
        replacement: String(p.replacement),
        caseSensitive: Number(p.case_sensitive) === 1,
        createdAt: String(p.created_at),
        updatedAt: String(p.updated_at),
      }),
      (r) => r.updatedAt,
    );
    changes.pronunciations = r.rows;
    next.pronunciations = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("bookmarks")) {
    const r = collectSimple(
      "SELECT * FROM bookmarks WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?",
      cursors.bookmarks,
      (b) => ({
        id: String(b.id),
        docId: String(b.doc_id),
        sentenceIdx: Number(b.sentence_idx),
        note: (b.note as string | null) ?? null,
        createdAt: String(b.created_at),
        updatedAt: String(b.updated_at),
      }),
      (r) => r.updatedAt,
    );
    changes.bookmarks = r.rows;
    next.bookmarks = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("highlights")) {
    const r = collectSimple(
      "SELECT * FROM highlights WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?",
      cursors.highlights,
      (h) => ({
        id: String(h.id),
        docId: String(h.doc_id),
        sentenceIdx: Number(h.sentence_idx),
        text: String(h.text),
        color: String(h.color),
        note: (h.note as string | null) ?? null,
        createdAt: String(h.created_at),
        updatedAt: String(h.updated_at),
      }),
      (r) => r.updatedAt,
    );
    changes.highlights = r.rows;
    next.highlights = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("podcasts")) {
    const r = collectSimple(
      "SELECT * FROM podcasts WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?",
      cursors.podcasts,
      (p) => ({
        id: String(p.id),
        docId: String(p.doc_id),
        title: String(p.title),
        script: String(p.script),
        createdAt: String(p.created_at),
        updatedAt: String(p.updated_at),
      }),
      (r) => r.updatedAt,
    );
    changes.podcasts = r.rows;
    next.podcasts = r.cursor;
    hasMore = hasMore || r.hasMore;
  }
  if (want.has("sessions")) {
    const r = collectSimple(
      "SELECT * FROM reading_sessions WHERE created_at > ? ORDER BY created_at ASC LIMIT ?",
      cursors.sessions,
      (s) => ({
        id: String(s.id),
        docId: String(s.doc_id),
        durationSeconds: Number(s.duration_seconds),
        wordsRead: Number(s.words_read),
        speed: Number(s.speed),
        createdAt: String(s.created_at),
      }),
      (r) => r.createdAt,
    );
    changes.sessions = r.rows;
    next.sessions = r.cursor;
    hasMore = hasMore || r.hasMore;
  }

  const tombs = dbAll<{ table_name: string; row_id: string; deleted_at: string }>(
    "SELECT table_name, row_id, deleted_at FROM _sync_tombstones WHERE deleted_at > ? ORDER BY deleted_at ASC LIMIT ?",
    cursors.tombstones,
    ROWS_PER_PAGE,
  );
  const tombstones: SyncTombstone[] = tombs.map((t) => ({
    table: t.table_name,
    rowId: t.row_id,
    deletedAt: t.deleted_at,
  }));
  for (const t of tombstones) {
    if (t.deletedAt > next.tombstones) next.tombstones = t.deletedAt;
  }
  hasMore = hasMore || tombstones.length === ROWS_PER_PAGE;

  return { changes, tombstones, cursors: next, hasMore };
}

// ---------- apply: last-write-wins merge of incoming changes ----------

function tombstoneFor(table: string, rowId: string): string | null {
  const row = dbGet<{ deleted_at: string }>(
    "SELECT deleted_at FROM _sync_tombstones WHERE table_name = ? AND row_id = ?",
    table,
    rowId,
  );
  return row?.deleted_at ?? null;
}

function clearTombstone(table: string, rowId: string): void {
  dbRun("DELETE FROM _sync_tombstones WHERE table_name = ? AND row_id = ?", table, rowId);
}

function deleteByTable(table: string, id: string): void {
  if (table === "settings") {
    dbRun("DELETE FROM settings WHERE key = ?", id);
  } else {
    dbRun(`DELETE FROM ${table} WHERE id = ?`, id);
  }
}

function stampByTable(table: string, id: string): string | null {
  if (table === "settings") {
    return (
      dbGet<{ updated_at: string }>("SELECT updated_at FROM settings WHERE key = ?", id)
        ?.updated_at ?? null
    );
  }
  if (table === "reading_sessions") {
    return (
      dbGet<{ created_at: string }>("SELECT created_at FROM reading_sessions WHERE id = ?", id)
        ?.created_at ?? null
    );
  }
  if (table === "documents") {
    const row = dbGet<{ updated_at: string; progress_updated_at: string | null }>(
      "SELECT updated_at, progress_updated_at FROM documents WHERE id = ?",
      id,
    );
    return row ? docStamp(row.updated_at, row.progress_updated_at) : null;
  }
  const row = dbGet<{ updated_at: string }>(
    `SELECT updated_at FROM ${table} WHERE id = ?`,
    id,
  );
  return row?.updated_at ?? null;
}

function applyTombstone(t: SyncTombstone, result: SyncApplyResult): void {
  const table = TOMBSTONE_TABLES[t.table];
  if (!table) {
    result.rejected += 1;
    return;
  }
  dbRun(
    `INSERT INTO _sync_tombstones (table_name, row_id, deleted_at) VALUES (?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET deleted_at = excluded.deleted_at
     WHERE excluded.deleted_at > _sync_tombstones.deleted_at`,
    table,
    t.rowId,
    t.deletedAt,
  );
  const local = stampByTable(table, t.rowId);
  // A local edit newer than the delete wins (resurrects on the deleter's
  // next pull); otherwise the delete applies (documents cascade to children).
  if (local === null || local <= t.deletedAt) {
    deleteByTable(table, t.rowId);
    result.applied.tombstones = (result.applied.tombstones ?? 0) + 1;
  }
}

function replaceSentences(docId: string, sentences: SyncSentence[]): void {
  const prev = dbAll<{ idx: number; text: string; audio_hash: string | null; audio_duration_ms: number | null }>(
    "SELECT idx, text, audio_hash, audio_duration_ms FROM sentences WHERE doc_id = ?",
    docId,
  );
  const keep = new Map(prev.map((p) => [p.idx, p]));
  dbRun("DELETE FROM sentences WHERE doc_id = ?", docId);
  for (const s of sentences) {
    const old = keep.get(s.idx);
    const sameText = old?.text === s.text;
    dbRun(
      "INSERT INTO sentences (doc_id, idx, text, char_start, char_end, audio_hash, audio_duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      docId,
      s.idx,
      s.text,
      s.charStart,
      s.charEnd,
      sameText ? old?.audio_hash ?? null : null,
      sameText ? old?.audio_duration_ms ?? null : null,
    );
  }
}

function applyDocument(d: SyncDoc, result: SyncApplyResult): void {
  const tomb = tombstoneFor("documents", d.id);
  const stamp = docStamp(d.updatedAt, d.progressUpdatedAt);
  if (tomb && tomb >= stamp) return; // delete wins
  const local = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", d.id);
  if (!local) {
    dbRun(
      `INSERT INTO documents (id, title, author, source_type, source_url, full_text, total_chars, word_count, sentence_count, voice, style_prompt, speed, folder_id, tags, progress_sentence_index, progress_char_offset, progress_updated_at, is_archived, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.id,
      d.title,
      d.author,
      d.sourceType,
      d.sourceUrl,
      d.fullText,
      d.totalChars,
      d.wordCount,
      d.sentenceCount,
      d.voice,
      d.stylePrompt,
      d.speed,
      d.folderId,
      d.tags,
      d.progressSentenceIndex,
      d.progressCharOffset,
      d.progressUpdatedAt,
      d.isArchived ? 1 : 0,
      d.createdAt,
      d.updatedAt,
      d.metadata,
    );
    replaceSentences(d.id, d.sentences);
    if (tomb) clearTombstone("documents", d.id);
    result.applied.documents = (result.applied.documents ?? 0) + 1;
    return;
  }
  const localStamp = docStamp(local.updated_at, local.progress_updated_at);
  if (stamp > localStamp) {
    dbRun(
      `UPDATE documents SET title = ?, author = ?, source_type = ?, source_url = ?, full_text = ?, total_chars = ?, word_count = ?, sentence_count = ?, voice = ?, style_prompt = ?, speed = ?, folder_id = ?, tags = ?, progress_sentence_index = ?, progress_char_offset = ?, progress_updated_at = ?, is_archived = ?, created_at = ?, updated_at = ?, metadata = ? WHERE id = ?`,
      d.title,
      d.author,
      d.sourceType,
      d.sourceUrl,
      d.fullText,
      d.totalChars,
      d.wordCount,
      d.sentenceCount,
      d.voice,
      d.stylePrompt,
      d.speed,
      d.folderId,
      d.tags,
      d.progressSentenceIndex,
      d.progressCharOffset,
      d.progressUpdatedAt,
      d.isArchived ? 1 : 0,
      d.createdAt,
      d.updatedAt,
      d.metadata,
      d.id,
    );
    if (local.full_text !== d.fullText) replaceSentences(d.id, d.sentences);
    if (tomb) clearTombstone("documents", d.id);
    result.applied.documents = (result.applied.documents ?? 0) + 1;
  } else if (stamp < localStamp) {
    result.conflicts += 1;
  }
  // Equal stamps: already converged (or identical), nothing to do.
}

function applyFolder(f: SyncFolder, result: SyncApplyResult): void {
  const tomb = tombstoneFor("folders", f.id);
  if (tomb && tomb >= f.updatedAt) return;
  const local = dbGet<{ updated_at: string }>("SELECT updated_at FROM folders WHERE id = ?", f.id);
  if (!local) {
    dbRun(
      "INSERT INTO folders (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      f.id,
      f.name,
      f.color,
      f.createdAt,
      f.updatedAt,
    );
    if (tomb) clearTombstone("folders", f.id);
    result.applied.folders = (result.applied.folders ?? 0) + 1;
  } else if (f.updatedAt > local.updated_at) {
    dbRun(
      "UPDATE folders SET name = ?, color = ?, created_at = ?, updated_at = ? WHERE id = ?",
      f.name,
      f.color,
      f.createdAt,
      f.updatedAt,
      f.id,
    );
    if (tomb) clearTombstone("folders", f.id);
    result.applied.folders = (result.applied.folders ?? 0) + 1;
  } else if (f.updatedAt < local.updated_at) {
    result.conflicts += 1;
  }
}

function applySetting(s: SyncSetting, result: SyncApplyResult): void {
  const local = dbGet<{ updated_at: string }>("SELECT updated_at FROM settings WHERE key = ?", s.key);
  if (!local || s.updatedAt > local.updated_at) {
    dbRun(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      s.key,
      s.value,
      s.updatedAt,
    );
    result.applied.settings = (result.applied.settings ?? 0) + 1;
  } else if (s.updatedAt < local.updated_at) {
    result.conflicts += 1;
  }
}

function applyPronunciation(p: SyncPronunciation, result: SyncApplyResult): void {
  const tomb = tombstoneFor("pronunciation_dictionary", p.id);
  if (tomb && tomb >= p.updatedAt) return;
  const local = dbGet<{ word: string; updated_at: string }>(
    "SELECT word, updated_at FROM pronunciation_dictionary WHERE id = ?",
    p.id,
  );
  if (local && p.updatedAt < local.updated_at) {
    result.conflicts += 1;
    return;
  }
  if (local && p.updatedAt === local.updated_at) return;
  // `word` is UNIQUE: two devices may coin different ids for the same word.
  // Deterministic (updated_at, id) comparison keeps every node converged.
  const clash = dbGet<{ id: string; updated_at: string }>(
    "SELECT id, updated_at FROM pronunciation_dictionary WHERE word = ? AND id != ?",
    p.word,
    p.id,
  );
  if (clash && (clash.updated_at > p.updatedAt || (clash.updated_at === p.updatedAt && clash.id > p.id))) {
    result.conflicts += 1;
    return;
  }
  if (clash) {
    dbRun("DELETE FROM pronunciation_dictionary WHERE id = ?", clash.id);
  }
  dbRun(
    `INSERT INTO pronunciation_dictionary (id, word, replacement, case_sensitive, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET word = excluded.word, replacement = excluded.replacement, case_sensitive = excluded.case_sensitive, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    p.id,
    p.word,
    p.replacement,
    p.caseSensitive ? 1 : 0,
    p.createdAt,
    p.updatedAt,
  );
  if (tomb) clearTombstone("pronunciation_dictionary", p.id);
  result.applied.pronunciations = (result.applied.pronunciations ?? 0) + 1;
}

function docExists(docId: string): boolean {
  return !!dbGet<{ id: string }>("SELECT id FROM documents WHERE id = ?", docId);
}

function applyBookmark(b: SyncBookmark, result: SyncApplyResult): void {
  const tomb = tombstoneFor("bookmarks", b.id);
  if (tomb && tomb >= b.updatedAt) return;
  const local = dbGet<{ updated_at: string }>("SELECT updated_at FROM bookmarks WHERE id = ?", b.id);
  if (local && b.updatedAt < local.updated_at) {
    result.conflicts += 1;
    return;
  }
  if (local && b.updatedAt === local.updated_at) return;
  if (!docExists(b.docId)) {
    result.skippedOrphans += 1;
    return;
  }
  dbRun(
    `INSERT INTO bookmarks (id, doc_id, sentence_idx, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc_id = excluded.doc_id, sentence_idx = excluded.sentence_idx, note = excluded.note, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    b.id,
    b.docId,
    b.sentenceIdx,
    b.note,
    b.createdAt,
    b.updatedAt,
  );
  if (tomb) clearTombstone("bookmarks", b.id);
  result.applied.bookmarks = (result.applied.bookmarks ?? 0) + 1;
}

function applyHighlight(h: SyncHighlight, result: SyncApplyResult): void {
  const tomb = tombstoneFor("highlights", h.id);
  if (tomb && tomb >= h.updatedAt) return;
  const local = dbGet<{ updated_at: string }>("SELECT updated_at FROM highlights WHERE id = ?", h.id);
  if (local && h.updatedAt < local.updated_at) {
    result.conflicts += 1;
    return;
  }
  if (local && h.updatedAt === local.updated_at) return;
  if (!docExists(h.docId)) {
    result.skippedOrphans += 1;
    return;
  }
  dbRun(
    `INSERT INTO highlights (id, doc_id, sentence_idx, text, color, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc_id = excluded.doc_id, sentence_idx = excluded.sentence_idx, text = excluded.text, color = excluded.color, note = excluded.note, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    h.id,
    h.docId,
    h.sentenceIdx,
    h.text,
    h.color,
    h.note,
    h.createdAt,
    h.updatedAt,
  );
  if (tomb) clearTombstone("highlights", h.id);
  result.applied.highlights = (result.applied.highlights ?? 0) + 1;
}

function applyPodcast(p: SyncPodcast, result: SyncApplyResult): void {
  const tomb = tombstoneFor("podcasts", p.id);
  if (tomb && tomb >= p.updatedAt) return;
  const local = dbGet<{ updated_at: string }>("SELECT updated_at FROM podcasts WHERE id = ?", p.id);
  if (local && p.updatedAt <= local.updated_at) {
    if (p.updatedAt < local.updated_at) result.conflicts += 1;
    return;
  }
  if (!docExists(p.docId)) {
    result.skippedOrphans += 1;
    return;
  }
  // Episode audio never transfers (see SYNC.md); the script does.
  // Preserve locally generated audio when replacing an existing row.
  dbRun(
    `INSERT INTO podcasts (id, doc_id, title, script, audio_hash, duration_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc_id = excluded.doc_id, title = excluded.title, script = excluded.script, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    p.id,
    p.docId,
    p.title,
    p.script,
    p.createdAt,
    p.updatedAt,
  );
  if (tomb) clearTombstone("podcasts", p.id);
  result.applied.podcasts = (result.applied.podcasts ?? 0) + 1;
}

function applySession(s: SyncSession, result: SyncApplyResult): void {
  const exists = dbGet<{ id: string }>("SELECT id FROM reading_sessions WHERE id = ?", s.id);
  if (exists) return;
  if (!docExists(s.docId)) {
    result.skippedOrphans += 1;
    return;
  }
  dbRun(
    "INSERT OR IGNORE INTO reading_sessions (id, doc_id, duration_seconds, words_read, speed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    s.id,
    s.docId,
    s.durationSeconds,
    s.wordsRead,
    s.speed,
    s.createdAt,
  );
  result.applied.sessions = (result.applied.sessions ?? 0) + 1;
}

/** Merge validated incoming changes into the local db (dependency order). */
export function applyChanges(changes: SyncChanges, tombstones: SyncTombstone[]): SyncApplyResult {
  const result: SyncApplyResult = { applied: {}, conflicts: 0, rejected: 0, skippedOrphans: 0 };
  for (const t of tombstones) applyTombstone(t, result);
  for (const f of changes.folders) applyFolder(f, result);
  for (const d of changes.documents) applyDocument(d, result);
  for (const s of changes.settings) applySetting(s, result);
  for (const p of changes.pronunciations) applyPronunciation(p, result);
  for (const b of changes.bookmarks) applyBookmark(b, result);
  for (const h of changes.highlights) applyHighlight(h, result);
  for (const p of changes.podcasts) applyPodcast(p, result);
  for (const s of changes.sessions) applySession(s, result);
  return result;
}

/** Device-local selective-sync pick: explicit docs + whole folders. */
export interface SyncSelection {
  docs: string[];
  folders: string[];
}

export function normalizeSelection(input: unknown): SyncSelection {
  const out: SyncSelection = { docs: [], folders: [] };
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;
  for (const key of ["docs", "folders"] as const) {
    const arr = o[key];
    if (!Array.isArray(arr)) continue;
    const seen = new Set<string>();
    for (const v of arr) {
      if (typeof v === "string" && v && v.length <= 128 && !seen.has(v)) {
        seen.add(v);
        out[key].push(v);
      }
      if (out[key].length >= 5000) break;
    }
  }
  return out;
}

export interface LibraryDocEntry {
  id: string;
  title: string;
  author: string | null;
  folderId: string | null;
  wordCount: number;
  sentenceCount: number;
  updatedAt: string;
}

export interface LibraryFolderEntry {
  id: string;
  name: string;
  color: string | null;
  documentCount: number;
  updatedAt: string;
}

/** Validate a peer library catalog (never trust it blindly). */
export function cleanLibrary(input: unknown): {
  folders: LibraryFolderEntry[];
  documents: LibraryDocEntry[];
} {
  const out: { folders: LibraryFolderEntry[]; documents: LibraryDocEntry[] } = {
    folders: [],
    documents: [],
  };
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;
  if (Array.isArray(o.folders)) {
    for (const v of o.folders.slice(0, 2000)) {
      if (!v || typeof v !== "object") continue;
      const f = v as Record<string, unknown>;
      if (typeof f.id !== "string" || !f.id || f.id.length > 128) continue;
      if (typeof f.name !== "string" || !f.name) continue;
      out.folders.push({
        id: f.id,
        name: f.name.slice(0, 100),
        color: typeof f.color === "string" ? f.color.slice(0, 32) : null,
        documentCount:
          typeof f.documentCount === "number" && Number.isFinite(f.documentCount)
            ? Math.max(0, Math.floor(f.documentCount))
            : 0,
        updatedAt: typeof f.updatedAt === "string" ? f.updatedAt.slice(0, 64) : "",
      });
    }
  }
  if (Array.isArray(o.documents)) {
    for (const v of o.documents.slice(0, 20000)) {
      if (!v || typeof v !== "object") continue;
      const d = v as Record<string, unknown>;
      if (typeof d.id !== "string" || !d.id || d.id.length > 128) continue;
      if (typeof d.title !== "string" || !d.title) continue;
      out.documents.push({
        id: d.id,
        title: d.title.slice(0, 300),
        author: typeof d.author === "string" ? d.author.slice(0, 300) : null,
        folderId:
          typeof d.folderId === "string" && d.folderId.length <= 128 ? d.folderId : null,
        wordCount:
          typeof d.wordCount === "number" && Number.isFinite(d.wordCount)
            ? Math.max(0, Math.floor(d.wordCount))
            : 0,
        sentenceCount:
          typeof d.sentenceCount === "number" && Number.isFinite(d.sentenceCount)
            ? Math.max(0, Math.floor(d.sentenceCount))
            : 0,
        updatedAt: typeof d.updatedAt === "string" ? d.updatedAt.slice(0, 64) : "",
      });
    }
  }
  return out;
}

/** Lightweight catalog for the server browser (no text, no sentences). */
export function collectLibrary(): {
  folders: LibraryFolderEntry[];
  documents: LibraryDocEntry[];
} {
  const folders = dbAll<{
    id: string;
    name: string;
    color: string | null;
    updated_at: string;
  }>("SELECT id, name, color, updated_at FROM folders ORDER BY name ASC");
  const counts = new Map<string, number>();
  for (const row of dbAll<{ folder_id: string | null; n: number }>(
    "SELECT folder_id, COUNT(*) AS n FROM documents GROUP BY folder_id",
  )) {
    if (row.folder_id) counts.set(row.folder_id, row.n);
  }
  const documents = dbAll<{
    id: string;
    title: string;
    author: string | null;
    folder_id: string | null;
    word_count: number;
    sentence_count: number;
    updated_at: string;
  }>(
    "SELECT id, title, author, folder_id, word_count, sentence_count, updated_at FROM documents ORDER BY updated_at DESC",
  );
  return {
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      documentCount: 0,
      updatedAt: f.updated_at,
    })).map((f) => ({ ...f, documentCount: counts.get(f.id) ?? 0 })),
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      author: d.author,
      folderId: d.folder_id,
      wordCount: d.word_count,
      sentenceCount: d.sentence_count,
      updatedAt: d.updated_at,
    })),
  };
}

/** Full rows (docs + sentences + annotations) for an explicit id list. */
export function collectDocsByIds(ids: string[]): {
  changes: SyncChanges;
  missing: string[];
} {
  const changes: SyncChanges = {
    folders: [],
    documents: [],
    settings: [],
    pronunciations: [],
    bookmarks: [],
    highlights: [],
    podcasts: [],
    sessions: [],
  };
  const missing: string[] = [];
  const folderIds = new Set<string>();
  for (const id of ids.slice(0, 200)) {
    const d = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", id);
    if (!d) {
      missing.push(id);
      continue;
    }
    const sentences = dbAll<{ idx: number; text: string; char_start: number; char_end: number }>(
      "SELECT idx, text, char_start, char_end FROM sentences WHERE doc_id = ? ORDER BY idx ASC",
      d.id,
    );
    changes.documents.push({
      id: d.id,
      title: d.title,
      author: d.author,
      sourceType: d.source_type,
      sourceUrl: d.source_url,
      fullText: d.full_text,
      totalChars: d.total_chars,
      wordCount: d.word_count,
      sentenceCount: d.sentence_count,
      voice: d.voice,
      stylePrompt: d.style_prompt,
      speed: d.speed,
      folderId: d.folder_id,
      tags: d.tags,
      progressSentenceIndex: d.progress_sentence_index,
      progressCharOffset: d.progress_char_offset,
      progressUpdatedAt: d.progress_updated_at,
      isArchived: d.is_archived === 1,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      metadata: d.metadata ?? "{}",
      sentences: sentences.map((s) => ({
        idx: s.idx,
        text: s.text,
        charStart: s.char_start,
        charEnd: s.char_end,
      })),
    });
    if (d.folder_id) folderIds.add(d.folder_id);
    for (const b of dbAll<{ id: string; doc_id: string; sentence_idx: number; note: string | null; created_at: string; updated_at: string }>(
      "SELECT * FROM bookmarks WHERE doc_id = ?",
      d.id,
    )) {
      changes.bookmarks.push({
        id: b.id,
        docId: b.doc_id,
        sentenceIdx: b.sentence_idx,
        note: b.note,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      });
    }
    for (const h of dbAll<{ id: string; doc_id: string; sentence_idx: number; text: string; color: string; note: string | null; created_at: string; updated_at: string }>(
      "SELECT * FROM highlights WHERE doc_id = ?",
      d.id,
    )) {
      changes.highlights.push({
        id: h.id,
        docId: h.doc_id,
        sentenceIdx: h.sentence_idx,
        text: h.text,
        color: h.color,
        note: h.note,
        createdAt: h.created_at,
        updatedAt: h.updated_at,
      });
    }
    for (const p of dbAll<{ id: string; doc_id: string; title: string; script: string; created_at: string; updated_at: string }>(
      "SELECT id, doc_id, title, script, created_at, updated_at FROM podcasts WHERE doc_id = ?",
      d.id,
    )) {
      changes.podcasts.push({
        id: p.id,
        docId: p.doc_id,
        title: p.title,
        script: p.script,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      });
    }
  }
  for (const fid of folderIds) {
    const f = dbGet<{ id: string; name: string; color: string | null; created_at: string; updated_at: string }>(
      "SELECT * FROM folders WHERE id = ?",
      fid,
    );
    if (f) {
      changes.folders.push({
        id: f.id,
        name: f.name,
        color: f.color,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      });
    }
  }
  return { changes, missing };
}

/**
 * Filter pulled changes to a selective pick. Keeps selected docs (explicit
 * or in selected folders), their folders, and their annotations; settings
 * and pronunciations always pass (tiny and global).
 */
export function filterChangesForSelection(
  changes: SyncChanges,
  selection: SyncSelection,
  localSelectedDocIds: string[],
): SyncChanges {
  const docSet = new Set([...selection.docs, ...localSelectedDocIds]);
  const folderSet = new Set(selection.folders);
  const documents = changes.documents.filter(
    (d) => docSet.has(d.id) || (d.folderId !== null && folderSet.has(d.folderId)),
  );
  const keptDocIds = new Set(documents.map((d) => d.id));
  const keptFolderIds = new Set<string>();
  for (const d of documents) {
    if (d.folderId) keptFolderIds.add(d.folderId);
  }
  const inScope = (docId: string) => docSet.has(docId) || keptDocIds.has(docId);
  return {
    folders: changes.folders.filter((f) => folderSet.has(f.id) || keptFolderIds.has(f.id)),
    documents,
    settings: changes.settings,
    pronunciations: changes.pronunciations,
    bookmarks: changes.bookmarks.filter((b) => inScope(b.docId)),
    highlights: changes.highlights.filter((h) => inScope(h.docId)),
    podcasts: changes.podcasts.filter((p) => inScope(p.docId)),
    sessions: changes.sessions.filter((s) => inScope(s.docId)),
  };
}

/** Rough count of local rows newer than the given cursors (for status UI). */
export function countPending(cursors: SyncCursors): number {
  try {
    const q = (sql: string, cursor: string): number =>
      dbGet<{ n: number }>(sql, cursor)?.n ?? 0;
    return (
      q("SELECT COUNT(*) AS n FROM folders WHERE updated_at > ?", cursors.folders) +
      q(
        "SELECT COUNT(*) AS n FROM documents WHERE max(updated_at, ifnull(progress_updated_at, '')) > ?",
        cursors.documents,
      ) +
      q(
        "SELECT COUNT(*) AS n FROM settings WHERE updated_at > ? AND key NOT IN ('schema_version', 'gemini_api_key')",
        cursors.settings,
      ) +
      q("SELECT COUNT(*) AS n FROM pronunciation_dictionary WHERE updated_at > ?", cursors.pronunciations) +
      q("SELECT COUNT(*) AS n FROM bookmarks WHERE updated_at > ?", cursors.bookmarks) +
      q("SELECT COUNT(*) AS n FROM highlights WHERE updated_at > ?", cursors.highlights) +
      q("SELECT COUNT(*) AS n FROM podcasts WHERE updated_at > ?", cursors.podcasts) +
      q("SELECT COUNT(*) AS n FROM reading_sessions WHERE created_at > ?", cursors.sessions) +
      q("SELECT COUNT(*) AS n FROM _sync_tombstones WHERE deleted_at > ?", cursors.tombstones)
    );
  } catch {
    return 0;
  }
}
