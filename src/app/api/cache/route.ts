import { NextResponse } from "next/server";
import { cacheStats, clearCache } from "@/lib/audioCache";
import { toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cache — audio cache statistics. */
export async function GET() {
  try {
    return NextResponse.json(cacheStats());
  } catch (err) {
    return toApiError(err);
  }
}

/** DELETE /api/cache — clear all cached audio (files + index). */
export async function DELETE() {
  try {
    const result = clearCache();
    return NextResponse.json({ ok: true, ...result, stats: cacheStats() });
  } catch (err) {
    return toApiError(err);
  }
}
