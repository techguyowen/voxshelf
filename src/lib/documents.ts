import { randomUUID } from "crypto";
import { dbAll, dbGet, dbRun, getDb } from "./db";
import { countWords, splitSentences } from "./text";
import type {
  Bookmark,
  DocumentDetail,
  DocumentSummary,
  Sentence,
  SourceType,
} from "./types";
import { DEFAULT_VOICE, isValidVoice } from "./voices";
import { getDefaultSpeed, getDefaultVoice } from "./settings";

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
  tags: string;
  progress_sentence_index: number;
  progress_char_offset: number;
  progress_updated_at: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

interface SentenceRow {
  doc_id: string;
  idx: number;
  text: string;
  char_start: number;
  char_end: number;
  audio_hash: string | null;
  audio_duration_ms: number | null;
}

interface BookmarkRow {
  id: string;
  doc_id: string;
  sentence_idx: number;
  note: string | null;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    sourceType: row.source_type as SourceType,
    sourceUrl: row.source_url,
    totalChars: row.total_chars,
    wordCount: row.word_count,
    sentenceCount: row.sentence_count,
    voice: row.voice,
    speed: row.speed,
    tags: parseTags(row.tags),
    progressSentenceIndex: row.progress_sentence_index,
    progressCharOffset: row.progress_char_offset,
    progressUpdatedAt: row.progress_updated_at,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSentence(row: SentenceRow): Sentence {
  return {
    idx: row.idx,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
    audioHash: row.audio_hash,
    audioDurationMs: row.audio_duration_ms,
  };
}

function toBookmark(row: BookmarkRow, preview?: string): Bookmark {
  return {
    id: row.id,
    docId: row.doc_id,
    sentenceIdx: row.sentence_idx,
    note: row.note,
    createdAt: row.created_at,
    sentencePreview: preview,
  };
}

export interface CreateDocumentInput {
  title?: string;
  text: string;
  sourceType?: SourceType;
  sourceUrl?: string | null;
  author?: string | null;
  voice?: string;
  stylePrompt?: string | null;
  speed?: number;
  tags?: string[];
}

export function createDocument(input: CreateDocumentInput): DocumentSummary {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Document text is empty.");
  if (text.length > 2_000_000) {
    throw new Error("Document is too large (max ~2M characters).");
  }
  const sentences = splitSentences(text);
  if (sentences.length === 0) throw new Error("No readable sentences found.");

  const id = randomUUID();
  const ts = nowIso();
  const title = input.title?.trim().slice(0, 300) || "Untitled";
  const voice =
    input.voice && isValidVoice(input.voice) ? input.voice : getDefaultVoice();
  const speed =
    typeof input.speed === "number" && Number.isFinite(input.speed)
      ? Math.min(4.5, Math.max(0.5, input.speed))
      : getDefaultSpeed();

  dbRun(
    `INSERT INTO documents (id, title, author, source_type, source_url, full_text, total_chars, word_count, sentence_count, voice, style_prompt, speed, tags, progress_sentence_index, progress_char_offset, progress_updated_at, is_archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, 0, ?, ?)`,
    id,
    title,
    input.author?.trim().slice(0, 300) || null,
    input.sourceType || "paste",
    input.sourceUrl || null,
    text,
    text.length,
    countWords(text),
    sentences.length,
    voice,
    input.stylePrompt?.trim().slice(0, 1000) || null,
    speed,
    JSON.stringify((input.tags || []).filter(Boolean).slice(0, 20)),
    ts,
    ts,
  );

  const stmt = getDb().prepare(
    "INSERT INTO sentences (doc_id, idx, text, char_start, char_end) VALUES (?, ?, ?, ?, ?)",
  );
  sentences.forEach((s, i) => {
    stmt.run(id, i, s.text, s.start, s.end);
  });

  const created = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", id);
  if (!created) throw new Error("Failed to create document.");
  return toSummary(created);
}

export interface ListOptions {
  q?: string;
  tag?: string;
  sort?: "updated" | "created" | "title" | "progress";
  includeArchived?: boolean;
}

export function listDocuments(opts: ListOptions = {}): DocumentSummary[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeArchived) where.push("is_archived = 0");
  if (opts.q?.trim()) {
    where.push("(title LIKE ? OR author LIKE ? OR tags LIKE ?)");
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like);
  }
  if (opts.tag?.trim()) {
    where.push("tags LIKE ?");
    params.push(`%"${opts.tag.trim()}"%`);
  }
  let order = "updated_at DESC";
  if (opts.sort === "created") order = "created_at DESC";
  else if (opts.sort === "title") order = "title COLLATE NOCASE ASC";
  else if (opts.sort === "progress") order = "progress_updated_at DESC";
  const sql = `SELECT * FROM documents${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT 500`;
  return dbAll<DocumentRow>(sql, ...params).map(toSummary);
}

export function listAllTags(): string[] {
  const rows = dbAll<{ tags: string }>("SELECT tags FROM documents");
  const set = new Set<string>();
  for (const r of rows) for (const t of parseTags(r.tags)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function getDocumentDetail(id: string): DocumentDetail | null {
  const row = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", id);
  if (!row) return null;
  const sentences = dbAll<SentenceRow>(
    "SELECT * FROM sentences WHERE doc_id = ? ORDER BY idx ASC",
    id,
  ).map(toSentence);
  const bookmarks = listBookmarks(id);
  return {
    ...toSummary(row),
    stylePrompt: row.style_prompt,
    sentences,
    bookmarks,
  };
}

export function getDocumentText(id: string): string | null {
  const row = dbGet<{ full_text: string }>(
    "SELECT full_text FROM documents WHERE id = ?",
    id,
  );
  return row?.full_text ?? null;
}

export interface UpdateDocumentPatch {
  title?: string;
  voice?: string;
  stylePrompt?: string | null;
  speed?: number;
  tags?: string[];
  progressSentenceIndex?: number;
  progressCharOffset?: number;
  isArchived?: boolean;
}

export function updateDocument(
  id: string,
  patch: UpdateDocumentPatch,
): DocumentSummary | null {
  const existing = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: unknown[] = [];
  let touchUpdated = false;

  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(patch.title.trim().slice(0, 300) || "Untitled");
    touchUpdated = true;
  }
  if (patch.voice !== undefined && isValidVoice(patch.voice)) {
    sets.push("voice = ?");
    params.push(patch.voice);
    touchUpdated = true;
  }
  if (patch.stylePrompt !== undefined) {
    sets.push("style_prompt = ?");
    params.push(patch.stylePrompt?.trim().slice(0, 1000) || null);
    touchUpdated = true;
  }
  if (
    patch.speed !== undefined &&
    Number.isFinite(patch.speed)
  ) {
    sets.push("speed = ?");
    params.push(Math.min(4.5, Math.max(0.5, patch.speed)));
  }
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(patch.tags.filter(Boolean).slice(0, 20)));
    touchUpdated = true;
  }
  if (patch.isArchived !== undefined) {
    sets.push("is_archived = ?");
    params.push(patch.isArchived ? 1 : 0);
    touchUpdated = true;
  }
  if (
    patch.progressSentenceIndex !== undefined ||
    patch.progressCharOffset !== undefined
  ) {
    const sIdx = Math.max(
      0,
      Math.min(
        existing.sentence_count - 1,
        patch.progressSentenceIndex ?? existing.progress_sentence_index,
      ),
    );
    sets.push("progress_sentence_index = ?", "progress_char_offset = ?");
    params.push(sIdx, Math.max(0, patch.progressCharOffset ?? 0));
    sets.push("progress_updated_at = ?");
    params.push(nowIso());
  }
  if (touchUpdated) {
    sets.push("updated_at = ?");
    params.push(nowIso());
  }
  if (sets.length === 0) return toSummary(existing);
  params.push(id);
  dbRun(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`, ...params);
  const updated = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", id);
  return updated ? toSummary(updated) : null;
}

export function deleteDocument(id: string): boolean {
  const r = dbRun("DELETE FROM documents WHERE id = ?", id);
  return r.changes > 0;
}

export function updateSentenceAudio(
  docId: string,
  idx: number,
  hash: string,
  durationMs: number,
): void {
  dbRun(
    "UPDATE sentences SET audio_hash = ?, audio_duration_ms = ? WHERE doc_id = ? AND idx = ?",
    hash,
    durationMs,
    docId,
    idx,
  );
}

export function addBookmark(
  docId: string,
  sentenceIdx: number,
  note?: string | null,
): Bookmark {
  const doc = dbGet<DocumentRow>("SELECT * FROM documents WHERE id = ?", docId);
  if (!doc) throw new Error("Document not found.");
  const idx = Math.max(0, Math.min(doc.sentence_count - 1, sentenceIdx));
  const id = randomUUID();
  const ts = nowIso();
  dbRun(
    "INSERT INTO bookmarks (id, doc_id, sentence_idx, note, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    docId,
    idx,
    note?.trim().slice(0, 500) || null,
    ts,
  );
  const sentence = dbGet<{ text: string }>(
    "SELECT text FROM sentences WHERE doc_id = ? AND idx = ?",
    docId,
    idx,
  );
  return {
    id,
    docId,
    sentenceIdx: idx,
    note: note?.trim() || null,
    createdAt: ts,
    sentencePreview: sentence?.text.slice(0, 160),
  };
}

export function listBookmarks(docId: string): Bookmark[] {
  const rows = dbAll<BookmarkRow & { preview: string | null }>(
    `SELECT b.*, (SELECT text FROM sentences s WHERE s.doc_id = b.doc_id AND s.idx = b.sentence_idx) AS preview
     FROM bookmarks b WHERE b.doc_id = ? ORDER BY b.sentence_idx ASC`,
    docId,
  );
  return rows.map((r) =>
    toBookmark(r, r.preview?.slice(0, 160) || undefined),
  );
}

export function deleteBookmark(id: string): boolean {
  return dbRun("DELETE FROM bookmarks WHERE id = ?", id).changes > 0;
}

export { DEFAULT_VOICE };

export interface ExportData {
  version: 1;
  exportedAt: string;
  documents: DocumentDetail[];
}

export function exportAllData(): ExportData {
  const docs = dbAll<DocumentRow>("SELECT * FROM documents ORDER BY created_at ASC");
  const details: DocumentDetail[] = [];
  for (const d of docs) {
    const detail = getDocumentDetail(d.id);
    if (detail) details.push(detail);
  }
  return { version: 1, exportedAt: nowIso(), documents: details };
}

export function importAllData(data: ExportData): { imported: number; skipped: number } {
  if (!data || data.version !== 1 || !Array.isArray(data.documents)) {
    throw new Error("Invalid import file.");
  }
  let imported = 0;
  let skipped = 0;
  for (const doc of data.documents) {
    if (!doc || typeof doc.id !== "string" || !Array.isArray(doc.sentences)) {
      skipped += 1;
      continue;
    }
    const exists = dbGet<{ id: string }>(
      "SELECT id FROM documents WHERE id = ?",
      doc.id,
    );
    if (exists) {
      skipped += 1;
      continue;
    }
    const ts = nowIso();
    const fullText = doc.sentences.map((s) => s.text).join(" ");
    dbRun(
      `INSERT INTO documents (id, title, author, source_type, source_url, full_text, total_chars, word_count, sentence_count, voice, style_prompt, speed, tags, progress_sentence_index, progress_char_offset, progress_updated_at, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      doc.id,
      String(doc.title || "Untitled").slice(0, 300),
      doc.author || null,
      doc.sourceType || "paste",
      doc.sourceUrl || null,
      fullText,
      fullText.length,
      doc.wordCount || 0,
      doc.sentences.length,
      isValidVoice(doc.voice) ? doc.voice : DEFAULT_VOICE,
      doc.stylePrompt || null,
      doc.speed || 1,
      JSON.stringify(Array.isArray(doc.tags) ? doc.tags : []),
      doc.progressSentenceIndex || 0,
      doc.progressCharOffset || 0,
      doc.progressUpdatedAt || null,
      doc.isArchived ? 1 : 0,
      doc.createdAt || ts,
      doc.updatedAt || ts,
    );
    const stmt = getDb().prepare(
      "INSERT INTO sentences (doc_id, idx, text, char_start, char_end, audio_hash, audio_duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    doc.sentences.forEach((s, i) => {
      stmt.run(doc.id, i, s.text, s.charStart ?? 0, s.charEnd ?? 0, s.audioHash || null, s.audioDurationMs || null);
    });
    if (Array.isArray(doc.bookmarks)) {
      const bstmt = getDb().prepare(
        "INSERT INTO bookmarks (id, doc_id, sentence_idx, note, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const b of doc.bookmarks) {
        if (b && typeof b.id === "string") {
          bstmt.run(b.id, doc.id, b.sentenceIdx || 0, b.note || null, b.createdAt || ts);
        }
      }
    }
    imported += 1;
  }
  return { imported, skipped };
}
