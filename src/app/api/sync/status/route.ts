import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toApiError } from "@/lib/http";
import { getSyncStatus } from "@/lib/syncWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sync/status — local sync config + last-cycle summary. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json(getSyncStatus());
  } catch (err) {
    return toApiError(err);
  }
}
