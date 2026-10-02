// Shared TypeScript types for VoxShelf (used by both server and client code).

export type SourceType =
  | "paste"
  | "file-txt"
  | "file-md"
  | "file-pdf"
  | "file-docx"
  | "file-epub"
  | "file-image"
  | "camera"
  | "url-article"
  | "url-gdocs";

export interface Sentence {
  idx: number;
  text: string;
  charStart: number;
  charEnd: number;
  audioHash: string | null;
  audioDurationMs: number | null;
}

export interface Bookmark {
  id: string;
  docId: string;
  sentenceIdx: number;
  note: string | null;
  createdAt: string;
  sentencePreview?: string;
}

export type HighlightColor = "yellow" | "blue" | "green" | "purple" | "pink";

export interface Highlight {
  id: string;
  docId: string;
  sentenceIdx: number;
  text: string;
  color: HighlightColor;
  note: string | null;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
  documentCount?: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  author: string | null;
  sourceType: SourceType;
  sourceUrl: string | null;
  totalChars: number;
  wordCount: number;
  sentenceCount: number;
  /** 0-100 share of sentences with cached audio (present on list responses). */
  prerenderPct?: number;
  voice: string;
  speed: number;
  folderId: string | null;
  tags: string[];
  progressSentenceIndex: number;
  progressCharOffset: number;
  progressUpdatedAt: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  stylePrompt: string | null;
  sentences: Sentence[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
}

export interface VoiceInfo {
  name: string;
  description: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  isRecommended?: boolean;
  category: "tts" | "text" | "vision";
  speed?: "fast" | "standard";
}

export interface ModelsResponse {
  ttsModels: ModelInfo[];
  textModels: ModelInfo[];
  /** True when the lists came from a live `ai.models.list()` call. */
  live: boolean;
  /** Present when live discovery failed and curated defaults were returned. */
  error?: string;
}

export interface TtsRequest {
  text: string;
  voice?: string;
  stylePrompt?: string;
  /** Optional per-request API key override (falls back to server settings/env). */
  key?: string;
}

export interface TtsResponse {
  hash: string;
  url: string;
  durationMs: number;
  chars: number;
  chunks: number;
  cached: boolean;
  voice: string;
}

export interface ExtractResult {
  title: string;
  author: string | null;
  text: string;
  wordCount: number;
  sentenceCount: number;
  sourceType: SourceType;
  sourceUrl: string | null;
  pages?: number;
}

export interface OcrResult {
  text: string;
  engine: "ai-vision" | "tesseract";
  confidence: number | null;
}

export interface PublicSettings {
  hasApiKey: boolean;
  serverKeyConfigured: boolean;
  defaultVoice: string;
  defaultSpeed: number;
  ttsModel: string;
  textModel: string;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  files: number;
  audioDir: string;
  /** Unique characters currently cached (one synthesis each). */
  chars: number;
  /** Total characters served from cache, including repeat plays. */
  servedChars: number;
  /** Estimated USD spent on the first synthesis of each clip. */
  estimatedCostUsd: number;
  /** Estimated USD saved by cache hits (repeat plays that skipped the API). */
  estimatedSavedUsd: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizResult {
  questions: QuizQuestion[];
  flashcards: Flashcard[];
}

export type PodcastSpeaker = "Alex" | "Sam";

export interface PodcastLine {
  speaker: PodcastSpeaker;
  voice: "Kore" | "Puck";
  text: string;
}

export interface PodcastEpisode {
  id: string;
  docId: string;
  title: string;
  lines: PodcastLine[];
  audioHash: string | null;
  audioUrl: string | null;
  durationMs: number;
  transcriptDocId: string | null;
  createdAt: string;
}

export interface PrerenderStats {
  totalSentences: number;
  cachedSentences: number;
  percentCached: number;
  totalDurationMs: number;
  isFullyCached: boolean;
}

export interface PrerenderOptions {
  startIndex?: number;
  count?: number;
  voice?: string;
  stylePrompt?: string;
  concurrency?: number;
}

export interface PrerenderStartEvent {
  type: "start";
  total: number;
  startIndex: number;
  voice: string;
}

export interface PrerenderProgressEvent {
  type: "progress";
  sentenceIdx: number;
  completed: number;
  total: number;
  cached: boolean;
  durationMs: number;
  textPreview: string;
}

export interface PrerenderErrorEvent {
  type: "error";
  sentenceIdx: number;
  completed: number;
  total: number;
  message: string;
  textPreview: string;
}

export interface PrerenderCompleteEvent {
  type: "complete";
  total: number;
  synthesized: number;
  cached: number;
  failed: number;
  totalDurationMs: number;
}

export type PrerenderEvent =
  | PrerenderStartEvent
  | PrerenderProgressEvent
  | PrerenderErrorEvent
  | PrerenderCompleteEvent;

export type ReaderFont = "sans" | "serif" | "mono" | "dyslexic";

export type ReaderPageWidth = "narrow" | "comfortable" | "wide";

export interface ReaderPrefs {
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  rulerMode: boolean;
  bionicReading: boolean;
  focusMask: boolean;
  pageWidth: ReaderPageWidth;
}

export interface PronunciationRule {
  id: string;
  word: string;
  replacement: string;
  caseSensitive: boolean;
  createdAt: string;
}

export interface DailyStat {
  /** YYYY-MM-DD (UTC day bucket). */
  date: string;
  minutes: number;
}

export interface ReadingStats {
  totalSeconds: number;
  totalMinutes: number;
  totalWords: number;
  currentStreak: number;
  last7: DailyStat[];
  /** Hours saved by listening above 1.0x speed. */
  hoursSaved: number;
}

export interface ReadingSessionInput {
  docId: string;
  durationSeconds: number;
  wordsRead: number;
  speed: number;
}

export interface SyncSummaryDto {
  ok: boolean;
  at: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
  skippedOrphans: number;
  error?: string;
  serverTime?: string;
  skewMs?: number;
}

export interface SyncStatusDto {
  enabled: boolean;
  serverUrl: string;
  mode: "full" | "selective";
  selection: { docs: string[]; folders: string[] };
  lastSyncAt: string | null;
  lastResult: SyncSummaryDto | null;
  pendingLocal: number;
  schedulerOn: boolean;
  /** True when a sync peer API key is stored (the key itself never leaves the server). */
  syncKeySet: boolean;
}

export interface RemoteLibraryDoc {
  id: string;
  title: string;
  author: string | null;
  folderId: string | null;
  wordCount: number;
  sentenceCount: number;
  updatedAt: string;
}

export interface RemoteLibraryFolder {
  id: string;
  name: string;
  color: string | null;
  documentCount: number;
  updatedAt: string;
}

export interface RemoteLibraryDto {
  folders: RemoteLibraryFolder[];
  documents: RemoteLibraryDoc[];
}

export interface SyncDownloadResult {
  downloaded: string[];
  missing: string[];
  rejected: number;
  foldersAdded: string[];
}

export interface SyncRemoveResult {
  removed: string[];
  removedFolders: string[];
}

export interface AuthStatus {
  locked: boolean;
  authed: boolean;
}
