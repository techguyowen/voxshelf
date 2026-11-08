import { spawnSync } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import JSZip from "jszip";
import { tmpdir } from "os";
import { join } from "path";
import { audioFilePath, concatWavs, wavDurationMs } from "./audio";
import { getCachedAudio } from "./audioCache";
import { updateSentenceAudio } from "./documents";
import { detectChapters, type Chapter } from "./toc";
import { synthesizeAndCache } from "./tts";
import type { AudiobookExportFormat, DocumentDetail } from "./types";

export interface ChapterTiming extends Chapter {
  startMs: number;
  endMs: number;
}

export interface AudiobookResult {
  buffer: Buffer;
  mime: string;
  ext: string;
  fellBackToZip: boolean;
}

export function safeName(name: string): string {
  return name.replace(/[^\w\d-_]+/g, "_").slice(0, 80) || "voxshelf";
}

function ffEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\\n").replace(/=/g, "\\=");
}

export function buildFfmetadata(
  doc: DocumentDetail,
  chapters: ChapterTiming[],
): string {
  const lines = [
    ";FFMETADATA1",
    `title=${ffEscape(doc.title)}`,
    `artist=${ffEscape(doc.author ?? "VoxShelf")}`,
  ];
  for (const c of chapters) {
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${c.startMs}`,
      `END=${c.endMs}`,
      `title=${ffEscape(c.title)}`,
    );
  }
  return lines.join("\n") + "\n";
}

function cueTimestamp(ms: number): string {
  const totalFrames = Math.floor((ms / 1000) * 75);
  const mm = String(Math.floor(totalFrames / (75 * 60))).padStart(2, "0");
  const ss = String(Math.floor(totalFrames / 75) % 60).padStart(2, "0");
  const ff = String(totalFrames % 75).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}

export function buildCueSheet(
  doc: DocumentDetail,
  wavFilename: string,
  chapters: ChapterTiming[],
): string {
  const lines = [
    `FILE "${wavFilename}" WAVE`,
    `  TITLE "${doc.title.replace(/"/g, "'")}"`,
    `  PERFORMER "${(doc.author ?? "VoxShelf").replace(/"/g, "'")}"`,
  ];
  chapters.forEach((c, i) => {
    lines.push(
      `  TRACK ${String(i + 1).padStart(2, "0")} AUDIO`,
      `    TITLE "${c.title.replace(/"/g, "'")}"`,
      `    INDEX 01 ${cueTimestamp(c.startMs)}`,
    );
  });
  return lines.join("\n") + "\n";
}

function ffmpegAvailable(): boolean {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

async function sentenceWav(
  doc: DocumentDetail,
  idx: number,
  text: string,
  audioHash: string | null,
  voice: string,
  style: string,
  sentenceVoice: string,
): Promise<Buffer> {
  const reuse =
    sentenceVoice === voice &&
    voice === doc.voice &&
    style === (doc.stylePrompt ?? "") &&
    !!audioHash;
  if (reuse && audioHash) {
    const cached = getCachedAudio(audioHash);
    if (cached && existsSync(cached.filePath)) {
      return readFileSync(cached.filePath);
    }
  }
  const result = await synthesizeAndCache(text, sentenceVoice, style);
  updateSentenceAudio(doc.id, idx, result.hash, result.durationMs);
  const cached = getCachedAudio(result.hash);
  return readFileSync(cached ? cached.filePath : audioFilePath(result.hash));
}

export async function exportAudiobook(
  doc: DocumentDetail,
  opts: { voice: string; style: string; format: AudiobookExportFormat },
): Promise<AudiobookResult> {
  const { voice, style } = opts;
  let format = opts.format;
  const chapters = detectChapters(doc.sentences);
  const dialogue = doc.dialogueActing;
  const dialogueOn = dialogue ? dialogue.enabled !== false : false;
  const voiceFor = (idx: number): string =>
    (dialogueOn && dialogue?.tags.find((t) => t.sentenceIdx === idx)?.voice) ||
    voice;

  const wavs: Buffer[] = [];
  const durations: number[] = [];
  for (const s of doc.sentences) {
    const wav = await sentenceWav(
      doc,
      s.idx,
      s.text,
      s.audioHash,
      voice,
      style,
      voiceFor(s.idx),
    );
    wavs.push(wav);
    durations.push(wavDurationMs(wav));
  }

  let cursor = 0;
  const timed: ChapterTiming[] = chapters.map((c) => {
    let end = cursor;
    for (let i = c.sentenceIdx; i < c.sentenceEnd; i++) {
      end += durations[i] ?? 0;
    }
    const t = { ...c, startMs: cursor, endMs: end };
    cursor = end;
    return t;
  });

  const fullWav = concatWavs(wavs);
  const base = safeName(doc.title);

  if (format === "wav") {
    return { buffer: fullWav, mime: "audio/wav", ext: "wav", fellBackToZip: false };
  }

  let fellBackToZip = false;
  if (format === "m4b") {
    if (ffmpegAvailable()) {
      const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const inWav = join(tmpdir(), `vs-audiobook-${stamp}.wav`);
      const meta = join(tmpdir(), `vs-audiobook-${stamp}.ffmetadata.txt`);
      const outM4b = join(tmpdir(), `vs-audiobook-${stamp}.m4b`);
      try {
        writeFileSync(inWav, fullWav);
        writeFileSync(meta, buildFfmetadata(doc, timed));
        const r = spawnSync(
          "ffmpeg",
          [
            "-y",
            "-i",
            inWav,
            "-i",
            meta,
            "-map_metadata",
            "1",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-f",
            "mp4",
            outM4b,
          ],
          { stdio: "pipe" },
        );
        if (r.error || r.status !== 0) {
          throw new Error(
            `ffmpeg m4b conversion failed${r.status ? ` (exit ${r.status})` : ""}.`,
          );
        }
        const buffer = readFileSync(outM4b);
        return { buffer, mime: "audio/mp4", ext: "m4b", fellBackToZip: false };
      } finally {
        for (const f of [inWav, meta, outM4b]) {
          try {
            if (existsSync(f)) unlinkSync(f);
          } catch {
            // ignore
          }
        }
      }
    }
    fellBackToZip = true;
    format = "chapter-zip";
  }

  const zip = new JSZip();
  zip.file(`${base}.wav`, fullWav);
  zip.file(`${base}.cue`, buildCueSheet(doc, `${base}.wav`, timed));
  zip.file("ffmetadata.txt", buildFfmetadata(doc, timed));
  zip.file(
    "chapters.json",
    JSON.stringify(
      timed.map((c) => ({
        index: c.index,
        title: c.title,
        sentenceIdx: c.sentenceIdx,
        sentenceEnd: c.sentenceEnd,
        wordCount: c.wordCount,
        startMs: c.startMs,
        endMs: c.endMs,
      })),
      null,
      2,
    ),
  );
  timed.forEach((c, i) => {
    const parts = wavs.slice(c.sentenceIdx, c.sentenceEnd);
    if (parts.length === 0) return;
    const num = String(i + 1).padStart(2, "0");
    zip.file(`chapters/${num} - ${safeName(c.title)}.wav`, concatWavs(parts));
  });
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  return { buffer, mime: "application/zip", ext: "zip", fellBackToZip };
}
