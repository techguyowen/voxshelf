import { createHash } from "crypto";
import { AUDIO_DIR } from "./paths";
import path from "path";

export function audioKey(text: string, voice: string, style: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: 2, text, voice, style: style || "" }))
    .digest("hex");
}

export function audioFilePath(hash: string): string {
  return path.join(AUDIO_DIR, `${hash}.wav`);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSize: number;
  headerSize: number;
}

export function parseWavHeader(wav: Buffer): WavInfo | null {
  if (wav.length < 44) return null;
  if (wav.toString("ascii", 0, 4) !== "RIFF") return null;
  if (wav.toString("ascii", 8, 12) !== "WAVE") return null;
  // Walk chunks to find "fmt " and "data" (robust to extra chunks).
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;
  let dataOffset = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = wav.readUInt16LE(offset + 10);
      sampleRate = wav.readUInt32LE(offset + 12);
      bitsPerSample = wav.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataSize = size;
      dataOffset = offset + 8;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!sampleRate || !dataOffset) return null;
  return {
    sampleRate,
    channels: channels || 1,
    bitsPerSample: bitsPerSample || 16,
    dataSize,
    headerSize: dataOffset,
  };
}

export function wavDurationMs(wav: Buffer): number {
  const info = parseWavHeader(wav);
  if (!info) {
    // Fallback: assume 24kHz 16-bit mono.
    return Math.round((wav.length / (24000 * 2)) * 1000);
  }
  const bytesPerSecond =
    (info.sampleRate * info.channels * info.bitsPerSample) / 8;
  if (!bytesPerSecond) return 0;
  return Math.round((info.dataSize / bytesPerSecond) * 1000);
}

/**
 * Smooth PCM16 audio:
 * 1. Extracts raw PCM if input was already wrapped in a WAV container.
 * 2. Enforces 16-bit 2-byte alignment.
 * 3. Applies a smooth micro fade-in (5ms) and fade-out (25ms) window to
 *    eliminate clicks, pops, DC offset snaps, and quantization static at the end.
 */
export function smoothPcm16(rawInput: Buffer, sampleRate: number): Buffer {
  let pcm = rawInput;
  // If Gemini already returned a RIFF WAV container, extract the pure PCM payload
  if (pcm.length >= 44 && pcm.toString("ascii", 0, 4) === "RIFF") {
    const info = parseWavHeader(pcm);
    if (info) {
      pcm = pcm.subarray(info.headerSize, info.headerSize + info.dataSize);
    }
  }

  // Ensure 16-bit boundary alignment
  const alignedLen = pcm.length - (pcm.length % 2);
  if (alignedLen < 4) return Buffer.alloc(0);
  const out = Buffer.from(pcm.subarray(0, alignedLen));
  const totalSamples = alignedLen / 2;

  // Micro fade-in (5ms) to prevent boundary click
  const fadeInSamples = Math.min(
    Math.floor(totalSamples / 4),
    Math.round(sampleRate * 0.005),
  );
  for (let i = 0; i < fadeInSamples; i++) {
    const offset = i * 2;
    const sample = out.readInt16LE(offset);
    const factor = Math.sin((i / fadeInSamples) * (Math.PI / 2));
    out.writeInt16LE(Math.round(sample * factor), offset);
  }

  // Smooth fade-out (25ms) to eliminate static / pop / DC drop at sentence end
  const fadeOutSamples = Math.min(
    Math.floor(totalSamples / 2),
    Math.round(sampleRate * 0.025),
  );
  for (let i = 0; i < fadeOutSamples; i++) {
    const sampleIdx = totalSamples - fadeOutSamples + i;
    const offset = sampleIdx * 2;
    const sample = out.readInt16LE(offset);
    const factor = Math.cos((i / fadeOutSamples) * (Math.PI / 2));
    out.writeInt16LE(Math.round(sample * factor), offset);
  }

  return out;
}

/** Wrap raw PCM16 mono audio in a WAV container with smoothing. */
export function pcmToWav(
  pcmInput: Buffer,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const pcm = smoothPcm16(pcmInput, sampleRate);
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Concatenate same-format WAV buffers into a single WAV. */
export function concatWavs(wavs: Buffer[]): Buffer {
  if (wavs.length === 0) throw new Error("Nothing to concatenate");
  if (wavs.length === 1) return wavs[0];
  const first = parseWavHeader(wavs[0]);
  if (!first) throw new Error("Invalid WAV data");
  const pcmParts: Buffer[] = [];
  for (const wav of wavs) {
    const info = parseWavHeader(wav);
    if (!info) throw new Error("Invalid WAV data in batch");
    pcmParts.push(wav.subarray(info.headerSize, info.headerSize + info.dataSize));
  }
  const pcm = Buffer.concat(pcmParts);
  return pcmToWav(pcm, first.sampleRate, first.channels, first.bitsPerSample);
}

export function parseSampleRateFromMime(mimeType: string | undefined): number {
  if (!mimeType) return 24000;
  const m = /rate=(\d+)/i.exec(mimeType);
  const rate = m ? Number(m[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : 24000;
}
