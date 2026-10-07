import { GoogleGenAI } from "@google/genai";
import { getTextModel, getTtsModel, resolveApiKey } from "./settings";
import type { AudioNoteMode, AudioTranscribeAndNoteResult } from "./types";

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

function ttsModels(): string[] {
  return [
    ...new Set([
      getTtsModel(),
      "gemini-3.1-flash-tts-preview",
      "gemini-3.8-flash-tts-preview",
      "gemini-2.5-flash-preview-tts",
    ]),
  ];
}

function textModels(): string[] {
  return [
    ...new Set([
      getTextModel(),
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.8-pro",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ]),
  ];
}

function transcribeModels(): string[] {
  return [
    "gemini-3.5-transcribe",
    "gemini-3.8-flash",
  ];
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

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model response.");
  return body.slice(start, end + 1);
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

/** Transcribe recorded speech audio with Gemini's audio understanding. */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const prompt =
    "Transcribe the speech in this audio recording exactly as spoken, in the speaker's language. " +
    "Return only the transcription text with basic sentence punctuation. " +
    "If there is no intelligible speech, reply with an empty string.";
  return tryEach(transcribeModels(), async (model) => {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: prompt },
        { inlineData: { mimeType, data: audioBase64 } },
      ],
    });
    return partsText(response);
  });
}

function normalizeAudioNotes(parsed: unknown): AudioTranscribeAndNoteResult {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid audio transcription JSON response.");
  }
  const obj = parsed as Record<string, unknown>;
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim().slice(0, 300)
      : "Audio Recording";
  const transcript = typeof obj.transcript === "string" ? obj.transcript.trim() : "";
  const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary.trim() : null;
  const notes = typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : null;
  const actionItems = Array.isArray(obj.actionItems)
    ? obj.actionItems
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const keyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];

  return {
    title,
    transcript,
    summary,
    notes,
    actionItems,
    keyPoints,
  };
}

/** Transcribe audio and generate structured notes, summary, action items and key points using Gemini. */
export async function transcribeAndNoteAudio(
  audioBase64: string,
  mimeType: string,
  mode: AudioNoteMode = "notes",
  explicitKey?: string | null,
): Promise<AudioTranscribeAndNoteResult> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });

  let modeInstruction = "Analyze this audio recording and generate structured notes.";
  if (mode === "meeting") {
    modeInstruction =
      "Analyze this audio recording as a meeting or discussion. Focus on:\n" +
      "1) Full verbatim or clean transcription of spoken content;\n" +
      "2) Executive summary of the meeting;\n" +
      "3) Structured meeting notes with topics, discussions, and decisions made (formatted with clean Markdown headings and bullet points);\n" +
      "4) Action items with clear owners/tasks if mentioned;\n" +
      "5) Key points and takeaways.";
  } else if (mode === "lecture") {
    modeInstruction =
      "Analyze this audio recording as an educational lecture, presentation, or study session. Focus on:\n" +
      "1) Full accurate transcription of the lecture;\n" +
      "2) High-level summary of the lecture;\n" +
      "3) Detailed structured study notes covering concepts, definitions, explanations, and structure (formatted with clean Markdown);\n" +
      "4) Suggested study/action items or review questions;\n" +
      "5) Key points and core takeaways.";
  } else if (mode === "transcript-only") {
    modeInstruction =
      "Transcribe this audio recording completely and accurately. Focus on:\n" +
      "1) Full accurate transcription of all speech in the recording;\n" +
      "2) A concise, descriptive title;\n" +
      "3) A brief 1-2 sentence overview in summary;\n" +
      "4) Core key points if applicable.";
  } else {
    // "notes" mode
    modeInstruction =
      "Analyze this audio recording or voice memo. Focus on:\n" +
      "1) Full accurate transcription of the recording;\n" +
      "2) A descriptive title;\n" +
      "3) A concise summary;\n" +
      "4) Comprehensive, well-structured notes (formatted with clean Markdown);\n" +
      "5) Action items or follow-ups mentioned;\n" +
      "6) Key bullet takeaways.";
  }

  const prompt =
    `${modeInstruction}\n\n` +
    "Return a valid JSON object matching the requested schema with properties:\n" +
    '- "title": concise, descriptive title for this recording (string)\n' +
    '- "transcript": full transcription of all speech in the recording (string)\n' +
    '- "summary": concise summary paragraph (string)\n' +
    '- "notes": comprehensive structured notes with markdown formatting (string)\n' +
    '- "actionItems": array of specific action items or tasks (string[])\n' +
    '- "keyPoints": array of main takeaways and key points (string[])\n\n' +
    "If no speech is audible, provide an empty transcript and explain that in the summary.";

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      transcript: { type: "string" },
      summary: { type: "string" },
      notes: { type: "string" },
      actionItems: {
        type: "array",
        items: { type: "string" },
      },
      keyPoints: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["title", "transcript", "summary", "notes", "actionItems", "keyPoints"],
  };

  const models = ["gemini-3.8-flash", "gemini-3.5-transcribe", "gemini-3.7-flash"];

  return tryEach(models, async (model) => {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: prompt },
        { inlineData: { mimeType, data: audioBase64 } },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    } as never);

    const raw = partsText(response);
    if (!raw) throw new GeminiError(`Model ${model} returned empty response.`);
    const parsed = JSON.parse(extractJsonObject(raw));
    return normalizeAudioNotes(parsed);
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

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Answer a question strictly grounded in the provided document content. */
export async function chatWithDocument(
  title: string,
  text: string,
  history: ChatHistoryMessage[],
  question: string,
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const docExcerpt = text.length > 24000 ? `${text.slice(0, 24000)}\n\n[…document truncated…]` : text;
  const historyBlock = history
    .slice(-12)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 2000)}`)
    .join("\n");
  const prompt =
    `You are a helpful reading assistant inside the VoxShelf app. Answer the user's question STRICTLY using only the document content below. ` +
    `If the answer is not in the document, say so clearly and do not invent facts. ` +
    `Keep answers concise (2-6 sentences) unless the user asks for more detail. Use plain text, no preamble headers.\n\n` +
    `Document title: "${title}"\n\n--- DOCUMENT ---\n${docExcerpt}\n--- END ---\n\n` +
    (historyBlock ? `Conversation so far:\n${historyBlock}\n\n` : "") +
    `User question: ${question}\n\nAnswer:`;
  return tryEach(textModels(), async (model) => {
    const response = await ai.models.generateContent({ model, contents: prompt });
    const out = partsText(response);
    if (!out) throw new GeminiError(`Model ${model} returned empty text.`);
    return out;
  });
}

export interface GeneratedQuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface GeneratedFlashcard {
  front: string;
  back: string;
}

export interface GeneratedQuiz {
  questions: GeneratedQuizQuestion[];
  flashcards: GeneratedFlashcard[];
}

function normalizeQuiz(parsed: unknown): GeneratedQuiz {
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid quiz JSON.");
  const obj = parsed as { questions?: unknown; flashcards?: unknown };
  if (!Array.isArray(obj.questions) || !Array.isArray(obj.flashcards)) {
    throw new Error("Quiz JSON is missing questions or flashcards.");
  }
  const questions: GeneratedQuizQuestion[] = obj.questions.slice(0, 5).map((q: unknown, i: number) => {
    const r = (q ?? {}) as { question?: unknown; options?: unknown; answerIndex?: unknown; correctIndex?: unknown; explanation?: unknown };
    const options = Array.isArray(r.options) ? r.options.map((o) => String(o)).slice(0, 4) : [];
    while (options.length < 4) options.push(`Option ${options.length + 1}`);
    const rawIdx = typeof r.answerIndex === "number" ? r.answerIndex : typeof r.correctIndex === "number" ? r.correctIndex : 0;
    return {
      question: typeof r.question === "string" && r.question.trim() ? r.question.trim() : `Question ${i + 1}`,
      options,
      answerIndex: Math.min(3, Math.max(0, Math.floor(rawIdx))),
      explanation: typeof r.explanation === "string" ? r.explanation.trim() : "",
    };
  });
  const flashcards: GeneratedFlashcard[] = obj.flashcards.slice(0, 5).map((c: unknown, i: number) => {
    const r = (c ?? {}) as { front?: unknown; back?: unknown; concept?: unknown; explanation?: unknown };
    const front = typeof r.front === "string" ? r.front : typeof r.concept === "string" ? r.concept : "";
    const back = typeof r.back === "string" ? r.back : typeof r.explanation === "string" ? r.explanation : "";
    return {
      front: front.trim() || `Concept ${i + 1}`,
      back: back.trim() || "See document.",
    };
  });
  if (questions.length === 0) throw new Error("Model returned no quiz questions.");
  return { questions, flashcards };
}

/** Generate 5 multiple-choice questions + 5 flashcards with JSON structured output. */
export async function generateQuiz(
  title: string,
  text: string,
  explicitKey?: string | null,
): Promise<GeneratedQuiz> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const docExcerpt = text.length > 20000 ? `${text.slice(0, 20000)}\n\n[…document truncated…]` : text;
  const prompt =
    `You are a study coach. Based ONLY on the document below, create a JSON object with exactly 5 multiple-choice questions ("questions", each with "question", "options" (exactly 4 strings), "answerIndex" (0-3), "explanation") ` +
    `and exactly 5 flashcards ("flashcards", each with "front" (concept) and "back" (concise explanation)). ` +
    `Questions should test key takeaways, arguments, and important details. Return ONLY valid JSON, no markdown.\n\n` +
    `Document title: "${title}"\n\n--- DOCUMENT ---\n${docExcerpt}\n--- END ---`;
  const schema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            answerIndex: { type: "integer" },
            explanation: { type: "string" },
          },
          required: ["question", "options", "answerIndex", "explanation"],
        },
      },
      flashcards: {
        type: "array",
        items: {
          type: "object",
          properties: { front: { type: "string" }, back: { type: "string" } },
          required: ["front", "back"],
        },
      },
    },
    required: ["questions", "flashcards"],
  };
  return tryEach(textModels(), async (model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: schema },
    } as never);
    const raw = partsText(response);
    if (!raw) throw new GeminiError(`Model ${model} returned empty text.`);
    return normalizeQuiz(JSON.parse(extractJsonObject(raw)) as unknown);
  });
}

export interface PodcastLine {
  speaker: "Alex" | "Sam";
  voice: "Kore" | "Puck";
  text: string;
}

export interface PodcastScript {
  title: string;
  lines: PodcastLine[];
}

/** Generate an engaging 2-host conversational podcast script from a document. */
export async function generatePodcastScript(
  title: string,
  text: string,
  explicitKey?: string | null,
): Promise<PodcastScript> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const docExcerpt = text.length > 18000 ? `${text.slice(0, 18000)}\n\n[…document truncated…]` : text;
  const prompt =
    `You are a podcast scriptwriter. Turn the document below into a fun, engaging 2-host conversational podcast script ` +
    `between Alex (knowledgeable, warm) and Sam (curious, witty). 10-16 short dialogue lines, alternating hosts, ` +
    `opening with a hook, covering the key ideas with banter, ending with a sign-off. Each line must be speakable narration ` +
    `(no stage directions, no markdown). Return ONLY valid JSON: {"title": "episode title", "lines": [{"speaker": "Alex"|"Sam", "text": "..."}]}.\n\n` +
    `Document title: "${title}"\n\n--- DOCUMENT ---\n${docExcerpt}\n--- END ---`;
  return tryEach(textModels(), async (model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: "application/json" },
    } as never);
    const raw = partsText(response);
    if (!raw) throw new GeminiError(`Model ${model} returned empty text.`);
    const parsed = JSON.parse(extractJsonObject(raw)) as {
      title?: unknown;
      lines?: Array<{ speaker?: unknown; text?: unknown }>;
    };
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      throw new Error("Model returned an empty podcast script.");
    }
    const lines: PodcastLine[] = parsed.lines.slice(0, 24).map((l, i) => {
      const speaker: "Alex" | "Sam" = l.speaker === "Sam" ? "Sam" : l.speaker === "Alex" ? "Alex" : i % 2 === 0 ? "Alex" : "Sam";
      return {
        speaker,
        voice: (speaker === "Alex" ? "Kore" : "Puck") as "Kore" | "Puck",
        text: typeof l.text === "string" ? l.text.trim().slice(0, 950) : "",
      };
    }).filter((l) => l.text.length > 0);
    if (lines.length === 0) throw new Error("Model returned an empty podcast script.");
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 160) : `Podcast: ${title}`.slice(0, 160),
      lines,
    };
  });
}

/** Cleanup for voice-dictated text: punctuation, capitalization, filler words. */
export async function cleanupDictation(
  text: string,
  explicitKey?: string | null,
): Promise<string> {
  const apiKey = requireKey(explicitKey);
  const ai = new GoogleGenAI({ apiKey });
  const prompt =
    "Clean up the following voice-dictated text for reading and text-to-speech. " +
    "Fix punctuation and capitalization, split run-on sentences, remove filler words (um, uh, like, you know, basically, actually) " +
    "where they add no meaning, but preserve the speaker's words and meaning. " +
    "Do not summarize, reorder, or add commentary. Return only the cleaned text.\n\n---\n" +
    text.slice(0, 12000);
  return tryEach(textModels(), async (model) => {
    const response = await ai.models.generateContent({ model, contents: prompt });
    return partsText(response) || text;
  });
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
