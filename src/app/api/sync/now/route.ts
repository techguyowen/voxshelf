import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toApiError } from "@/lib/http";
import { runSyncNow } from "@/lib/syncWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/sync/now — run one full push/pull cycle and return the summary. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await runSyncNow());
  } catch (err) {
    return toApiError(err);
  }
}
