import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteHighlight, updateHighlight } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; highlightId: string }> };

/** PATCH /api/documents/[id]/highlights/[highlightId] — { note?, color? } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id, highlightId } = await params;
    const body = (await req.json()) as {
      note?: string | null;
      color?: unknown;
    };
    const updated = updateHighlight(id, highlightId, {
      note: body.note,
      color: body.color,
    });
    if (!updated) {
      return apiError("Highlight not found.", 404);
    }
    return NextResponse.json(updated);
  } catch (err) {
    return toApiError(err);
  }
}

/** DELETE /api/documents/[id]/highlights/[highlightId] */
export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id, highlightId } = await params;
    if (!deleteHighlight(id, highlightId)) {
      return apiError("Highlight not found.", 404);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}
