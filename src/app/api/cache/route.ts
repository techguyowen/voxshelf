import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { cacheStats, clearCache } from "@/lib/audioCache";
import { toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cache — audio cache statistics. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json(cacheStats());
  } catch (err) {
    return toApiError(err);
  }
}

/** DELETE /api/cache — clear all cached audio (files + index). */
export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const result = clearCache();
    return NextResponse.json({ ok: true, ...result, stats: cacheStats() });
  } catch (err) {
    return toApiError(err);
  }
}
