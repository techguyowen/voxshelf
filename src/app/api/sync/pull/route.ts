import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";
import {
  collectChanges,
  normalizeCursors,
  normalizeTables,
  SYNC_VERSION,
} from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/pull — { v, cursors, tables? }.
 * Returns rows newer than the caller's cursors, plus fresh cursors.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      v?: number;
      cursors?: unknown;
      tables?: unknown;
    };
    if (body.v !== SYNC_VERSION) {
      return apiError(
        `Unsupported sync version (want ${SYNC_VERSION}). Update both sides.`,
        400,
      );
    }
    const result = collectChanges(
      normalizeCursors(body.cursors),
      normalizeTables(body.tables),
    );
    return NextResponse.json({
      v: SYNC_VERSION,
      ...result,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return toApiError(err);
  }
}
