export const TARGET_SAMPLE_RATE = 24000;
export const TARGET_CHANNELS = 1;
export const TARGET_BITS = 16;

interface ParsedWav {
  audioFormat: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
}

function parseWav(input: Buffer): ParsedWav | null {
  if (input.length < 44) return null;
  if (input.toString("ascii", 0, 4) !== "RIFF") return null;
  if (input.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let audioFormat = 1;
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let data: Buffer | null = null;
  while (offset + 8 <= input.length) {
    const id = input.toString("ascii", offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (id === "fmt ") {
      if (size >= 16 && chunkStart + 16 <= input.length) {
        audioFormat = input.readUInt16LE(chunkStart);
        channels = input.readUInt16LE(chunkStart + 2) || 1;
        sampleRate = input.readUInt32LE(chunkStart + 4);
        bitsPerSample = input.readUInt16LE(chunkStart + 14) || 16;
      }
    } else if (id === "data") {
      data = input.subarray(chunkStart, Math.min(input.length, chunkStart + size));
      break;
    }
    if (size < 0) break;
    offset += 8 + size + (size % 2);
  }
  if (!sampleRate || !data) return null;
  return { audioFormat, sampleRate, channels, bitsPerSample, data };
}

function wrapPcm16Mono(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function decodeToMonoFloat(parsed: ParsedWav): Float32Array {
  const { audioFormat, channels, bitsPerSample, data } = parsed;
  const ch = Math.max(1, channels);
  let bytesPerSample: number;
  if (audioFormat === 3) bytesPerSample = 4;
  else if (bitsPerSample === 8) bytesPerSample = 1;
  else if (bitsPerSample === 16) bytesPerSample = 2;
  else if (bitsPerSample === 24) bytesPerSample = 3;
  else if (bitsPerSample === 32) bytesPerSample = 4;
  else bytesPerSample = 2;
  const frameSize = bytesPerSample * ch;
  const frames = Math.floor(data.length / frameSize);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) {
      const off = f * frameSize + c * bytesPerSample;
      let v = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        v = data.readFloatLE(off);
      } else if (bitsPerSample === 8) {
        v = (data[off] - 128) / 128;
      } else if (bitsPerSample === 16) {
        v = data.readInt16LE(off) / 32768;
      } else if (bitsPerSample === 24) {
        let n = data[off] | (data[off + 1] << 8) | (data[off + 2] << 16);
        if (n & 0x800000) n -= 0x1000000;
        v = n / 8388608;
      } else if (bitsPerSample === 32) {
        v = data.readInt32LE(off) / 2147483648;
      } else {
        v = data.readInt16LE(off) / 32768;
      }
      if (!Number.isFinite(v)) v = 0;
      sum += Math.max(-1, Math.min(1, v));
    }
    out[f] = sum / ch;
  }
  return out;
}

function resampleLinear(samples: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate || samples.length === 0) return samples;
  const outLen = Math.max(1, Math.round((samples.length * outRate) / inRate));
  const out = new Float32Array(outLen);
  const ratio = inRate / outRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[Math.min(idx, samples.length - 1)];
    const b = samples[Math.min(idx + 1, samples.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  if (samples.length === 0) return samples;
  const threshold = 0.005;
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) <= threshold) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) <= threshold) last--;
  if (first >= samples.length) return samples;
  const keep = Math.floor(sampleRate * 0.04);
  const maxTrim = Math.floor(sampleRate * 0.12);
  const leadSilent = first;
  const trailSilent = samples.length - 1 - last;
  let start = 0;
  let end = samples.length;
  if (leadSilent > maxTrim) start = Math.max(0, first - keep);
  if (trailSilent > maxTrim) end = Math.min(samples.length, last + 1 + keep);
  if (start === 0 && end === samples.length) return samples;
  return samples.slice(start, end);
}

function floatToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return out;
}

export function normalizeToWav24kMono(input: Buffer, fallbackRate = 24000): Buffer {
  if (!input || input.length === 0) return wrapPcm16Mono(Buffer.alloc(0), TARGET_SAMPLE_RATE);
  const parsed = parseWav(input);
  if (!parsed) {
    const rate = fallbackRate > 0 ? fallbackRate : TARGET_SAMPLE_RATE;
    const aligned = input.length - (input.length % 2);
    const mono = new Float32Array(Math.floor(aligned / 2));
    for (let i = 0; i < mono.length; i++) mono[i] = input.readInt16LE(i * 2) / 32768;
    const resampled = resampleLinear(mono, rate, TARGET_SAMPLE_RATE);
    const trimmed = trimSilence(resampled, TARGET_SAMPLE_RATE);
    return wrapPcm16Mono(floatToPcm16(trimmed), TARGET_SAMPLE_RATE);
  }
  const mono = decodeToMonoFloat(parsed);
  const resampled = resampleLinear(mono, parsed.sampleRate, TARGET_SAMPLE_RATE);
  const trimmed = trimSilence(resampled, TARGET_SAMPLE_RATE);
  return wrapPcm16Mono(floatToPcm16(trimmed), TARGET_SAMPLE_RATE);
}

export function pcmToWav24kMono(pcm: Buffer, sampleRate = TARGET_SAMPLE_RATE): Buffer {
  const aligned = pcm.length - (pcm.length % 2);
  const mono = new Float32Array(Math.floor(aligned / 2));
  for (let i = 0; i < mono.length; i++) mono[i] = pcm.readInt16LE(i * 2) / 32768;
  const resampled = resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE);
  return wrapPcm16Mono(floatToPcm16(trimSilence(resampled, TARGET_SAMPLE_RATE)), TARGET_SAMPLE_RATE);
}
