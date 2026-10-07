import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDocumentDetail } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";
import { RECORDINGS_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inferMimeType(filePath: string, fallback = "audio/webm"): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    default:
      return fallback;
  }
}

function findRecordingFile(docId: string, recordedPath?: string | null): string | null {
  if (recordedPath && existsSync(recordedPath)) {
    return recordedPath;
  }
  if (!existsSync(RECORDINGS_DIR)) return null;

  try {
    const files = readdirSync(RECORDINGS_DIR);
    const match = files.find(
      (f) => f.startsWith(`${docId}_recording`) || f.startsWith(`${docId}.`),
    );
    if (match) {
      const full = path.join(RECORDINGS_DIR, match);
      if (existsSync(full)) return full;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * GET /api/documents/[id]/recording — stream the saved raw audio recording
 * with HTTP Range (status 206) support for instant audio seeking and scrubbing.
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

    const filePath = findRecordingFile(id, doc.audioNotes?.originalAudioPath);
    if (!filePath) {
      return apiError("Audio recording not found for this document.", 404);
    }

    const stat = statSync(filePath);
    const totalSize = stat.size;
    const mimeType =
      doc.audioNotes?.mimeType || inferMimeType(filePath, "audio/webm");
    const filename =
      doc.audioNotes?.originalFilename ||
      path.basename(filePath) ||
      `${id}_recording.webm`;

    const rangeHeader = req.headers.get("range");

    if (rangeHeader) {
      // Parse Range header e.g. "bytes=0-1024" or "bytes=1024-"
      const match = /^bytes=(\d+)-(\d+)?$/i.exec(rangeHeader.trim());
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

        if (start < totalSize && end < totalSize && start <= end) {
          const chunkSize = end - start + 1;
          const nodeStream = createReadStream(filePath, { start, end });
          const webStream = Readable.toWeb(nodeStream) as ReadableStream;

          return new NextResponse(webStream, {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${end}/${totalSize}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunkSize),
              "Content-Type": mimeType,
              "Content-Disposition": `inline; filename="${filename}"`,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }

        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
          },
        });
      }
    }

    // Full audio response
    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(totalSize),
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}

/** HEAD /api/documents/[id]/recording — metadata for audio scrubbing. */
export async function HEAD(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireAuth(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    const doc = getDocumentDetail(id);
    if (!doc) return apiError("Document not found.", 404);

    const filePath = findRecordingFile(id, doc.audioNotes?.originalAudioPath);
    if (!filePath) {
      return apiError("Audio recording not found.", 404);
    }

    const stat = statSync(filePath);
    const mimeType =
      doc.audioNotes?.mimeType || inferMimeType(filePath, "audio/webm");

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(stat.size),
        "Content-Type": mimeType,
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}
