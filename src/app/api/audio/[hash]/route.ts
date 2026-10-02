import { readFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getCachedAudio } from "@/lib/audioCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audio/[hash] — stream a cached WAV file (immutable, cacheable). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { hash } = await params;
  const cached = getCachedAudio(hash);
  if (!cached) {
    return NextResponse.json({ error: "Audio not found." }, { status: 404 });
  }
  const data = readFileSync(cached.filePath);
  return new NextResponse(data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${hash}.wav"`,
    },
  });
}
