import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { dbAll, dbRun, recordTombstone } from "@/lib/db";
import { apiError, toApiError } from "@/lib/http";
import { loadPronunciationRules } from "@/lib/pronunciation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pronunciations — list all phonetic substitution rules. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ rules: loadPronunciationRules() });
  } catch (err) {
    return toApiError(err);
  }
}

interface RuleBody {
  id?: string;
  word?: string;
  replacement?: string;
  caseSensitive?: boolean;
}

/** POST /api/pronunciations — create or update a rule. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as RuleBody;
    const word = body.word?.trim();
    const replacement = body.replacement?.trim();
    if (!word) return apiError("word is required.", 400);
    if (replacement === undefined || replacement === "") {
      return apiError("replacement is required.", 400);
    }
    if (word.length > 200 || replacement.length > 500) {
      return apiError("Rule is too long.", 400);
    }
    const caseSensitive = body.caseSensitive === true ? 1 : 0;
    const now = new Date().toISOString();

    if (body.id) {
      const res = dbRun(
        "UPDATE pronunciation_dictionary SET word = ?, replacement = ?, case_sensitive = ?, updated_at = ? WHERE id = ?",
        word,
        replacement,
        caseSensitive,
        now,
        body.id,
      );
      if (res.changes === 0) return apiError("Rule not found.", 404);
    } else {
      const existing = dbAll<{ id: string }>(
        "SELECT id FROM pronunciation_dictionary WHERE word = ?",
        word,
      );
      if (existing.length > 0) {
        dbRun(
          "UPDATE pronunciation_dictionary SET replacement = ?, case_sensitive = ?, updated_at = ? WHERE word = ?",
          replacement,
          caseSensitive,
          now,
          word,
        );
      } else {
        dbRun(
          "INSERT INTO pronunciation_dictionary (id, word, replacement, case_sensitive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          randomUUID(),
          word,
          replacement,
          caseSensitive,
          now,
          now,
        );
      }
    }
    return NextResponse.json({ rules: loadPronunciationRules() });
  } catch (err) {
    return toApiError(err);
  }
}

/** DELETE /api/pronunciations?id=... — remove a rule. */
export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return apiError("id is required.", 400);
    const res = dbRun("DELETE FROM pronunciation_dictionary WHERE id = ?", id);
    if (res.changes === 0) return apiError("Rule not found.", 404);
    recordTombstone("pronunciation_dictionary", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}
