import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDocumentDetail, saveDocumentDialogue } from "@/lib/documents";
import { analyzeDocumentDialogue } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";
import type { CharacterVoiceAssignment, DialogueAnalysisResult } from "@/lib/types";
import { VOICE_NAMES } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/ai/dialogue?documentId=… — retrieve current dialogue analysis */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const documentId = req.nextUrl.searchParams.get("documentId") || "";
    if (!documentId) return apiError("documentId is required.", 400);
    const detail = getDocumentDetail(documentId);
    if (!detail) return apiError("Document not found.", 404);
    return NextResponse.json({
      documentId: detail.id,
      analysis: detail.dialogueActing ?? null,
    });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/ai/dialogue — { documentId: string, key?: string } */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      documentId?: string;
      key?: string;
    };
    if (!body.documentId) return apiError("documentId is required.", 400);

    const detail = getDocumentDetail(body.documentId);
    if (!detail) return apiError("Document not found.", 404);

    if (detail.sentences.length === 0) {
      return apiError("Document has no sentences to analyze.", 400);
    }

    const sentences = detail.sentences.map((s) => ({
      idx: s.idx,
      text: s.text,
    }));

    const analysis = await analyzeDocumentDialogue(
      detail.title,
      sentences,
      detail.voice,
      body.key,
    );

    saveDocumentDialogue(detail.id, analysis);

    return NextResponse.json({
      documentId: detail.id,
      analysis,
    });
  } catch (err) {
    return toApiError(err);
  }
}

/** PUT /api/ai/dialogue — { documentId: string, characters?: CharacterVoiceAssignment[], enabled?: boolean } */
export async function PUT(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      documentId?: string;
      characters?: CharacterVoiceAssignment[];
      enabled?: boolean;
    };
    if (!body.documentId) return apiError("documentId is required.", 400);

    const detail = getDocumentDetail(body.documentId);
    if (!detail) return apiError("Document not found.", 404);

    const existing = detail.dialogueActing;
    if (!existing) {
      return apiError(
        "Dialogue has not been analyzed yet. Run detection first.",
        400,
      );
    }

    let updatedCharacters = existing.characters;
    let updatedTags = existing.tags;

    if (Array.isArray(body.characters)) {
      // Validate and update character assignments
      updatedCharacters = body.characters.map((c) => ({
        character: c.character.trim(),
        voice: VOICE_NAMES.includes(c.voice) ? c.voice : detail.voice,
        gender: c.gender,
      }));

      const voiceMap = new Map<string, string>();
      for (const c of updatedCharacters) {
        voiceMap.set(c.character, c.voice);
      }

      // Recalculate sentence voice mappings
      updatedTags = existing.tags.map((tag) => {
        const assignedVoice = voiceMap.get(tag.character);
        return {
          ...tag,
          voice: assignedVoice || tag.voice || detail.voice,
        };
      });
    }

    const updatedAnalysis: DialogueAnalysisResult = {
      characters: updatedCharacters,
      tags: updatedTags,
      enabled:
        typeof body.enabled === "boolean"
          ? body.enabled
          : existing.enabled ?? true,
    };

    saveDocumentDialogue(detail.id, updatedAnalysis);

    return NextResponse.json({
      success: true,
      documentId: detail.id,
      analysis: updatedAnalysis,
    });
  } catch (err) {
    return toApiError(err);
  }
}
