import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { exportAudiobook, safeName } from "@/lib/audiobookExport";
import { getDocumentDetail } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";
import type { AudiobookExportFormat } from "@/lib/types";
import { isValidVoice } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FORMATS: AudiobookExportFormat[] = ["chapter-zip", "wav", "m4b"];

/**
 * GET /api/documents/[id]/audiobook — chapterized audiobook export.
 * Missing sentence audio is synthesized on demand. ?download=1 forces attachment.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const doc = getDocumentDetail(id);
    if (!doc) return apiError("Document not found.", 404);
    if (doc.sentences.length === 0) return apiError("Document has no sentences.", 400);

    const sp = req.nextUrl.searchParams;
    const rawFormat = sp.get("format") || "chapter-zip";
    if (!(FORMATS as string[]).includes(rawFormat)) {
      return apiError("Unknown format. Use chapter-zip, wav, or m4b.", 400);
    }
    const voice = sp.get("voice") || doc.voice;
    const style = sp.get("style") ?? doc.stylePrompt ?? "";
    if (!isValidVoice(voice)) return apiError("Unknown voice.", 400);

    const result = await exportAudiobook(doc, {
      voice,
      style,
      format: rawFormat as AudiobookExportFormat,
    });
    const filename = `${safeName(doc.title)}.${result.ext}`;
    const download = sp.get("download") === "1";
    return new NextResponse(result.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.mime,
        "Content-Length": String(result.buffer.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}
