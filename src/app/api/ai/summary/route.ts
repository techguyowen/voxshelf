import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDocumentText, getDocumentDetail } from "@/lib/documents";
import { summarizeDocument } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/ai/summary — { documentId? | (title? + text), length?, key? } */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      documentId?: string;
      title?: string;
      text?: string;
      length?: "short" | "detailed";
      key?: string;
    };
    let title = body.title?.trim() || "Document";
    let text = body.text?.trim() || "";
    if (body.documentId) {
      const detail = getDocumentDetail(body.documentId);
      if (!detail) return apiError("Document not found.", 404);
      title = detail.title;
      text = getDocumentText(body.documentId) || "";
    }
    if (!text) return apiError("No text to summarize.", 400);
    const summary = await summarizeDocument(
      title,
      text,
      body.length === "detailed" ? "detailed" : "short",
      body.key,
    );
    return NextResponse.json({ summary });
  } catch (err) {
    return toApiError(err);
  }
}
