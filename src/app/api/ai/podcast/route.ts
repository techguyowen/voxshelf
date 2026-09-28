import { NextRequest, NextResponse } from "next/server";
import { getDocumentDetail, getDocumentText } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";
import { generatePodcast, listPodcasts } from "@/lib/podcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/ai/podcast?documentId=… — list saved podcast episodes for a document. */
export async function GET(req: NextRequest) {
  try {
    const documentId = req.nextUrl.searchParams.get("documentId") || "";
    if (!documentId) return apiError("documentId is required.", 400);
    const detail = getDocumentDetail(documentId);
    if (!detail) return apiError("Document not found.", 404);
    return NextResponse.json({ podcasts: listPodcasts(documentId) });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/ai/podcast — { documentId, saveAsDocument?, key? } */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      documentId?: string;
      saveAsDocument?: boolean;
      key?: string;
    };
    if (!body.documentId) return apiError("documentId is required.", 400);
    const detail = getDocumentDetail(body.documentId);
    if (!detail) return apiError("Document not found.", 404);
    const text = getDocumentText(body.documentId) || "";
    if (!text) return apiError("Document has no text.", 400);
    const episode = await generatePodcast(detail.id, detail.title, text, {
      saveAsDocument: body.saveAsDocument === true,
      key: body.key,
    });
    return NextResponse.json(episode);
  } catch (err) {
    return toApiError(err);
  }
}
