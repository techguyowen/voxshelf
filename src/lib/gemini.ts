import { GoogleGenAI } from "@google/genai";
import { getTextModel, getTtsModel, resolveApiKey } from "./settings";

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

function ttsModels(): string[] {
  return [...new Set([getTtsModel(), "gemini-2.5-flash-preview-tts"])];
}

function textModels(): string[] {
  return [...new Set([getTextModel(), "gemini-2.5-flash", "gemini-1.5-flash"])];
}

function requireKey(explicit?: string | null): string {
  const key = resolveApiKey(explicit);
  if (!key) {
    throw new GeminiError(
      "Gemini API key is not configured. Add one in Settings or set GEMINI_API_KEY.",
      401,
    );
  }
  return key;
}

function partsText(response: { text?: string | null }): string {
  return (response.text ?? "").trim();
}

async function tryEach<T>(
  models: string[],
  attempt: (model: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (const model of models) {
    try {
      return await attempt(model);
    } catch (err) {
      lastError = err;
      // Don't fall through on auth errors — every model would fail the same way.
      const msg = err instanceof Error ? err.message : String(err);
      if (/api key|unauthenticated|permission denied|403|401/i.test(msg)) break;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini request failed");
}

export interface SynthesizedSpeech {
  pcm: Buffer;
  mimeType: string;
}

/**
 * Synthesize speech with Gemini TTS. Returns raw PCM16 bytes (see mimeType for
 * the sample rate, e.g. "audio/L16;codec=pcm;rate=24000").
 */
export async function synthesizeSpeech(
  text: string,
  voice: string,
  stylePrompt: string | undefined,
  explicitKey?: string | null,
): Promise<SynthesizedSpeech> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const params = (model: string) => ({
    model,
    contents: text,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
      ...(stylePrompt?.trim()
        ? {
            systemInstruction:
              `You are a professional audiobook narrator. Narrate with this style: ${stylePrompt.trim()}. ` +
              "Read only the provided text aloud; never add commentary, introductions, or explanations.",
          }
        : {}),
    },
  });
  // Cast shields us from SDK enum-shape drift across @google/genai versions.
  return tryEach(ttsModels(), async (model) => {
    const response = await ai.models.generateContent(
      params(model) as never,
    );
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.map((p) => p.inlineData).find((d) => d?.data);
    if (!inline?.data) {
      throw new GeminiError(
        `Model ${model} returned no audio. Try another voice or check your API key.`,
      );
    }
    return {
      pcm: Buffer.from(inline.data, "base64"),
      mimeType: inline.mimeType ?? "audio/L16;codec=pcm;rate=24000",
    };
  });
}

export async function generateText(
  prompt: string,
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  return tryEach(textModels(), async (model) => {
    const response = await ai.models.generateContent({ model, contents: prompt });
    const text = partsText(response);
    if (!text) throw new GeminiError(`Model ${model} returned empty text.`);
    return text;
  });
}

/** OCR / transcription of an image with Gemini's vision understanding. */
export async function transcribeImage(
  imageBase64: string,
  mimeType: string,
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const prompt =
    "Transcribe all readable text in this image exactly as it appears. " +
    "Preserve paragraph breaks and reading order. " +
    "Fix obvious scan artifacts (broken words across lines) but do not summarize, translate, or add commentary. " +
    "If there is no readable text, reply with an empty string.";
  return tryEach(textModels(), async (model) => {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: prompt },
        { inlineData: { mimeType, data: imageBase64 } },
      ],
    });
    return partsText(response);
  });
}

function splitForCleanup(text: string, maxChars = 12000): string[] {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paras) {
    if ((current + "\n\n" + p).length <= maxChars) {
      current = current ? `${current}\n\n${p}` : p;
    } else {
      if (current) chunks.push(current);
      current = p.length > maxChars ? p.slice(0, maxChars) : p;
      if (p.length > maxChars) {
        chunks.push(current);
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** AI cleanup for OCR / extraction artifacts: joins hyphenated words, fixes spacing. */
export async function cleanupText(
  text: string,
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const chunks = splitForCleanup(text);
  const cleaned: string[] = [];
  for (const chunk of chunks) {
    const prompt =
      "Clean up the following extracted text for text-to-speech reading. " +
      "Join words broken across line breaks, remove OCR junk characters, normalize whitespace, " +
      "and fix obvious punctuation spacing. Do not summarize, translate, reorder, or add any commentary. " +
      "Return only the cleaned text.\n\n---\n" +
      chunk;
    const out = await tryEach(textModels(), async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return partsText(response);
    });
    cleaned.push(out || chunk);
  }
  return cleaned.join("\n\n").trim();
}

export async function summarizeDocument(
  title: string,
  text: string,
  length: "short" | "detailed" = "short",
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const ask = async (prompt: string): Promise<string> =>
    tryEach(textModels(), async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      const out = partsText(response);
      if (!out) throw new GeminiError(`Model ${model} returned empty text.`);
      return out;
    });

  // Map-reduce for long documents.
  if (text.length > 16000) {
    const chunks = splitForCleanup(text, 14000);
    const partials: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      partials.push(
        await ask(
          `Summarize part ${i + 1} of ${chunks.length} of the document "${title}" in a few sentences. Return only the summary.\n\n---\n${chunks[i]}`,
        ),
      );
    }
    return ask(
      `Combine these part-summaries of "${title}" into one coherent ${length === "short" ? "concise (~150 words)" : "detailed (~400 words)"} summary with the key points. Use plain paragraphs${length === "detailed" ? ", and short bullet lists where helpful" : ""}.\n\n---\n${partials.join("\n\n")}`,
    );
  }
  return ask(
    `Summarize the document "${title}" in a ${length === "short" ? "concise (~150 words)" : "detailed (~400 words, bullets welcome)"} summary capturing the key points. Use plain paragraphs, no preamble.\n\n---\n${text}`,
  );
}

export async function explainSelection(
  selection: string,
  context: string,
  explicitKey?: string | null,
): Promise<string> {
  const prompt =
    "You are a friendly vocabulary tutor inside a reading app. " +
    "Explain the selected word or phrase clearly and briefly (2-5 sentences): what it means in this context, " +
    "plus a simple definition. If it is a name or term, give one line of background. No preamble, no headers.\n\n" +
    `Selected: "${selection}"\n` +
    (context ? `Surrounding text: "${context.slice(0, 1200)}"` : "");
  return generateText(prompt, explicitKey);
}
