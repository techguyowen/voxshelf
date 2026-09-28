import { createWorker } from "tesseract.js";
import { transcribeImage } from "../gemini";
import { resolveApiKey } from "../settings";
import type { OcrResult } from "../types";

export type OcrMode = "auto" | "local" | "ai";

export async function runLocalOcr(
  image: Buffer,
): Promise<{ text: string; confidence: number | null }> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(image);
    return {
      text: (data.text ?? "").trim(),
      confidence: typeof data.confidence === "number" ? data.confidence : null,
    };
  } finally {
    await worker.terminate();
  }
}

/**
 * OCR an image. "auto" uses Gemini Vision when an API key is configured
 * (much better quality) and falls back to on-device Tesseract otherwise.
 */
export async function runOcr(
  image: Buffer,
  mimeType: string,
  mode: OcrMode = "auto",
  explicitKey?: string | null,
): Promise<OcrResult> {
  const key = resolveApiKey(explicitKey);
  if (mode === "local" || (mode === "auto" && !key)) {
    const local = await runLocalOcr(image);
    return { text: local.text, engine: "tesseract", confidence: local.confidence };
  }
  if (!key) {
    throw new Error(
      "AI OCR needs a Gemini API key. Add one in Settings or use local OCR mode.",
    );
  }
  const text = await transcribeImage(image.toString("base64"), mimeType, key);
  return { text: text.trim(), engine: "ai-vision", confidence: null };
}
