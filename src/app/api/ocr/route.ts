import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { cleanupText } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";
import { runOcr, type OcrMode } from "@/lib/extract/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/ocr — multipart form with an image `file`.
 * Optional: mode ("auto"|"local"|"ai"), cleanup ("1"), key.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return apiError("An image `file` is required.", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return apiError("Image is too large (max 25 MB).", 400);
    }
    if (file.type && !file.type.startsWith("image/")) {
      return apiError("Only image files are accepted for OCR.", 400);
    }
    const modeRaw = form.get("mode");
    const mode: OcrMode =
      modeRaw === "local" || modeRaw === "ai" ? modeRaw : "auto";
    const cleanup = form.get("cleanup") === "1" || form.get("cleanup") === "true";
    const key = typeof form.get("key") === "string" ? (form.get("key") as string) : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const out = await runOcr(buffer, file.type || "image/png", mode, key);
    if (!out.text) {
      return apiError("No readable text found in this image.", 400);
    }
    let cleaned: string | undefined;
    if (cleanup) {
      cleaned = await cleanupText(out.text, key);
    }
    return NextResponse.json({ ...out, ...(cleaned ? { cleaned } : {}) });
  } catch (err) {
    return toApiError(err);
  }
}
