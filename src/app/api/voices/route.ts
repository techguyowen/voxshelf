import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDefaultVoice } from "@/lib/settings";
import { toApiError } from "@/lib/http";
import { GEMINI_VOICES } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/voices — all 30 Gemini voices + server default. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ voices: GEMINI_VOICES, default: getDefaultVoice() });
  } catch (err) {
    return toApiError(err);
  }
}
