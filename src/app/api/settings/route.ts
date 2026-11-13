import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toApiError } from "@/lib/http";
import { clearLocalAiCache } from "@/lib/localAi";
import { clearLocalTtsCache } from "@/lib/localTts";
import {
  DEFAULT_LOCAL_LLM_URL,
  DEFAULT_LOCAL_TTS_URL,
  DEFAULT_OLLAMA_URL,
  getPublicSettings,
  setSetting,
  validateLocalUrl,
} from "@/lib/settings";
import { isValidVoice } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings — public settings (never includes the API key). */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json(getPublicSettings());
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * PUT /api/settings — { geminiApiKey?, defaultVoice?, defaultSpeed?,
 * ttsModel?, textModel? }. Empty-string geminiApiKey clears the stored key.
 */
export async function PUT(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      geminiApiKey?: string;
      defaultVoice?: string;
      defaultSpeed?: number;
      ttsModel?: string;
      textModel?: string;
      ollamaUrl?: string;
      localLlmUrl?: string;
      localTtsUrl?: string;
    };
    if (body.geminiApiKey !== undefined) {
      setSetting("gemini_api_key", body.geminiApiKey.trim());
    }
    if (body.defaultVoice !== undefined && isValidVoice(body.defaultVoice)) {
      setSetting("default_voice", body.defaultVoice);
    }
    if (body.defaultSpeed !== undefined && Number.isFinite(body.defaultSpeed)) {
      setSetting(
        "default_speed",
        String(Math.min(4.5, Math.max(0.5, body.defaultSpeed))),
      );
    }
    if (body.ttsModel !== undefined) {
      setSetting("tts_model", body.ttsModel.trim().slice(0, 120));
    }
    if (body.textModel !== undefined) {
      setSetting("text_model", body.textModel.trim().slice(0, 120));
    }
    if (body.ollamaUrl !== undefined) {
      const v = typeof body.ollamaUrl === "string" ? body.ollamaUrl.trim() : "";
      setSetting("ollama_url", v ? validateLocalUrl(v, DEFAULT_OLLAMA_URL) : "");
    }
    if (body.localLlmUrl !== undefined) {
      const v = typeof body.localLlmUrl === "string" ? body.localLlmUrl.trim() : "";
      setSetting("local_llm_url", v ? validateLocalUrl(v, DEFAULT_LOCAL_LLM_URL) : "");
    }
    if (body.localTtsUrl !== undefined) {
      const v = typeof body.localTtsUrl === "string" ? body.localTtsUrl.trim() : "";
      setSetting("local_tts_url", v ? validateLocalUrl(v, DEFAULT_LOCAL_TTS_URL) : "");
    }
    clearLocalAiCache();
    clearLocalTtsCache();
    return NextResponse.json(getPublicSettings());
  } catch (err) {
    return toApiError(err);
  }
}
