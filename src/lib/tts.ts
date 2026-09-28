import {
  audioKey,
  concatWavs,
  parseSampleRateFromMime,
  pcmToWav,
  wavDurationMs,
} from "./audio";
import { getCachedAudio, saveCachedAudio } from "./audioCache";
import { synthesizeSpeech } from "./gemini";
import { getDefaultVoice } from "./settings";
import { chunkForTts } from "./text";
import { isValidVoice } from "./voices";

export interface TtsResult {
  hash: string;
  durationMs: number;
  chars: number;
  chunks: number;
  cached: boolean;
  voice: string;
}

const MAX_CHARS = 20_000;

/**
 * Synthesize text to a cached WAV file. Long input is chunked into multiple
 * Gemini TTS calls and stitched into a single cached file. The cache key is a
 * deterministic hash of (text, voice, style), so repeated plays never
 * re-synthesize.
 */
export async function synthesizeAndCache(
  text: string,
  voice?: string,
  stylePrompt?: string,
  explicitKey?: string | null,
): Promise<TtsResult> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Nothing to speak.");
  if (clean.length > MAX_CHARS) {
    throw new Error(
      `Text is too long for one request (max ${MAX_CHARS.toLocaleString()} characters).`,
    );
  }
  const v = voice && isValidVoice(voice) ? voice : getDefaultVoice();
  const style = stylePrompt?.trim() || "";
  const hash = audioKey(clean, v, style);

  const cached = getCachedAudio(hash);
  if (cached) {
    return {
      hash,
      durationMs: cached.durationMs,
      chars: clean.length,
      chunks: 1,
      cached: true,
      voice: v,
    };
  }

  const chunks = chunkForTts(clean);
  const wavs: Buffer[] = [];
  for (const chunk of chunks) {
    const { pcm, mimeType } = await synthesizeSpeech(
      chunk,
      v,
      style || undefined,
      explicitKey,
    );
    wavs.push(pcmToWav(pcm, parseSampleRateFromMime(mimeType)));
  }
  const wav = concatWavs(wavs);
  const saved = saveCachedAudio({
    hash,
    voice: v,
    stylePrompt: style,
    textPreview: clean,
    chars: clean.length,
    wav,
    durationMs: wavDurationMs(wav),
  });
  return {
    hash,
    durationMs: saved.durationMs,
    chars: clean.length,
    chunks: chunks.length,
    cached: false,
    voice: v,
  };
}
