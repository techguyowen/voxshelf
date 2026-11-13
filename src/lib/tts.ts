import {
  audioKey,
  concatWavs,
  parseSampleRateFromMime,
  pcmToWav,
  wavDurationMs,
} from "./audio";
import { getCachedAudio, saveCachedAudio } from "./audioCache";
import { synthesizeSpeech } from "./gemini";
import {
  detectLocalTtsCapabilities,
  isLocalTtsAvailable,
  listLocalVoices,
  mapCloudVoiceToLocal,
  parseLocalVoiceId,
  synthesizeLocalSpeech,
} from "./localTts";
import {
  applyPronunciationRules,
  loadPronunciationRulesCached,
} from "./pronunciation";
import { getDefaultVoice, getTtsModel, resolveApiKey } from "./settings";
import { chunkForTts } from "./text";
import {
  DEFAULT_VOICE,
  DEVICE_VOICE_PREFIX,
  isDeviceVoiceValue,
  isLocalVoiceValue,
  isValidVoice,
  VOICE_NAMES,
} from "./voices";

export interface TtsResult {
  hash: string;
  durationMs: number;
  chars: number;
  chunks: number;
  cached: boolean;
  voice: string;
  engine?: string;
  free?: boolean;
}

const MAX_CHARS = 20_000;

async function resolveAutoVoice(preferredEngine?: string): Promise<string> {
  const caps = await detectLocalTtsCapabilities();
  const engine =
    preferredEngine && preferredEngine !== "auto" && caps.engines.includes(preferredEngine)
      ? preferredEngine
      : caps.engine;
  if (!engine) return "local:auto";
  const voices = await listLocalVoices();
  const match = voices.find((x) => x.engine === engine && x.id && x.id !== "local:auto");
  return match?.id ?? "local:auto";
}

export async function synthesizeAndCache(
  text: string,
  voice?: string,
  stylePrompt?: string,
  explicitKey?: string | null,
  speed = 1,
): Promise<TtsResult> {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) throw new Error("Nothing to speak.");
  const clean = applyPronunciationRules(raw, loadPronunciationRulesCached());
  if (clean.length > MAX_CHARS) {
    throw new Error(`Text is too long for one request (max ${MAX_CHARS.toLocaleString()} characters).`);
  }
  const rawVoice = voice && isValidVoice(voice) ? voice : getDefaultVoice();
  const deviceName = isDeviceVoiceValue(rawVoice)
    ? rawVoice.slice(DEVICE_VOICE_PREFIX.length).trim()
    : null;
  const v = deviceName !== null ? DEFAULT_VOICE : rawVoice;
  const style = stylePrompt?.trim() || "";
  const ttsModel = getTtsModel();
  const rawPreferredEngine = ttsModel.startsWith("local:")
    ? parseLocalVoiceId(ttsModel)?.engine
    : undefined;
  const preferredEngine =
    rawPreferredEngine && rawPreferredEngine !== "auto"
      ? rawPreferredEngine
      : undefined;
  const useLocal =
    isLocalVoiceValue(rawVoice) ||
    ttsModel.startsWith("local:") ||
    (!resolveApiKey(explicitKey) && (await isLocalTtsAvailable().catch(() => false)));

  if (useLocal) {
    let resolvedVoice: string;
    if (isLocalVoiceValue(rawVoice)) {
      const parsed = parseLocalVoiceId(rawVoice);
      const caps = await detectLocalTtsCapabilities();
      if (!parsed || parsed.engine === "auto" || !caps.engines.includes(parsed.engine)) {
        resolvedVoice = parsed?.voiceName
          ? await mapCloudVoiceToLocal(parsed.voiceName, preferredEngine)
          : await resolveAutoVoice(preferredEngine);
      } else {
        resolvedVoice = rawVoice;
      }
    } else if (deviceName) {
      resolvedVoice = await mapCloudVoiceToLocal(deviceName, preferredEngine);
    } else if (VOICE_NAMES.includes(rawVoice)) {
      resolvedVoice = await mapCloudVoiceToLocal(rawVoice, preferredEngine);
    } else {
      resolvedVoice = await resolveAutoVoice(preferredEngine);
    }
    if (resolvedVoice === "local:auto") resolvedVoice = await resolveAutoVoice(preferredEngine);
    const hash = audioKey(clean, resolvedVoice, style);
    const cached = getCachedAudio(hash);
    if (cached) {
      return { hash, durationMs: cached.durationMs, chars: clean.length, chunks: 1, cached: true, voice: resolvedVoice, engine: resolvedVoice.split(":")[1], free: true };
    }
    const chunks = chunkForTts(clean);
    const wavs: Buffer[] = [];
    let engine: string | undefined;
    let concreteVoice = resolvedVoice;
    for (const chunk of chunks) {
      const out = await synthesizeLocalSpeech(chunk, concreteVoice, speed);
      wavs.push(out.wav);
      engine = out.engine;
      concreteVoice = out.voice;
    }
    if (concreteVoice !== resolvedVoice) {
      const hash2 = audioKey(clean, concreteVoice, style);
      const cached2 = getCachedAudio(hash2);
      if (cached2) return { hash: hash2, durationMs: cached2.durationMs, chars: clean.length, chunks: 1, cached: true, voice: concreteVoice, engine, free: true };
      const wav = concatWavs(wavs);
      const saved = saveCachedAudio({ hash: hash2, voice: concreteVoice, stylePrompt: style, textPreview: clean, chars: clean.length, wav, durationMs: wavDurationMs(wav) });
      return { hash: hash2, durationMs: saved.durationMs, chars: clean.length, chunks: chunks.length, cached: false, voice: concreteVoice, engine, free: true };
    }
    const wav = concatWavs(wavs);
    const saved = saveCachedAudio({ hash, voice: concreteVoice, stylePrompt: style, textPreview: clean, chars: clean.length, wav, durationMs: wavDurationMs(wav) });
    return { hash, durationMs: saved.durationMs, chars: clean.length, chunks: chunks.length, cached: false, voice: concreteVoice, engine, free: true };
  }

  const hash = audioKey(clean, v, style);
  const cached = getCachedAudio(hash);
  if (cached) {
    return { hash, durationMs: cached.durationMs, chars: clean.length, chunks: 1, cached: true, voice: v, engine: "gemini", free: false };
  }
  const chunks = chunkForTts(clean);
  const wavs: Buffer[] = [];
  for (const chunk of chunks) {
    const { pcm, mimeType } = await synthesizeSpeech(chunk, v, style || undefined, explicitKey);
    wavs.push(pcmToWav(pcm, parseSampleRateFromMime(mimeType)));
  }
  const wav = concatWavs(wavs);
  const saved = saveCachedAudio({ hash, voice: v, stylePrompt: style, textPreview: clean, chars: clean.length, wav, durationMs: wavDurationMs(wav) });
  return { hash, durationMs: saved.durationMs, chars: clean.length, chunks: chunks.length, cached: false, voice: v, engine: "gemini", free: false };
}
