import { NextRequest, NextResponse } from "next/server";
import { deleteFolder } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/folders/[id] — documents inside become unfiled. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!deleteFolder(id)) return apiError("Folder not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}
