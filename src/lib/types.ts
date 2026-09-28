// Shared TypeScript types for VocalFlow (used by both server and client code).

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

export interface DocumentSummary {
  id: string;
  title: string;
  author: string | null;
  sourceType: SourceType;
  sourceUrl: string | null;
  totalChars: number;
  wordCount: number;
  sentenceCount: number;
  voice: string;
  speed: number;
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

export type ReaderFont = "sans" | "serif" | "mono" | "dyslexic";

export interface ReaderPrefs {
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  rulerMode: boolean;
}
