import { randomUUID } from "crypto";
import {
  audioKey,
  concatWavs,
  parseSampleRateFromMime,
  pcmToWav,
  wavDurationMs,
} from "./audio";
import { saveCachedAudio } from "./audioCache";
import { dbAll, dbGet, dbRun } from "./db";
import { createDocument } from "./documents";
import { generatePodcastScript, synthesizeSpeech, type PodcastScript } from "./gemini";
import { chunkForTts } from "./text";
import type { PodcastEpisode, PodcastLine } from "./types";

interface PodcastRow {
  id: string;
  doc_id: string;
  title: string;
  script: string;
  audio_hash: string | null;
  duration_ms: number;
  created_at: string;
}

function parseLines(json: string): PodcastLine[] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (l): l is PodcastLine =>
        !!l && typeof l === "object" && typeof (l as PodcastLine).text === "string",
    );
  } catch {
    return [];
  }
}

function toEpisode(row: PodcastRow, transcriptDocId: string | null = null): PodcastEpisode {
  return {
    id: row.id,
    docId: row.doc_id,
    title: row.title,
    lines: parseLines(row.script),
    audioHash: row.audio_hash,
    audioUrl: row.audio_hash ? `/api/audio/${row.audio_hash}` : null,
    durationMs: row.duration_ms,
    transcriptDocId,
    createdAt: row.created_at,
  };
}

export function listPodcasts(docId: string): PodcastEpisode[] {
  return dbAll<PodcastRow>(
    "SELECT * FROM podcasts WHERE doc_id = ? ORDER BY created_at DESC",
    docId,
  ).map((r) => toEpisode(r));
}

function transcriptText(script: PodcastScript): string {
  return script.lines.map((l) => `${l.speaker}: ${l.text}`).join("\n\n");
}

/**
 * Generate a 2-host podcast for a document: script via Gemini, each dialogue
 * line synthesized with its host voice (Alex=Kore, Sam=Puck), stitched into a
 * single cached WAV, and saved as a podcast attachment on the document.
 * Optionally also saves the transcript as a new document.
 */
export async function generatePodcast(
  docId: string,
  title: string,
  text: string,
  opts: { saveAsDocument?: boolean; key?: string | null } = {},
): Promise<PodcastEpisode> {
  const script = await generatePodcastScript(title, text, opts.key);

  // Synthesize each line with its host voice and stitch into one episode.
  const wavs: Buffer[] = [];
  const styleByVoice: Record<string, string> = {
    Kore: "You are Alex, a warm and knowledgeable podcast host. Speak conversationally with natural energy.",
    Puck: "You are Sam, a curious and witty podcast co-host. Speak conversationally with playful energy.",
  };
  for (const line of script.lines) {
    const chunks = chunkForTts(line.text);
    for (const chunk of chunks) {
      const { pcm, mimeType } = await synthesizeSpeech(
        chunk,
        line.voice,
        styleByVoice[line.voice],
        opts.key,
      );
      wavs.push(pcmToWav(pcm, parseSampleRateFromMime(mimeType)));
    }
  }
  const wav = concatWavs(wavs);
  const transcript = transcriptText(script);
  const hash = audioKey(transcript, "podcast:Kore+Puck", docId);
  const saved = saveCachedAudio({
    hash,
    voice: "podcast",
    stylePrompt: docId,
    textPreview: transcript,
    chars: transcript.length,
    wav,
    durationMs: wavDurationMs(wav),
  });

  let transcriptDocId: string | null = null;
  if (opts.saveAsDocument) {
    try {
      const doc = createDocument({
        title: script.title,
        text: transcript,
        sourceType: "paste",
        tags: ["podcast"],
      });
      transcriptDocId = doc.id;
    } catch {
      transcriptDocId = null;
    }
  }

  const id = randomUUID();
  const ts = new Date().toISOString();
  dbRun(
    "INSERT INTO podcasts (id, doc_id, title, script, audio_hash, duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    docId,
    script.title,
    JSON.stringify(script.lines),
    saved.hash,
    saved.durationMs,
    ts,
    ts,
  );
  const row = dbGet<PodcastRow>("SELECT * FROM podcasts WHERE id = ?", id);
  if (!row) throw new Error("Failed to save podcast.");
  return toEpisode(row, transcriptDocId);
}
