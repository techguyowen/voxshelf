import { NextRequest, NextResponse } from "next/server";
import {
  addHighlight,
  getDocumentDetail,
  listHighlights,
} from "@/lib/documents";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/documents/[id]/highlights */
export async function GET(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!getDocumentDetail(id)) return apiError("Document not found.", 404);
    return NextResponse.json({ highlights: listHighlights(id) });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/documents/[id]/highlights — { sentenceIdx, text, color?, note? } */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      sentenceIdx?: number;
      text?: string;
      color?: string;
      note?: string;
    };
    if (typeof body.sentenceIdx !== "number") {
      return apiError("sentenceIdx is required.", 400);
    }
    if (typeof body.text !== "string" || !body.text.trim()) {
      return apiError("text is required.", 400);
    }
    const highlight = addHighlight(
      id,
      body.sentenceIdx,
      body.text,
      body.color,
      body.note,
    );
    return NextResponse.json(highlight, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}
