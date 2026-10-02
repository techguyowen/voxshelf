import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { cleanupDictation, cleanupText } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/ai/cleanup — { text, mode?: "extract" | "dictation", key? }. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { text?: string; mode?: string; key?: string };
    const text = body.text?.trim() || "";
    if (!text) return apiError("text is required.", 400);
    const cleaned =
      body.mode === "dictation"
        ? await cleanupDictation(text, body.key)
        : await cleanupText(text, body.key);
    return NextResponse.json({ text: cleaned });
  } catch (err) {
    return toApiError(err);
  }
}
