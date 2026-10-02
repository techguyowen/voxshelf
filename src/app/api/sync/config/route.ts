import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";
import {
  getSyncStatus,
  runSyncNow,
  setSyncConfig,
} from "@/lib/syncWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/config — { serverUrl?, enabled? }.
 * Empty serverUrl disables remote sync (standalone local mode).
 * A successful save kicks off a background cycle.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      serverUrl?: unknown;
      enabled?: unknown;
      apiKey?: unknown;
      mode?: unknown;
    };
    const patch: {
      serverUrl?: string;
      enabled?: boolean;
      apiKey?: string;
      mode?: "full" | "selective";
    } = {};
    if (body.serverUrl !== undefined) {
      if (typeof body.serverUrl !== "string") {
        return apiError("serverUrl must be a string.", 400);
      }
      patch.serverUrl = body.serverUrl;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return apiError("enabled must be a boolean.", 400);
      }
      patch.enabled = body.enabled;
    }
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string" || body.apiKey.length > 500) {
        return apiError("apiKey must be a string.", 400);
      }
      patch.apiKey = body.apiKey;
    }
    if (body.mode !== undefined) {
      if (body.mode !== "full" && body.mode !== "selective") {
        return apiError('mode must be "full" or "selective".', 400);
      }
      patch.mode = body.mode;
    }
    try {
      setSyncConfig(patch);
    } catch (err) {
      return apiError(err instanceof Error ? err.message : "Invalid config.", 400);
    }
    const status = getSyncStatus();
    if (status.enabled && status.serverUrl) {
      runSyncNow().catch(() => {
        // The summary records the error; the response stays truthful.
      });
    }
    return NextResponse.json(getSyncStatus());
  } catch (err) {
    return toApiError(err);
  }
}
