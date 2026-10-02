import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";
import { collectDocsByIds, SYNC_VERSION } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/fetch — { v, ids } full rows for explicit docs
 * (+ their folders and annotations). Powers selective download.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { v?: number; ids?: unknown };
    if (body.v !== SYNC_VERSION) {
      return apiError(
        `Unsupported sync version (want ${SYNC_VERSION}). Update both sides.`,
        400,
      );
    }
    if (!Array.isArray(body.ids)) return apiError("ids must be an array.", 400);
    const ids = [...new Set(body.ids)]
      .filter((id): id is string => typeof id === "string" && !!id && id.length <= 128)
      .slice(0, 200);
    if (ids.length === 0) return apiError("No valid document ids.", 400);
    const { changes, missing } = collectDocsByIds(ids);
    return NextResponse.json({ v: SYNC_VERSION, changes, missing });
  } catch (err) {
    return toApiError(err);
  }
}
