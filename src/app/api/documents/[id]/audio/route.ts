import { readFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getCachedAudio } from "@/lib/audioCache";
import { audioFilePath, concatWavs } from "@/lib/audio";
import { getDocumentDetail, updateSentenceAudio } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";
import { synthesizeAndCache } from "@/lib/tts";
import { isValidVoice } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/documents/[id]/audio — stitch all sentence audio into one WAV.
 * Missing sentences are synthesized on demand. ?download=1 forces attachment.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const doc = getDocumentDetail(id);
    if (!doc) return apiError("Document not found.", 404);
    if (doc.sentences.length === 0) return apiError("Document has no sentences.", 400);

    const sp = req.nextUrl.searchParams;
    const voice = sp.get("voice") || doc.voice;
    const style = sp.get("style") ?? doc.stylePrompt ?? "";
    if (!isValidVoice(voice)) return apiError("Unknown voice.", 400);

    const parts: Buffer[] = [];
    for (const s of doc.sentences) {
      const result = await synthesizeAndCache(s.text, voice, style);
      updateSentenceAudio(id, s.idx, result.hash, result.durationMs);
      const cached = getCachedAudio(result.hash);
      const filePath = cached ? cached.filePath : audioFilePath(result.hash);
      parts.push(readFileSync(filePath));
    }
    const wav = concatWavs(parts);
    const safeName = `${doc.title.replace(/[^\w\d-_]+/g, "_").slice(0, 80) || "vocalflow"}.wav`;
    const download = sp.get("download") === "1";
    return new NextResponse(wav as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}
