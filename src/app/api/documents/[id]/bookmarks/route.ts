import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { addBookmark, getDocumentDetail, listBookmarks } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/documents/[id]/bookmarks */
export async function GET(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!getDocumentDetail(id)) return apiError("Document not found.", 404);
    return NextResponse.json({ bookmarks: listBookmarks(id) });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/documents/[id]/bookmarks — { sentenceIdx, note? } */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await req.json()) as { sentenceIdx?: number; note?: string };
    if (typeof body.sentenceIdx !== "number") {
      return apiError("sentenceIdx is required.", 400);
    }
    const bookmark = addBookmark(id, body.sentenceIdx, body.note);
    return NextResponse.json(bookmark, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}
