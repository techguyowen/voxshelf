import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { searchLibraryFullText } from "@/lib/documents";
import { toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/search?q=...&limit=... — full-text library search. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const sp = req.nextUrl.searchParams;
    const query = sp.get("q") || "";
    const limit = Number(sp.get("limit")) || 40;
    const hits = searchLibraryFullText(query, limit);
    return NextResponse.json({ query, hits });
  } catch (err) {
    return toApiError(err);
  }
}
