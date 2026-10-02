import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toApiError } from "@/lib/http";
import { synthesizeAndCache } from "@/lib/tts";
import type { TtsRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/tts — synthesize text to a cached audio file. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as TtsRequest;
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }
    const result = await synthesizeAndCache(
      body.text,
      body.voice,
      body.stylePrompt,
      body.key,
    );
    return NextResponse.json({
      ...result,
      url: `/api/audio/${result.hash}`,
    });
  } catch (err) {
    return toApiError(err);
  }
}
