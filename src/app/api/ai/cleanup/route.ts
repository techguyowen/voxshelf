import { NextRequest, NextResponse } from "next/server";
import { cleanupText } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/ai/cleanup — { text, key? } → OCR/extraction artifact cleanup. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string; key?: string };
    const text = body.text?.trim() || "";
    if (!text) return apiError("text is required.", 400);
    const cleaned = await cleanupText(text, body.key);
    return NextResponse.json({ text: cleaned });
  } catch (err) {
    return toApiError(err);
  }
}
