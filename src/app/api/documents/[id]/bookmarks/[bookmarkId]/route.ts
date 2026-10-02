import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteBookmark } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/documents/[id]/bookmarks/[bookmarkId] */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bookmarkId: string }> },
) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { bookmarkId } = await params;
    if (!deleteBookmark(bookmarkId)) return apiError("Bookmark not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}
