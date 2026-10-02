import { NextRequest, NextResponse } from "next/server";
import {
  deleteDocument,
  getDocumentDetail,
  updateDocument,
  type UpdateDocumentPatch,
} from "@/lib/documents";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/documents/[id] — full detail incl. sentences + bookmarks. */
export async function GET(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const doc = getDocumentDetail(id);
    if (!doc) return apiError("Document not found.", 404);
    return NextResponse.json(doc);
  } catch (err) {
    return toApiError(err);
  }
}

/** PATCH /api/documents/[id] — update title/voice/speed/tags/progress/archived. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const patch = (await req.json()) as UpdateDocumentPatch;
    const updated = updateDocument(id, patch || {});
    if (!updated) return apiError("Document not found.", 404);
    return NextResponse.json(updated);
  } catch (err) {
    return toApiError(err);
  }
}

/** DELETE /api/documents/[id] */
export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!deleteDocument(id)) return apiError("Document not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}
