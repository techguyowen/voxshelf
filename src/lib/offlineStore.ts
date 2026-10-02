// On-device offline storage engine for the VoxShelf PWA.
//
// - IndexedDB database `voxshelf_offline_v1`, store `documents`: full
//   DocumentDetail per book (sentences with audio hashes, bookmarks,
//   highlights) plus totalBytes + downloadedAt.
// - CacheStorage `voxshelf-offline-audio-v1`: raw audio Responses for
//   `/api/audio/[hash]`, served cache-first by public/sw.js so playback
//   works with zero network once a book is on the device.
//
// Client-only: every export guards against SSR / missing browser APIs.

import { api } from "./client";
import type { DocumentDetail } from "./types";

export const OFFLINE_DB_NAME = "voxshelf_offline_v1";
export const OFFLINE_DOC_STORE = "documents";
export const OFFLINE_AUDIO_CACHE = "voxshelf-offline-audio-v1";

export type OfflineProgress = (
  done: number,
  total: number,
  bytes: number,
) => void;

export interface SaveToDeviceOptions {
  /** AbortSignal for Cancel / Pause. Checked between clips. */
  signal?: AbortSignal;
  /** Per-sentence TTS+fetch parallelism (default 4, clamped 1-8). */
  concurrency?: number;
}

export interface OfflineDocSummary {
  id: string;
  title: string;
  author?: string;
  wordCount: number;
  sentenceCount: number;
  bytes: number;
  downloadedAt: string;
}

interface OfflineDocRecord {
  id: string;
  doc: DocumentDetail;
  totalBytes: number;
  downloadedAt: string;
}

function idbSupported(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function cacheSupported(): boolean {
  return typeof window !== "undefined" && typeof caches !== "undefined";
}

/** Absolute audio URL so CacheStorage keys match in every context. */
export function offlineAudioUrl(hash: string): string {
  const path = `/api/audio/${hash}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(path, window.location.origin).toString();
  }
  return path;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idbSupported()) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_DOC_STORE)) {
        db.createObjectStore(OFFLINE_DOC_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open offline database."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_DOC_STORE, mode);
      const req = run(tx.objectStore(OFFLINE_DOC_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("Offline database request failed."));
      tx.onerror = () =>
        reject(tx.error ?? new Error("Offline database transaction failed."));
    });
  } finally {
    db.close();
  }
}

async function idbPut(record: OfflineDocRecord): Promise<void> {
  await withStore("readwrite", (store) => store.put(record));
}

async function idbGet(docId: string): Promise<OfflineDocRecord | null> {
  if (!idbSupported()) return null;
  const rec = await withStore<OfflineDocRecord | undefined>(
    "readonly",
    (store) => store.get(docId),
  );
  return rec ?? null;
}

async function idbGetAll(): Promise<OfflineDocRecord[]> {
  if (!idbSupported()) return [];
  return withStore<OfflineDocRecord[]>("readonly", (store) =>
    store.getAll(),
  );
}

async function idbDelete(docId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(docId));
}

async function idbClear(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

async function idbCount(): Promise<number> {
  if (!idbSupported()) return 0;
  return withStore<number>("readonly", (store) => store.count());
}

/**
 * Save a full document + all its audio on this device.
 *
 * Every sentence is ensured to have server audio first (missing clips are
 * synthesized via `/api/tts`, already-cached ones resolve instantly), then
 * the raw audio Response is stored in CacheStorage and the enriched document
 * (with audio hashes) is stored in IndexedDB.
 *
 * Already-downloaded clips are skipped via CacheStorage hits, so a paused
 * download can be resumed by calling this again.
 */
export async function saveDocumentToDevice(
  doc: DocumentDetail,
  onProgress: OfflineProgress,
  opts: SaveToDeviceOptions = {},
): Promise<void> {
  const signal = opts.signal;
  signal?.throwIfAborted();
  if (!cacheSupported()) {
    throw new Error("CacheStorage is not available in this browser.");
  }
  if (!idbSupported()) {
    throw new Error("IndexedDB is not available in this browser.");
  }
  const total = doc.sentences.length;
  onProgress(0, total, 0);
  if (total === 0) {
    await idbPut({
      id: doc.id,
      doc: { ...doc, sentences: [] },
      totalBytes: 0,
      downloadedAt: new Date().toISOString(),
    });
    return;
  }

  const cache = await caches.open(OFFLINE_AUDIO_CACHE);
  const voice = doc.voice;
  const stylePrompt = doc.stylePrompt || undefined;
  // Work on a copy so freshly synthesized audio hashes are persisted.
  const copy: DocumentDetail = {
    ...doc,
    sentences: doc.sentences.map((s) => ({ ...s })),
    bookmarks: [...doc.bookmarks],
    highlights: [...(doc.highlights || [])],
  };

  let done = 0;
  let bytes = 0;
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));

  async function processOne(i: number): Promise<void> {
    signal?.throwIfAborted();
    const s = copy.sentences[i];

    // Fast path: sentence already points at cached device audio.
    if (s.audioHash) {
      const candidate = offlineAudioUrl(s.audioHash);
      const hit = await cache.match(candidate);
      if (hit) {
        const blob = await hit.blob();
        bytes += blob.size;
        done += 1;
        onProgress(done, total, bytes);
        return;
      }
    }

    // Ensure server-side audio (synthesizes when missing, instant on hit).
    const res = await api.tts({
      text: s.text,
      voice,
      stylePrompt,
    });
    signal?.throwIfAborted();
    s.audioHash = res.hash;
    s.audioDurationMs = res.durationMs;

    const url = offlineAudioUrl(res.hash);
    const cached = await cache.match(url);
    if (cached) {
      const blob = await cached.blob();
      bytes += blob.size;
    } else {
      const audioRes = await fetch(url);
      if (!audioRes.ok) {
        throw new Error(
          `Audio download failed for sentence ${i + 1} (HTTP ${audioRes.status}).`,
        );
      }
      signal?.throwIfAborted();
      const sizeProbe = audioRes.clone();
      const blob = await sizeProbe.blob();
      bytes += blob.size;
      await cache.put(url, audioRes);
    }
    done += 1;
    onProgress(done, total, bytes);
  }

  async function worker(): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      const i = cursor;
      cursor += 1;
      if (i >= total) return;
      await processOne(i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, total) },
    () => worker(),
  );
  await Promise.all(workers);
  signal?.throwIfAborted();

  await idbPut({
    id: copy.id,
    doc: copy,
    totalBytes: bytes,
    downloadedAt: new Date().toISOString(),
  });
}

/** Remove a document's cached audio + IndexedDB entry from this device. */
export async function removeDocumentFromDevice(docId: string): Promise<void> {
  const record = await idbGet(docId);
  if (cacheSupported()) {
    try {
      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      const hashes = new Set<string>();
      for (const s of record?.doc.sentences ?? []) {
        if (s.audioHash) hashes.add(s.audioHash);
      }
      await Promise.all(
        [...hashes].map((h) => cache.delete(offlineAudioUrl(h))),
      );
    } catch {
      // Cache cleanup is best-effort; the IDB entry is still removed below.
    }
  }
  if (idbSupported()) {
    await idbDelete(docId);
  }
}

export async function isDocumentOnDevice(
  docId: string,
): Promise<{ onDevice: boolean; bytes: number; downloadedAt?: string }> {
  const record = await idbGet(docId).catch(() => null);
  if (!record) return { onDevice: false, bytes: 0 };
  return {
    onDevice: true,
    bytes: record.totalBytes,
    downloadedAt: record.downloadedAt,
  };
}

/** Load a device-stored document for 100% offline reading/listening. */
export async function getOfflineDocument(
  docId: string,
): Promise<DocumentDetail | null> {
  const record = await idbGet(docId).catch(() => null);
  return record?.doc ?? null;
}

export async function listOfflineDocuments(): Promise<OfflineDocSummary[]> {
  const records = await idbGetAll().catch(() => []);
  return records
    .map((r) => ({
      id: r.doc.id,
      title: r.doc.title,
      author: r.doc.author ?? undefined,
      wordCount: r.doc.wordCount,
      sentenceCount: r.doc.sentenceCount,
      bytes: r.totalBytes,
      downloadedAt: r.downloadedAt,
    }))
    .sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

export async function getDeviceStorageEstimate(): Promise<{
  usageBytes: number;
  quotaBytes: number;
  documentCount: number;
}> {
  let usageBytes = 0;
  let quotaBytes = 0;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? 0;
      quotaBytes = est.quota ?? 0;
    }
  } catch {
    // Storage estimates are best-effort.
  }
  const documentCount = await idbCount().catch(() => 0);
  return { usageBytes, quotaBytes, documentCount };
}

/** Delete every offline book + all cached device audio. */
export async function clearAllDeviceStorage(): Promise<void> {
  if (cacheSupported()) {
    try {
      await caches.delete(OFFLINE_AUDIO_CACHE);
    } catch {
      // Best-effort.
    }
  }
  if (idbSupported()) {
    await idbClear();
  }
}

/** True when a cached device Response exists for this audio URL (no fetch). */
export async function hasOfflineAudio(url: string): Promise<boolean> {
  if (!cacheSupported()) return false;
  try {
    return (await caches.match(url)) != null;
  } catch {
    return false;
  }
}
