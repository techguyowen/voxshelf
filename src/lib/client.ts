// Client-side API helpers (fetch wrappers) + small formatters.

import type {
  AuthStatus,
  Bookmark,
  CacheStats,
  ChatMessage,
  DocumentDetail,
  DocumentSummary,
  ExtractResult,
  Folder,
  Highlight,
  HighlightColor,
  ModelsResponse,
  OcrResult,
  PodcastEpisode,
  PrerenderCompleteEvent,
  PrerenderEvent,
  PrerenderOptions,
  PrerenderStats,
  PronunciationRule,
  PublicSettings,
  QuizResult,
  ReadingSessionInput,
  ReadingStats,
  RemoteLibraryDto,
  SyncDownloadResult,
  SyncRemoveResult,
  SyncStatusDto,
  SyncSummaryDto,
  TtsResponse,
  VoiceInfo,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep default
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

async function get<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const api = {
  listDocuments: (params?: { q?: string; tag?: string; sort?: string; archived?: boolean; folder?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.tag) sp.set("tag", params.tag);
    if (params?.sort) sp.set("sort", params.sort);
    if (params?.archived) sp.set("archived", "1");
    if (params?.folder) sp.set("folder", params.folder);
    const qs = sp.toString();
    return get<{ documents: DocumentSummary[]; tags: string[] }>(
      `/api/documents${qs ? `?${qs}` : ""}`,
    );
  },
  getDocument: (id: string) => get<DocumentDetail>(`/api/documents/${id}`),
  createDocument: (input: {
    title?: string;
    text: string;
    sourceType?: string;
    sourceUrl?: string | null;
    author?: string | null;
    voice?: string;
    tags?: string[];
  }) => send<DocumentSummary>("/api/documents", "POST", input),
  updateDocument: (id: string, patch: Record<string, unknown>) =>
    send<DocumentSummary>(`/api/documents/${id}`, "PATCH", patch),
  deleteDocument: (id: string) =>
    send<{ ok: boolean }>(`/api/documents/${id}`, "DELETE"),

  tts: (input: { text: string; voice?: string; stylePrompt?: string }) =>
    send<TtsResponse>("/api/tts", "POST", input),

  getPrerenderStats: (docId: string) =>
    get<PrerenderStats>(`/api/documents/${docId}/prerender`),

  /**
   * Stream a pre-render job. Resolves with the final `complete` summary.
   * Pass an AbortSignal to pause/cancel mid-run.
   */
  prerenderStream: async (
    docId: string,
    options: PrerenderOptions,
    onEvent: (event: PrerenderEvent) => void,
    signal?: AbortSignal,
  ): Promise<PrerenderCompleteEvent> => {
    const res = await fetch(`/api/documents/${docId}/prerender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      signal,
    });
    if (!res.ok) {
      let message = `Pre-render failed (HTTP ${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // keep default
      }
      throw new ApiError(message, res.status);
    }
    if (!res.body) throw new ApiError("Pre-render stream is empty.", 500);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let summary: PrerenderCompleteEvent | null = null;

    const handleFrame = (frame: string) => {
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload) as PrerenderEvent;
          if (event.type === "complete") summary = event;
          onEvent(event);
        } catch {
          // Ignore malformed frames; the stream continues.
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        handleFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) handleFrame(buffer);

    if (!summary) {
      throw new ApiError(
        signal?.aborted ? "Pre-render was cancelled." : "Pre-render ended without a summary.",
        signal?.aborted ? 499 : 500,
      );
    }
    return summary;
  },

  extractFile: async (file: File, opts?: { cleanup?: boolean; ocrMode?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (opts?.cleanup) form.append("cleanup", "1");
    if (opts?.ocrMode) form.append("ocrMode", opts.ocrMode);
    const res = await fetch("/api/extract", { method: "POST", body: form });
    return parse<ExtractResult>(res);
  },
  extractUrl: async (url: string, cleanup?: boolean) => {
    const form = new FormData();
    form.append("url", url);
    if (cleanup) form.append("cleanup", "1");
    const res = await fetch("/api/extract", { method: "POST", body: form });
    return parse<ExtractResult>(res);
  },

  ocr: async (file: File, opts?: { mode?: string; cleanup?: boolean }) => {
    const form = new FormData();
    form.append("file", file);
    if (opts?.mode) form.append("mode", opts.mode);
    if (opts?.cleanup) form.append("cleanup", "1");
    const res = await fetch("/api/ocr", { method: "POST", body: form });
    return parse<OcrResult & { cleaned?: string }>(res);
  },

  summarize: (input: { documentId?: string; title?: string; text?: string; length?: "short" | "detailed" }) =>
    send<{ summary: string }>("/api/ai/summary", "POST", input),
  explain: (selection: string, context?: string) =>
    send<{ explanation: string }>("/api/ai/explain", "POST", { selection, context }),
  cleanup: (text: string, mode?: "extract" | "dictation") =>
    send<{ text: string }>("/api/ai/cleanup", "POST", { text, mode }),
  transcribe: async (file: Blob) => {
    const form = new FormData();
    form.append("file", file, "dictation.webm");
    const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });
    return parse<{ text: string }>(res);
  },
  chat: (input: { documentId: string; messages?: ChatMessage[]; userQuestion: string }) =>
    send<{ answer: string }>("/api/ai/chat", "POST", input),
  quiz: (input: { documentId: string }) =>
    send<QuizResult>("/api/ai/quiz", "POST", input),
  podcast: (input: { documentId: string; saveAsDocument?: boolean }) =>
    send<PodcastEpisode>("/api/ai/podcast", "POST", input),
  listPodcasts: (docId: string) =>
    get<{ podcasts: PodcastEpisode[] }>(`/api/ai/podcast?documentId=${encodeURIComponent(docId)}`),

  listBookmarks: (docId: string) =>
    get<{ bookmarks: Bookmark[] }>(`/api/documents/${docId}/bookmarks`),
  addBookmark: (docId: string, sentenceIdx: number, note?: string) =>
    send<Bookmark>(`/api/documents/${docId}/bookmarks`, "POST", { sentenceIdx, note }),
  deleteBookmark: (docId: string, bookmarkId: string) =>
    send<{ ok: boolean }>(`/api/documents/${docId}/bookmarks/${bookmarkId}`, "DELETE"),

  listHighlights: (docId: string) =>
    get<{ highlights: Highlight[] }>(`/api/documents/${docId}/highlights`),
  addHighlight: (docId: string, input: { sentenceIdx: number; text: string; color?: HighlightColor; note?: string }) =>
    send<Highlight>(`/api/documents/${docId}/highlights`, "POST", input),
  updateHighlight: (docId: string, highlightId: string, input: { note?: string | null; color?: HighlightColor }) =>
    send<Highlight>(`/api/documents/${docId}/highlights/${highlightId}`, "PATCH", input),
  deleteHighlight: (docId: string, highlightId: string) =>
    send<{ ok: boolean }>(`/api/documents/${docId}/highlights/${highlightId}`, "DELETE"),

  listFolders: () => get<{ folders: Folder[] }>("/api/folders"),
  createFolder: (name: string, color?: string | null) =>
    send<Folder>("/api/folders", "POST", { name, color }),
  deleteFolder: (id: string) => send<{ ok: boolean }>(`/api/folders/${id}`, "DELETE"),

  voices: () => get<{ voices: VoiceInfo[]; default: string }>("/api/voices"),
  models: (key?: string) =>
    get<ModelsResponse>(
      `/api/models${key?.trim() ? `?key=${encodeURIComponent(key.trim())}` : ""}`,
    ),
  settings: () => get<PublicSettings>("/api/settings"),
  updateSettings: (patch: Record<string, unknown>) =>
    send<PublicSettings>("/api/settings", "PUT", patch),
  cacheStats: () => get<CacheStats>("/api/cache"),
  clearCache: () => send<{ ok: boolean; removed: number; bytes: number }>("/api/cache", "DELETE"),
  importData: (data: unknown) => send<{ ok: boolean; imported: number; skipped: number }>("/api/data/import", "POST", data),

  listPronunciations: () =>
    get<{ rules: PronunciationRule[] }>("/api/pronunciations"),
  savePronunciation: (input: { id?: string; word: string; replacement: string; caseSensitive?: boolean }) =>
    send<{ rules: PronunciationRule[] }>("/api/pronunciations", "POST", input),
  deletePronunciation: (id: string) =>
    send<{ ok: boolean }>(`/api/pronunciations?id=${encodeURIComponent(id)}`, "DELETE"),

  getStats: () => get<ReadingStats>("/api/stats"),
  recordSession: (input: ReadingSessionInput) =>
    send<{ ok: boolean }>("/api/stats/session", "POST", input),

  syncStatus: () => get<SyncStatusDto>("/api/sync/status"),
  syncConfig: (patch: {
    serverUrl?: string;
    enabled?: boolean;
    apiKey?: string;
    mode?: "full" | "selective";
  }) => send<SyncStatusDto>("/api/sync/config", "POST", patch),
  syncNow: () => send<SyncSummaryDto>("/api/sync/now", "POST"),
  syncRemoteLibrary: () => get<RemoteLibraryDto>("/api/sync/remote-library"),
  syncDownload: (pick: { docIds?: string[]; folderIds?: string[] }) =>
    send<SyncDownloadResult>("/api/sync/download", "POST", pick),
  syncRemove: (pick: { docIds?: string[]; folderIds?: string[] }) =>
    send<SyncRemoveResult>("/api/sync/remove", "POST", pick),

  authStatus: () => get<AuthStatus>("/api/auth/status"),
  authLogin: (key: string) =>
    send<{ ok: boolean; locked: boolean }>("/api/auth/login", "POST", { key }),
  authLogout: () => send<{ ok: boolean }>("/api/auth/logout", "POST"),
};

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function downloadTextFile(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string, ext: string): string {
  const base = name.replace(/[^\w\d-_]+/g, "_").slice(0, 80) || "voxshelf";
  return `${base}.${ext}`;
}
