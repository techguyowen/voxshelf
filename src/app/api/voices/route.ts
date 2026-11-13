import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDefaultVoice } from "@/lib/settings";
import { toApiError } from "@/lib/http";
import { listLocalVoices } from "@/lib/localTts";
import { GEMINI_VOICES } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const localVoices = await listLocalVoices().catch(() => []);
    return NextResponse.json({ voices: GEMINI_VOICES, localVoices, default: getDefaultVoice() });
  } catch (err) {
    return toApiError(err);
  }
}
