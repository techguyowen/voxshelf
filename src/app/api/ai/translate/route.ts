import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDocumentDetail } from "@/lib/documents";
import { translateSentencesBatch } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";
import { getSetting, setSetting } from "@/lib/settings";
import type { DocumentTranslation, TranslationLanguage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_REQUEST = 120;
const CHUNK_SIZE = 40;

function cacheKey(documentId: string, language: string): string {
  return `translation:${documentId}:${language}`;
}

function loadCached(documentId: string, language: string): DocumentTranslation | null {
  const raw = getSetting(cacheKey(documentId, language), "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DocumentTranslation;
    if (!parsed || typeof parsed !== "object" || !parsed.sentences) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** GET /api/ai/translate?documentId=...&language=... — cached translation. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const sp = req.nextUrl.searchParams;
    const documentId = sp.get("documentId") || "";
    const language = sp.get("language") || "";
    if (!documentId || !language) {
      return apiError("documentId and language are required.", 400);
    }
    return NextResponse.json({ translation: loadCached(documentId, language) });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/ai/translate — translate a sentence range, caching results. */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      documentId?: string;
      language?: TranslationLanguage;
      startIdx?: number;
      count?: number;
      force?: boolean;
      key?: string;
    };
    if (!body.documentId || !body.language) {
      return apiError("documentId and language are required.", 400);
    }
    const doc = getDocumentDetail(body.documentId);
    if (!doc) return apiError("Document not found.", 404);
    const total = doc.sentences.length;
    if (total === 0) return apiError("Document has no sentences.", 400);

    const startIdx = Math.max(0, Math.min(total - 1, Math.floor(body.startIdx ?? 0)));
    const count =
      body.count === undefined
        ? total <= MAX_PER_REQUEST
          ? total
          : 60
        : Math.max(1, Math.min(MAX_PER_REQUEST, Math.floor(body.count)));
    const endIdx = Math.min(total, startIdx + count);

    const cached = loadCached(body.documentId, body.language);
    const sentences: Record<number, string> = { ...(cached?.sentences ?? {}) };
    const missing = doc.sentences
      .slice(startIdx, endIdx)
      .filter((s) => body.force || !(s.idx in sentences))
      .map((s) => ({ idx: s.idx, text: s.text }));

    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      const batch = await translateSentencesBatch(
        missing.slice(i, i + CHUNK_SIZE),
        body.language,
        body.key,
      );
      Object.assign(sentences, batch);
    }

    const record: DocumentTranslation = {
      docId: body.documentId,
      language: body.language,
      sentences,
      updatedAt: new Date().toISOString(),
    };
    setSetting(cacheKey(body.documentId, body.language), JSON.stringify(record));
    return NextResponse.json({ translation: record });
  } catch (err) {
    return toApiError(err);
  }
}
