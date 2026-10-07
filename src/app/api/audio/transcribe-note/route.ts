import { writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createDocument } from "@/lib/documents";
import { transcribeAndNoteAudio, generateNotesFromTranscript } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";
import { RECORDINGS_DIR, ensureDirs } from "@/lib/paths";
import type { AudioNoteMetadata, AudioNoteMode, AudioTranscribeAndNoteResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getExtensionForMime(mimeType: string, filename?: string): string {
  if (filename) {
    const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
    if (ext && ext.length <= 5) return ext;
  }
  const clean = mimeType.toLowerCase().split(";")[0].trim();
  switch (clean) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    case "audio/flac":
      return "flac";
    case "audio/aac":
      return "aac";
    case "audio/webm":
    default:
      return "webm";
  }
}

function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // comma separated string
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * POST /api/audio/transcribe-note
 * Accepts multipart/form-data:
 * - file: audio file / recording blob
 * - mode: AudioNoteMode ("notes" | "meeting" | "lecture" | "transcript-only")
 * - title: optional custom title
 * - saveDocument: boolean ("true" / "1" / default true)
 * - tags: optional tags
 * - key: optional explicit Gemini API key
 * - durationMs: optional duration in ms
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  try {
    ensureDirs();

    const formData = await req.formData();
    const file = formData.get("file") as File | Blob | null;

    if (!file) {
      return apiError("Missing audio file.", 400);
    }

    const mode = ((formData.get("mode") as string) || "notes") as AudioNoteMode;
    const customTitle = (formData.get("title") as string | null)?.trim() || undefined;
    const saveDocParam = formData.get("saveDocument");
    const saveDocument = saveDocParam !== "false" && saveDocParam !== "0";
    const tags = parseTags(formData.get("tags"));
    const explicitKey = (formData.get("key") as string | null)?.trim() || undefined;
    const durationMsRaw = formData.get("durationMs");
    const durationMs = durationMsRaw ? Number(durationMsRaw) : null;
    const isLive = formData.get("recordedLive") === "1" || formData.get("recordedLive") === "true";

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return apiError("Audio file is empty.", 400);
    }

    const originalName = file instanceof File ? file.name : "recording.webm";
    const mimeType = file.type || "audio/webm";
    const ext = getExtensionForMime(mimeType, originalName);

    const docId = randomUUID();
    const recordingFilename = `${docId}_recording.${ext}`;
    const recordingPath = path.join(RECORDINGS_DIR, recordingFilename);

    // Save audio recording permanently to disk
    writeFileSync(recordingPath, buffer);

    const providedTranscript = (formData.get("transcript") as string | null)?.trim();

    let noteResult: AudioTranscribeAndNoteResult;
    if (providedTranscript && providedTranscript.length > 0) {
      if (mode === "transcript-only") {
        noteResult = {
          title: customTitle || (isLive ? "Live Voice Note" : "Voice Note"),
          transcript: providedTranscript,
          summary: "Live voice transcript",
          notes: providedTranscript,
          actionItems: [],
          keyPoints: [],
        };
      } else {
        noteResult = await generateNotesFromTranscript(
          providedTranscript,
          mode,
          explicitKey,
        );
      }
    } else {
      // No live transcript provided — upload audio to Gemini for speech-to-text
      const audioBase64 = buffer.toString("base64");
      noteResult = await transcribeAndNoteAudio(
        audioBase64,
        mimeType,
        mode,
        explicitKey,
      );
    }

    let document = null;

    if (saveDocument) {
      const finalTitle =
        customTitle ||
        noteResult.title ||
        (isLive ? "Voice Note" : originalName.replace(/\.[^/.]+$/, ""));

      const fullText =
        noteResult.transcript.trim() ||
        noteResult.summary ||
        "No speech detected in audio recording.";

      const metadata: AudioNoteMetadata = {
        originalAudioUrl: `/api/documents/${docId}/recording`,
        originalAudioPath: recordingPath,
        originalFilename: originalName,
        mimeType,
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
        mode,
        summary: noteResult.summary ?? null,
        notes: noteResult.notes ?? null,
        actionItems: noteResult.actionItems ?? [],
        keyPoints: noteResult.keyPoints ?? [],
        recordedLive: isLive,
      };

      document = createDocument({
        id: docId,
        title: finalTitle,
        text: fullText,
        sourceType: isLive ? "voice-note" : "audio-recording",
        tags,
        metadata,
      });
    }

    return NextResponse.json({
      document,
      result: noteResult,
    });
  } catch (err) {
    return toApiError(err);
  }
}
