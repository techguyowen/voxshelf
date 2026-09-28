import { NextRequest, NextResponse } from "next/server";
import { deleteHighlight } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; highlightId: string }> };

/** DELETE /api/documents/[id]/highlights/[highlightId] */
export async function DELETE(_req: NextRequest, { params }: Params) {
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
