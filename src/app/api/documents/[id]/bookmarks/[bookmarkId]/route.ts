import { NextRequest, NextResponse } from "next/server";
import { deleteBookmark } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/documents/[id]/bookmarks/[bookmarkId] */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bookmarkId: string }> },
) {
  try {
    const { bookmarkId } = await params;
    if (!deleteBookmark(bookmarkId)) return apiError("Bookmark not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}
