"use client";

import type { AmbientPreset, AmbientState } from "./types";
import { sleepFadeVolume } from "./globalPlayer";

const AMBIENT_KEY = "vs-ambient-audio";
const LOOP_SECONDS = 5;

const PRESETS: AmbientPreset[] = ["off", "brown", "pink", "rain", "warm-drone"];

function defaultState(): AmbientState {
  return { preset: "off", volume: 0.25, syncWithPlayback: false };
}

function load(): AmbientState {
  try {
    const raw = localStorage.getItem(AMBIENT_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<AmbientState>;
    return {
      preset: PRESETS.includes(parsed.preset as AmbientPreset)
        ? (parsed.preset as AmbientPreset)
        : "off",
      volume:
        typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
          ? Math.min(1, Math.max(0, parsed.volume))
          : 0.25,
      syncWithPlayback: parsed.syncWithPlayback === true,
    };
  } catch {
    return defaultState();
  }
}

let state: AmbientState | null = null;
const listeners = new Set<(s: AmbientState) => void>();

function current(): AmbientState {
  if (!state) state = typeof window === "undefined" ? defaultState() : load();
  return state;
}

function persist(): void {
  try {
    localStorage.setItem(AMBIENT_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(current());
    } catch {
      // ignore
    }
  }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let nodes: AudioNode[] = [];
let narrationPlaying = true;
let sleepRemainingSec: number | null = null;

function ensureGraph(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (ctx.state === "suspended" && !shouldDuck()) {
      void ctx.resume().catch(() => undefined);
    }
    if (!master) {
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    applyGain();
    return true;
  } catch {
    return false;
  }
}

function shouldDuck(): boolean {
  return current().syncWithPlayback && !narrationPlaying;
}

function applyGain(): void {
  if (!ctx || !master) return;
  try {
    const target = shouldDuck()
      ? 0
      : sleepFadeVolume(current().volume, sleepRemainingSec);
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
  } catch {
    // ignore
  }
}

function stopSources(): void {
  for (const n of nodes) {
    try {
      if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) {
        n.stop();
      }
      n.disconnect();
    } catch {
      // ignore
    }
  }
  nodes = [];
}

function loopSource(buffer: AudioBuffer): AudioBufferSourceNode | null {
  if (!ctx || !master) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  nodes.push(src);
  return src;
}

function brownBuffer(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * LOOP_SECONDS);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3.5;
  }
  return buf;
}

function pinkBuffer(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * LOOP_SECONDS);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buf;
}

function rainBuffer(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * LOOP_SECONDS);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let env = 0.5;
  let target = 0.5;
  for (let i = 0; i < len; i++) {
    if (Math.random() < 0.0004) target = Math.random();
    env += (target - env) * 0.002;
    const white = Math.random() * 2 - 1;
    data[i] = white * (0.55 + 0.45 * env) * 0.5;
  }
  return buf;
}

function lowpass(freq: number): BiquadFilterNode | null {
  if (!ctx) return null;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = freq;
  nodes.push(f);
  return f;
}

function rebuild(): void {
  stopSources();
  const preset = current().preset;
  if (preset === "off") {
    try {
      void ctx?.suspend().catch(() => undefined);
    } catch {
      // ignore
    }
    return;
  }
  if (!ensureGraph() || !ctx || !master) return;
  try {
    if (preset === "brown") {
      const src = loopSource(brownBuffer(ctx));
      const filter = lowpass(450);
      if (src && filter) {
        src.connect(filter);
        filter.connect(master);
        src.start();
      }
    } else if (preset === "pink") {
      const src = loopSource(pinkBuffer(ctx));
      const filter = lowpass(1200);
      if (src && filter) {
        src.connect(filter);
        filter.connect(master);
        src.start();
      }
    } else if (preset === "rain") {
      const src = loopSource(rainBuffer(ctx));
      if (src) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1800;
        bp.Q.value = 0.7;
        nodes.push(bp);
        src.connect(bp);
        bp.connect(master);
        src.start();
      }
    } else if (preset === "warm-drone") {
      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      nodes.push(mix);
      mix.connect(master);
      for (const [freq, type] of [
        [110, "sine"],
        [164.81, "triangle"],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = type === "sine" ? 0.32 : 0.2;
        nodes.push(osc, g);
        osc.connect(g);
        g.connect(mix);
        osc.start();
      }
      const noise = loopSource(brownBuffer(ctx));
      const filter = lowpass(280);
      if (noise && filter) {
        const ng = ctx.createGain();
        ng.gain.value = 0.12;
        nodes.push(ng);
        noise.connect(filter);
        filter.connect(ng);
        ng.connect(mix);
        noise.start();
      }
    }
  } catch {
    stopSources();
  }
}

export function getAmbientState(): AmbientState {
  return current();
}

export function subscribeAmbient(fn: (state: AmbientState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function update(next: AmbientState): void {
  state = next;
  persist();
  emit();
}

export function setAmbientPreset(preset: AmbientPreset): void {
  if (!PRESETS.includes(preset)) return;
  const s = current();
  if (s.preset === preset) return;
  update({ ...s, preset });
  rebuild();
}

export function setAmbientVolume(volume: number): void {
  if (!Number.isFinite(volume)) return;
  const s = current();
  const v = Math.min(1, Math.max(0, volume));
  if (s.volume === v) return;
  update({ ...s, volume: v });
  applyGain();
}

export function setAmbientSyncWithPlayback(sync: boolean): void {
  const s = current();
  if (s.syncWithPlayback === sync) return;
  update({ ...s, syncWithPlayback: sync });
  if (sync && !narrationPlaying) {
    try {
      void ctx?.suspend().catch(() => undefined);
    } catch {
      // ignore
    }
  } else if (current().preset !== "off") {
    try {
      void ctx?.resume().catch(() => undefined);
    } catch {
      // ignore
    }
  }
  applyGain();
}

export function notifyNarrationPlaying(isPlaying: boolean): void {
  narrationPlaying = isPlaying;
  if (!current().syncWithPlayback || current().preset === "off") return;
  try {
    if (isPlaying) {
      void ctx?.resume().catch(() => undefined);
    } else {
      void ctx?.suspend().catch(() => undefined);
    }
  } catch {
    // ignore
  }
  applyGain();
}

export function applyAmbientSleepFade(remainingSec: number | null): void {
  sleepRemainingSec = remainingSec;
  applyGain();
}
