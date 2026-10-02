import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDocumentDetail, getDocumentText } from "@/lib/documents";
import { generateQuiz } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/ai/quiz — { documentId, key? } → 5 MCQs + 5 flashcards. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { documentId?: string; key?: string };
    if (!body.documentId) return apiError("documentId is required.", 400);
    const detail = getDocumentDetail(body.documentId);
    if (!detail) return apiError("Document not found.", 404);
    const text = getDocumentText(body.documentId) || "";
    if (!text) return apiError("Document has no text.", 400);
    const quiz = await generateQuiz(detail.title, text, body.key);
    return NextResponse.json(quiz);
  } catch (err) {
    return toApiError(err);
  }
}
