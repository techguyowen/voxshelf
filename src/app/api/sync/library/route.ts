import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toApiError } from "@/lib/http";
import { collectLibrary, SYNC_VERSION } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sync/library — lightweight peer catalog for the server browser.
 * Titles/metadata only, no text. Bearer-authed like push/pull.
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ v: SYNC_VERSION, ...collectLibrary() });
  } catch (err) {
    return toApiError(err);
  }
}
