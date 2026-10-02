import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";
import {
  applyChanges,
  cleanChanges,
  cleanTombstones,
  SYNC_VERSION,
} from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/push — { v, changes, tombstones }.
 * Last-write-wins merge into this node's db. Idempotent: re-sending the
 * same rows is a no-op (equal stamps converge silently).
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      v?: number;
      changes?: unknown;
      tombstones?: unknown;
    };
    if (body.v !== SYNC_VERSION) {
      return apiError(
        `Unsupported sync version (want ${SYNC_VERSION}). Update both sides.`,
        400,
      );
    }
    const { changes, rejected } = cleanChanges(body.changes);
    const tombs = cleanTombstones(body.tombstones);
    const result = applyChanges(changes, tombs.tombstones);
    return NextResponse.json({
      v: SYNC_VERSION,
      applied: result.applied,
      conflicts: result.conflicts,
      rejected: result.rejected + rejected + tombs.rejected,
      skippedOrphans: result.skippedOrphans,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return toApiError(err);
  }
}
