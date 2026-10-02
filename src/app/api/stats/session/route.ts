import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { dbRun } from "@/lib/db";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SessionBody {
  docId?: string;
  durationSeconds?: number;
  wordsRead?: number;
  speed?: number;
}

/** POST /api/stats/session — record a reading/listening session ping. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as SessionBody;
    if (!body.docId || typeof body.docId !== "string") {
      return apiError("docId is required.", 400);
    }
    const durationSeconds = Math.max(
      0,
      Math.min(3600, Math.floor(Number(body.durationSeconds) || 0)),
    );
    const wordsRead = Math.max(
      0,
      Math.min(100_000, Math.floor(Number(body.wordsRead) || 0)),
    );
    const speed = Math.min(
      4.5,
      Math.max(0.5, Number(body.speed) || 1),
    );
    if (durationSeconds <= 0) return apiError("durationSeconds must be > 0.", 400);
    dbRun(
      "INSERT INTO reading_sessions (id, doc_id, duration_seconds, words_read, speed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      randomUUID(),
      body.docId,
      durationSeconds,
      wordsRead,
      speed,
      new Date().toISOString(),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    if (/FOREIGN KEY/i.test(message)) {
      return apiError("Document not found.", 404);
    }
    return toApiError(err);
  }
}
