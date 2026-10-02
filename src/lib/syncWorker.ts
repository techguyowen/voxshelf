// Sync worker: push/pull loop against a peer server + background scheduler.
//
// The local node stays fully usable offline; when `sync.server_url` is set,
// this worker exchanges changes with that peer (usually the Docker server)
// every SYNC_INTERVAL_MS and on demand. All cursor state is device-local.

import { dbAll, getSyncMeta, setSyncMeta } from "./db";
import {
  applyChanges,
  cleanChanges,
  cleanLibrary,
  cleanTombstones,
  collectChanges,
  countPending,
  emptyCursors,
  filterChangesForSelection,
  normalizeCursors,
  normalizeSelection,
  SYNC_VERSION,
  type LibraryDocEntry,
  type LibraryFolderEntry,
  type SyncCursors,
  type SyncSelection,
  type SyncTable,
} from "./sync";

const PHASE_1: SyncTable[] = ["folders", "documents", "settings", "pronunciations"];
const PHASE_2: SyncTable[] = ["bookmarks", "highlights", "podcasts", "sessions"];
const MAX_PAGES = 50;
const FETCH_TIMEOUT_MS = 30_000;

export type SyncMode = "full" | "selective";

export interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  /** Peer server key for locked servers. Device-local, never synced. */
  apiKey: string;
  mode: SyncMode;
}

/** Content tables whose cursors reset when switching back to full sync. */
const CONTENT_TABLES: (keyof SyncCursors)[] = [
  "folders",
  "documents",
  "bookmarks",
  "highlights",
  "podcasts",
  "sessions",
];

export interface SyncSummary {
  ok: boolean;
  at: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
  skippedOrphans: number;
  error?: string;
  serverTime?: string;
  /** Local clock minus server clock, ms (positive = we are ahead). */
  skewMs?: number;
}

export interface SyncStatus {
  enabled: boolean;
  serverUrl: string;
  mode: SyncMode;
  selection: SyncSelection;
  lastSyncAt: string | null;
  lastResult: SyncSummary | null;
  pendingLocal: number;
  schedulerOn: boolean;
  syncKeySet: boolean;
}

/** Normalize a peer base URL (http/https only, no trailing slash). Null when invalid. */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed.length > 500) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString().replace(/\/+$/, "");
}

export function getSyncConfig(): SyncConfig {
  const serverUrl =
    getSyncMeta("sync.server_url", "").trim() ||
    (process.env.SYNC_SERVER_URL || "").trim();
  const rawEnabled = getSyncMeta("sync.enabled", "").trim();
  const enabled =
    rawEnabled === "1" ||
    (rawEnabled === "" &&
      (process.env.SYNC_ENABLED === "1" || (process.env.SYNC_ENABLED !== "0" && serverUrl !== "")));
  const rawMode = getSyncMeta("sync.mode", "").trim() || (process.env.SYNC_MODE || "").trim();
  const mode: SyncMode = rawMode === "selective" ? "selective" : "full";
  return {
    enabled,
    serverUrl,
    apiKey: getSyncMeta("sync.api_key", "").trim() || (process.env.SYNC_API_KEY || "").trim(),
    mode,
  };
}

export function getSelection(): SyncSelection {
  const raw = getSyncMeta("sync.selection", "");
  if (!raw) return { docs: [], folders: [] };
  try {
    return normalizeSelection(JSON.parse(raw));
  } catch {
    return { docs: [], folders: [] };
  }
}

export function setSelection(selection: SyncSelection): SyncSelection {
  const clean = normalizeSelection(selection);
  setSyncMeta("sync.selection", JSON.stringify(clean));
  return clean;
}

/** Local doc ids currently filed in the given folders (selective scope). */
export function localDocsInFolders(folderIds: string[]): string[] {
  if (folderIds.length === 0) return [];
  const placeholders = folderIds.map(() => "?").join(",");
  return dbAll<{ id: string }>(
    `SELECT id FROM documents WHERE folder_id IN (${placeholders})`,
    ...folderIds,
  ).map((r) => r.id);
}

export function setSyncConfig(input: {
  serverUrl?: string;
  enabled?: boolean;
  apiKey?: string;
  mode?: SyncMode;
}): SyncConfig {
  if (input.serverUrl !== undefined) {
    const trimmed = input.serverUrl.trim();
    if (trimmed) {
      const normalized = normalizeServerUrl(trimmed);
      if (!normalized) throw new Error("Server URL must be an http(s) URL.");
      setSyncMeta("sync.server_url", normalized);
    } else {
      setSyncMeta("sync.server_url", "");
    }
  }
  if (input.enabled !== undefined) {
    setSyncMeta("sync.enabled", input.enabled ? "1" : "0");
  }
  if (input.apiKey !== undefined) {
    setSyncMeta("sync.api_key", input.apiKey.trim());
  }
  if (input.mode !== undefined && input.mode !== getSyncConfig().mode) {
    setSyncMeta("sync.mode", input.mode);
    if (input.mode === "full") {
      // Backfill everything selective mode skipped (re-pull is idempotent).
      for (const table of CONTENT_TABLES) setSyncMeta(`cursor.${table}`, "");
    }
  }
  return getSyncConfig();
}

function loadCursors(): SyncCursors {
  const c = emptyCursors();
  for (const key of Object.keys(c) as (keyof SyncCursors)[]) {
    c[key] = getSyncMeta(`cursor.${key}`, "");
  }
  return c;
}

function saveCursors(c: SyncCursors): void {
  for (const [key, value] of Object.entries(c)) {
    setSyncMeta(`cursor.${key}`, value);
  }
}

export function getLastSync(): { at: string | null; result: SyncSummary | null } {
  const at = getSyncMeta("sync.last_at", "") || null;
  const raw = getSyncMeta("sync.last_result", "");
  let result: SyncSummary | null = null;
  if (raw) {
    try {
      result = JSON.parse(raw) as SyncSummary;
    } catch {
      result = null;
    }
  }
  return { at, result };
}

export function getSyncStatus(): SyncStatus {
  const config = getSyncConfig();
  const { at, result } = getLastSync();
  return {
    enabled: config.enabled,
    serverUrl: config.serverUrl,
    mode: config.mode,
    selection: getSelection(),
    lastSyncAt: at,
    lastResult: result,
    pendingLocal: countPending(loadCursors()),
    schedulerOn: schedulerOn,
    syncKeySet: config.apiKey !== "",
  };
}

async function postJson(
  url: string,
  body: unknown,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    let message = `Sync request failed (HTTP ${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface RemoteLibrary {
  folders: LibraryFolderEntry[];
  documents: LibraryDocEntry[];
}

function peerBase(): { base: string; apiKey: string } {
  const config = getSyncConfig();
  const base = config.serverUrl ? normalizeServerUrl(config.serverUrl) : null;
  if (!config.enabled || !base) throw new Error("Sync is not configured.");
  return { base, apiKey: config.apiKey };
}

/** Fetch the peer's lightweight library catalog (selective-sync browser). */
export async function fetchRemoteLibrary(): Promise<RemoteLibrary> {
  const { base, apiKey } = peerBase();
  const res = await fetch(`${base}/api/sync/library`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Unauthorized (HTTP 401) — that server is locked."
        : `Library request failed (HTTP ${res.status}).`,
    );
  }
  return cleanLibrary(await res.json().catch(() => null));
}

/** Download explicit docs from the peer, merge locally, extend the pick. */
export async function downloadDocsFromPeer(docIds: string[]): Promise<{
  downloaded: string[];
  missing: string[];
  rejected: number;
}> {
  const { base, apiKey } = peerBase();
  const ids = [...new Set(docIds.filter((id) => id && id.length <= 128))].slice(0, 200);
  if (ids.length === 0) return { downloaded: [], missing: [], rejected: 0 };
  const res = await postJson(`${base}/api/sync/fetch`, { v: SYNC_VERSION, ids }, apiKey);
  const { changes, rejected } = cleanChanges(res.changes);
  applyChanges(changes, []);
  const missing = Array.isArray(res.missing)
    ? res.missing.filter((m: unknown): m is string => typeof m === "string")
    : [];
  const downloaded = ids.filter((id) => !missing.includes(id));
  const sel = getSelection();
  const known = new Set(sel.docs);
  for (const id of downloaded) {
    if (!known.has(id)) {
      known.add(id);
      sel.docs.push(id);
    }
  }
  setSelection(sel);
  return { downloaded, missing, rejected };
}

let inFlight: Promise<SyncSummary> | null = null;

/** One full push-then-pull cycle. Concurrent callers share the same run. */
export function runSyncNow(): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  inFlight = runCycle().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runCycle(): Promise<SyncSummary> {
  const at = new Date().toISOString();
  const summary: SyncSummary = {
    ok: false,
    at,
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    rejected: 0,
    skippedOrphans: 0,
  };
  const finish = (patch: Partial<SyncSummary>): SyncSummary => {
    Object.assign(summary, patch);
    setSyncMeta("sync.last_at", summary.at);
    setSyncMeta("sync.last_result", JSON.stringify(summary));
    return summary;
  };

  const config = getSyncConfig();
  if (!config.enabled || !config.serverUrl) {
    return finish({ ok: true, error: undefined });
  }
  const base = normalizeServerUrl(config.serverUrl);
  if (!base) {
    return finish({ ok: false, error: "Server URL is invalid." });
  }

  try {
    // Push and pull track SEPARATE watermarks: folding push progress into
    // the pull cursor would skip server rows stamped between the old cursor
    // and our newest push (lost updates). They merge at the end.
    const pushCursors = loadCursors();
    const pullCursors = loadCursors();

    // Push local changes first (phased so parents land before children).
    for (const phase of [PHASE_1, PHASE_2]) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = collectChanges(pushCursors, phase);
        const count =
          batch.changes.folders.length +
          batch.changes.documents.length +
          batch.changes.settings.length +
          batch.changes.pronunciations.length +
          batch.changes.bookmarks.length +
          batch.changes.highlights.length +
          batch.changes.podcasts.length +
          batch.changes.sessions.length +
          batch.tombstones.length;
        if (count === 0) break;
        const res = await postJson(
          `${base}/api/sync/push`,
          {
            v: SYNC_VERSION,
            changes: batch.changes,
            tombstones: batch.tombstones,
          },
          config.apiKey,
        );
        summary.pushed += count;
        summary.conflicts += typeof res.conflicts === "number" ? res.conflicts : 0;
        summary.rejected += typeof res.rejected === "number" ? res.rejected : 0;
        summary.skippedOrphans +=
          typeof res.skippedOrphans === "number" ? res.skippedOrphans : 0;
        Object.assign(pushCursors, normalizeCursors(batch.cursors));
        if (!batch.hasMore) break;
      }
    }

    // Then pull the peer's changes (same phasing, validate before apply).
    // Selective mode filters to the local pick; cursors still advance past
    // skipped rows (explicit download re-fetches on demand instead).
    const selection = config.mode === "selective" ? getSelection() : null;
    const selectedLocal = selection ? localDocsInFolders(selection.folders) : [];
    for (const phase of [PHASE_1, PHASE_2]) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await postJson(
          `${base}/api/sync/pull`,
          {
            v: SYNC_VERSION,
            cursors: pullCursors,
            tables: phase,
          },
          config.apiKey,
        );
        const { changes: rawChanges, rejected } = cleanChanges(res.changes);
        const tombs = cleanTombstones(res.tombstones);
        summary.rejected += rejected + tombs.rejected;
        const changes = selection
          ? filterChangesForSelection(rawChanges, selection, selectedLocal)
          : rawChanges;
        const applied = applyChanges(changes, tombs.tombstones);
        summary.pulled += Object.values(applied.applied).reduce((a, b) => a + b, 0);
        summary.conflicts += applied.conflicts;
        summary.skippedOrphans += applied.skippedOrphans;
        Object.assign(pullCursors, normalizeCursors(res.cursors));
        if (typeof res.serverTime === "string") {
          summary.serverTime = res.serverTime;
          const t = Date.parse(res.serverTime);
          if (!Number.isNaN(t)) summary.skewMs = Date.now() - t;
        }
        if (!res.hasMore) break;
      }
    }

    // Cursors persist only after a full successful cycle (push is
    // idempotent, so a retry after a mid-cycle failure re-sends the same
    // rows). The merged watermark is the per-table max of both directions.
    const merged = loadCursors();
    for (const key of Object.keys(merged) as (keyof SyncCursors)[]) {
      merged[key] = [merged[key], pushCursors[key], pullCursors[key]].sort().pop() as string;
    }
    saveCursors(merged);
    return finish({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    return finish({ ok: false, error: message });
  }
}

let schedulerOn = false;

function intervalMs(): number {
  const raw = Number(process.env.SYNC_INTERVAL_MS || 60_000);
  if (!Number.isFinite(raw)) return 60_000;
  return Math.min(3_600_000, Math.max(15_000, Math.floor(raw)));
}

/** Start the background sync loop (idempotent, server-startup only). */
export function ensureSyncScheduler(): void {
  if (schedulerOn) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as unknown as Record<symbol, boolean>;
  const key = Symbol.for("voxshelf.syncScheduler");
  if (g[key]) {
    schedulerOn = true;
    return;
  }
  g[key] = true;
  schedulerOn = true;
  const tick = () => {
    const config = getSyncConfig();
    if (config.enabled && config.serverUrl) {
      runSyncNow().catch(() => {
        // Last-error is already recorded in the summary; never crash the loop.
      });
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, intervalMs()).unref?.();
}
