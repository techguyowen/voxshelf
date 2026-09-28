import { NextResponse } from "next/server";
import { getDefaultVoice } from "@/lib/settings";
import { toApiError } from "@/lib/http";
import { GEMINI_VOICES } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/voices — all 30 Gemini voices + server default. */
export async function GET() {
  try {
    return NextResponse.json({ voices: GEMINI_VOICES, default: getDefaultVoice() });
  } catch (err) {
    return toApiError(err);
  }
}
