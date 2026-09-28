import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_BYTES = 15 * 1024 * 1024;

/** POST /api/ai/transcribe — FormData { file } → { text }. */
export async function POST(req: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError("file is required (multipart form).", 400);
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return apiError("file is required.", 400);
    if (file.size === 0) return apiError("Audio file is empty.", 400);
    if (file.size > MAX_BYTES) return apiError("Audio is too large (max 15 MB).", 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await transcribeAudio(
      buffer.toString("base64"),
      file.type || "audio/webm",
      (form.get("key") as string) || undefined,
    );
    return NextResponse.json({ text });
  } catch (err) {
    return toApiError(err);
  }
}
