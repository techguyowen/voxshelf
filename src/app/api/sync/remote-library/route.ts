import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";
import { fetchRemoteLibrary } from "@/lib/syncWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sync/remote-library — this device's view of the peer catalog. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await fetchRemoteLibrary());
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Request failed.", 502);
  }
}
