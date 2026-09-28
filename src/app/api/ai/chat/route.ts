import { NextRequest, NextResponse } from "next/server";
import { getDocumentDetail, getDocumentText } from "@/lib/documents";
import { chatWithDocument, type ChatHistoryMessage } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** POST /api/ai/chat — { documentId, messages?, userQuestion, key? } */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      documentId?: string;
      messages?: Array<{ role?: string; content?: string }>;
      userQuestion?: string;
      key?: string;
    };
    if (!body.documentId) return apiError("documentId is required.", 400);
    const question = body.userQuestion?.trim() || "";
    if (!question) return apiError("userQuestion is required.", 400);
    if (question.length > 2000) {
      return apiError("Question is too long (max 2000 characters).", 400);
    }
    const detail = getDocumentDetail(body.documentId);
    if (!detail) return apiError("Document not found.", 404);
    const text = getDocumentText(body.documentId) || "";
    if (!text) return apiError("Document has no text.", 400);
    const history: ChatHistoryMessage[] = Array.isArray(body.messages)
      ? body.messages
          .filter(
            (m): m is { role: string; content: string } =>
              !!m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"),
          )
          .slice(-12)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.trim().slice(0, 2000) }))
          .filter((m) => m.content.length > 0)
      : [];
    const answer = await chatWithDocument(detail.title, text, history, question, body.key);
    return NextResponse.json({ answer });
  } catch (err) {
    return toApiError(err);
  }
}
