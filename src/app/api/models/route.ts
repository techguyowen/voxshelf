import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "@/lib/auth";
import { toApiError } from "@/lib/http";
import { discoverLocalAiServers } from "@/lib/localAi";
import { detectLocalTtsCapabilities } from "@/lib/localTts";
import { getLocalLlmUrl, getLocalTtsUrl, getOllamaUrl, resolveApiKey } from "@/lib/settings";
import type { ModelInfo, ModelsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECOMMENDED_TTS = "gemini-3.1-flash-tts-preview";
const RECOMMENDED_TEXT = "gemini-3.8-flash";

const TTS_PRESETS: ModelInfo[] = [
  {
    id: "gemini-3.1-flash-tts-preview",
    name: "Gemini 3.1 Flash TTS",
    description: "Recommended TTS model — fast, natural narration voices with promptable tone.",
    isRecommended: true,
    category: "tts",
    speed: "fast",
  },
  {
    id: "gemini-3.8-flash-tts-preview",
    name: "Gemini 3.8 Flash TTS Preview",
    description: "Latest 3.8 generation Flash TTS preview model.",
    category: "tts",
    speed: "fast",
  },
  {
    id: "gemini-2.5-flash-preview-tts",
    name: "Gemini 2.5 Flash TTS",
    description: "Proven TTS fallback with the full 30-voice lineup.",
    category: "tts",
    speed: "fast",
  },
];

const TEXT_PRESETS: ModelInfo[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Flagship 3.8 Flash model — ultra-fast intelligence, OCR, long-horizon text and agentic tasks.",
    isRecommended: true,
    category: "text",
    speed: "fast",
  },
  {
    id: "gemini-3.8-pro",
    name: "Gemini 3.8 Pro",
    description: "High intelligence 3.8 Pro — deep reasoning and advanced analysis.",
    category: "text",
    speed: "standard",
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    description: "High performance 3.7 Flash model.",
    category: "text",
    speed: "fast",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Fast all-rounder for summaries, chat, vision OCR and cleanup.",
    category: "text",
    speed: "fast",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "High intelligence for long documents and complex quizzes.",
    category: "text",
    speed: "standard",
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    description: "Mature fast model with a large context window.",
    category: "text",
    speed: "fast",
  },
];

async function localModels(hasKey: boolean): Promise<{ tts: ModelInfo[]; text: ModelInfo[]; localStatus: NonNullable<ModelsResponse["localStatus"]> }> {
  const [ai, ttsCaps] = await Promise.all([
    discoverLocalAiServers().catch(() => null),
    detectLocalTtsCapabilities().catch(() => null),
  ]);
  const text: ModelInfo[] = [
    { id: "builtin:voxshelf-nlp", name: "VoxShelf Built-in NLP (Free, Offline)", description: "Zero-dependency offline NLP: summaries, chat, quizzes, podcasts and dialogue without any API key.", category: "text", provider: "builtin", free: true, ...(!hasKey ? { isRecommended: true } : {}) },
  ];
  if (ai) {
    for (const m of ai.ollamaModels) text.push({ id: m.id, name: `Ollama: ${m.name}`, description: "Free local Ollama model.", category: "text", provider: "ollama", free: true });
    // When Ollama is present and no key, prefer it as recommended over builtin.
    if (!hasKey && ai.ollamaModels.length) {
      text[0] = { ...text[0], isRecommended: false };
      text[1] = { ...text[1], isRecommended: true };
    }
    for (const m of ai.localLlmModels) text.push({ id: m.id, name: `Local: ${m.name}`, description: "Free local OpenAI-compatible model.", category: "text", provider: "local-openai", free: true });
  }
  const tts: ModelInfo[] = [
    { id: "local:auto", name: "Local TTS Auto (Free)", description: "Picks the best available free local TTS engine.", category: "tts", provider: "local-tts", free: true },
  ];
  if (ttsCaps?.engine) {
    const engineId = ttsCaps.engine === "kokoro-http" ? "local:kokoro" : `local:${ttsCaps.engine}`;
    const label = ttsCaps.engine === "kokoro-http" ? "Kokoro (Local)" : ttsCaps.engine === "say" ? "macOS Say (Local)" : ttsCaps.engine === "piper" ? "Piper (Local)" : ttsCaps.engine === "espeak" ? "eSpeak (Local)" : "Windows SAPI (Local)";
    tts.push({ id: engineId, name: label, description: "Free local TTS engine.", category: "tts", provider: "local-tts", free: true });
  }
  return {
    tts,
    text,
    localStatus: {
      ollamaOnline: Boolean(ai?.ollamaOnline),
      ollamaUrl: ai?.ollamaUrl ?? getOllamaUrl(),
      localLlmOnline: Boolean(ai?.localLlmOnline),
      localLlmUrl: ai?.localLlmUrl ?? getLocalLlmUrl(),
      localTtsEngine: ttsCaps?.engine ?? null,
      localTtsUrl: getLocalTtsUrl(),
    },
  };
}

function curatedFallback(error?: string, local?: { tts: ModelInfo[]; text: ModelInfo[]; localStatus: NonNullable<ModelsResponse["localStatus"]> }): ModelsResponse {
  return {
    ttsModels: [...(local?.tts ?? []), ...TTS_PRESETS],
    textModels: [...(local?.text ?? []), ...TEXT_PRESETS],
    live: false,
    ...(error ? { error } : {}),
    ...(local ? { localStatus: local.localStatus } : {}),
  };
}

/** The SDK's Model type omits some REST fields, so read them defensively. */
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function prettifyId(id: string): string {
  return id
    .replace(/^models\//, "")
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

interface LiveModel {
  id: string;
  name: string;
  description?: string;
  methods: string[];
  outputModalities: string[];
}

async function fetchLiveModels(apiKey: string): Promise<LiveModel[]> {
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 1000 } });
  const out: LiveModel[] = [];
  for await (const m of pager) {
    const rec = m as unknown as Record<string, unknown>;
    const rawName = typeof rec.name === "string" ? rec.name : "";
    const id = rawName.replace(/^models\//, "").trim();
    if (!id) continue;
    out.push({
      id,
      name:
        typeof rec.displayName === "string" && rec.displayName.trim()
          ? rec.displayName.trim()
          : prettifyId(id),
      description:
        typeof rec.description === "string" && rec.description.trim()
          ? rec.description.trim()
          : undefined,
      methods: [
        ...stringList(rec.supportedActions),
        ...stringList(rec.supportedGenerationMethods),
      ].map((s) => s.toLowerCase()),
      outputModalities: stringList(rec.outputModalities).map((s) =>
        s.toLowerCase(),
      ),
    });
    // Bound latency / payload size on accounts with many tuned models.
    if (out.length >= 300) break;
  }
  return out;
}

function isTtsModel(m: LiveModel): boolean {
  if (/tts/i.test(m.id)) return true;
  if (m.outputModalities.includes("audio")) return true;
  return (
    m.methods.includes("speak") ||
    m.methods.includes("generateaudio") ||
    m.methods.includes("generate_audio")
  );
}

function supportsGeneration(m: LiveModel): boolean {
  // Embedding-only models are useless for chat/summary duty.
  if (/embed/i.test(m.id) && !m.methods.includes("generatecontent")) {
    return false;
  }
  if (/^lyria/i.test(m.id)) return false; // music generation, not text
  if (m.methods.length === 0) return true; // field absent — don't drop it
  return m.methods.includes("generatecontent");
}

function speedOf(id: string): "fast" | "standard" {
  return /flash|lite/i.test(id) ? "fast" : "standard";
}

function sortModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    if (Boolean(a.isRecommended) !== Boolean(b.isRecommended)) {
      return a.isRecommended ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

/** Merge live results with known presets so recommended models never vanish. */
function mergeWithPresets(
  live: ModelInfo[],
  presets: ModelInfo[],
  recommendedId: string,
): ModelInfo[] {
  const byId = new Map<string, ModelInfo>();
  for (const m of live) {
    byId.set(m.id, {
      ...m,
      isRecommended: m.id === recommendedId ? true : m.isRecommended,
    });
  }
  for (const p of presets) {
    const existing = byId.get(p.id);
    if (existing) {
      byId.set(p.id, {
        ...existing,
        isRecommended: p.isRecommended ?? existing.isRecommended,
        description: existing.description ?? p.description,
        name: existing.name,
      });
    } else {
      byId.set(p.id, p);
    }
  }
  return sortModels([...byId.values()]);
}

/**
 * GET /api/models — categorized Gemini models.
 * Optional `?key=` query param overrides the stored / env API key for the
 * live `ai.models.list()` lookup. Always returns curated defaults when no
 * key is available or the live call fails, so the UI stays populated.
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const explicitKey = req.nextUrl.searchParams.get("key");
    const apiKey = resolveApiKey(explicitKey);
    const local = await localModels(Boolean(apiKey));
    if (!apiKey) {
      return NextResponse.json(curatedFallback(undefined, local));
    }
    let live: LiveModel[];
    try {
      live = await fetchLiveModels(apiKey);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Live model lookup failed.";
      return NextResponse.json(curatedFallback(msg, local));
    }
    if (live.length === 0) {
      return NextResponse.json(
        curatedFallback("The API returned no models.", local),
      );
    }
    const ttsLive: ModelInfo[] = live
      .filter(isTtsModel)
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        category: "tts" as const,
        speed: speedOf(m.id),
      }));
    const textLive: ModelInfo[] = live
      .filter(supportsGeneration)
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        category: (/image|vision/i.test(m.id) ? "vision" : "text") as
          | "text"
          | "vision",
        speed: speedOf(m.id),
      }));
    return NextResponse.json({
      ttsModels: [...local.tts, ...mergeWithPresets(ttsLive, TTS_PRESETS, RECOMMENDED_TTS)],
      textModels: [...local.text, ...mergeWithPresets(textLive, TEXT_PRESETS, RECOMMENDED_TEXT)],
      live: true,
      localStatus: local.localStatus,
    } satisfies ModelsResponse);
  } catch (err) {
    return toApiError(err);
  }
}
