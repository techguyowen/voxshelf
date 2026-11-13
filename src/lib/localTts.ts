import { spawn, spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import path from "path";
import { normalizeToWav24kMono } from "./audioResample";
import { DATA_DIR } from "./paths";
import { getLocalTtsUrl } from "./settings";
import type { VoiceInfo } from "./types";
import { GEMINI_VOICES } from "./voices";

export const MAX_LOCAL_TTS_CONCURRENCY = 3;

export interface LocalTtsOutput {
  wav: Buffer;
  engine: string;
  voice: string;
  free: true;
}

export interface ParsedLocalVoice {
  engine: string;
  voiceName: string;
}

const ENGINE_ALIASES: Record<string, string> = {
  kokoro: "kokoro-http",
  "kokoro-http": "kokoro-http",
  piper: "piper",
  say: "say",
  espeak: "espeak",
  sapi: "sapi",
  auto: "auto",
};

export function parseLocalVoiceId(voice: string): ParsedLocalVoice | null {
  if (!voice || !voice.startsWith("local:")) return null;
  const rest = voice.slice("local:".length);
  if (!rest) return null;
  if (rest === "auto") return { engine: "auto", voiceName: "" };
  const idx = rest.indexOf(":");
  if (idx === -1) {
    const engine = ENGINE_ALIASES[rest] ?? rest;
    return { engine, voiceName: "" };
  }
  const rawEngine = rest.slice(0, idx);
  const engine = ENGINE_ALIASES[rawEngine] ?? rawEngine;
  return { engine, voiceName: rest.slice(idx + 1) };
}

let activeCount = 0;
const waitQueue: Array<() => void> = [];
async function acquireSemaphore(): Promise<void> {
  if (activeCount < MAX_LOCAL_TTS_CONCURRENCY) { activeCount++; return; }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeCount++;
}
function releaseSemaphore(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = waitQueue.shift();
  if (next) next();
}
async function withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSemaphore();
  try { return await fn(); } finally { releaseSemaphore(); }
}

const inflight = new Map<string, Promise<LocalTtsOutput>>();

function whichBinary(name: string): string | null {
  try {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf-8" });
    if (r.status === 0 && r.stdout) {
      const p = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (p) return p;
    }
  } catch { /* ignore */ }
  const candidates = [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function runCommand(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } reject(new Error(`${cmd} timed out`)); }, opts.timeoutMs ?? 60000);
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`));
    });
    if (opts.input !== undefined) { child.stdin.write(opts.input); }
    child.stdin.end();
  });
}

const KOKORO_FALLBACK_VOICES: VoiceInfo[] = [
  { name: "af_heart", description: "Kokoro Heart (female)", id: "local:kokoro-http:af_heart", source: "local", gender: "female", engine: "kokoro-http", free: true, lang: "en-US" },
  { name: "af_bella", description: "Kokoro Bella (female)", id: "local:kokoro-http:af_bella", source: "local", gender: "female", engine: "kokoro-http", free: true, lang: "en-US" },
  { name: "am_michael", description: "Kokoro Michael (male)", id: "local:kokoro-http:am_michael", source: "local", gender: "male", engine: "kokoro-http", free: true, lang: "en-US" },
  { name: "am_puck", description: "Kokoro Puck (male)", id: "local:kokoro-http:am_puck", source: "local", gender: "male", engine: "kokoro-http", free: true, lang: "en-US" },
  { name: "bf_emma", description: "Kokoro Emma (British female)", id: "local:kokoro-http:bf_emma", source: "local", gender: "female", engine: "kokoro-http", free: true, lang: "en-GB" },
  { name: "bm_george", description: "Kokoro George (British male)", id: "local:kokoro-http:bm_george", source: "local", gender: "male", engine: "kokoro-http", free: true, lang: "en-GB" },
];

let kokoroProbeCache: { at: number; online: boolean; voices: VoiceInfo[] } | null = null;
async function probeKokoro(): Promise<{ online: boolean; voices: VoiceInfo[] }> {
  if (kokoroProbeCache && Date.now() - kokoroProbeCache.at < 5000) return kokoroProbeCache;
  const base = getLocalTtsUrl().replace(/\/+$/, "");
  const tryFetch = async (p: string): Promise<Response | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 350);
      const r = await fetch(`${base}${p}`, { signal: ctrl.signal });
      clearTimeout(t);
      return r;
    } catch { return null; }
  };
  let voices: VoiceInfo[] = [];
  let online = false;
  const vr = await tryFetch("/v1/audio/voices");
  if (vr && vr.ok) {
    online = true;
    try {
      const j = (await vr.json()) as { voices?: unknown; data?: unknown };
      const list = (j.voices ?? j.data) as unknown;
      if (Array.isArray(list)) {
        voices = list.map((v) => {
          const name = typeof v === "string" ? v : String((v as { id?: string; name?: string })?.id ?? (v as { name?: string })?.name ?? "");
          return { name, description: `Kokoro ${name}`, id: `local:kokoro-http:${name}`, source: "local" as const, engine: "kokoro-http", free: true };
        }).filter((v) => v.name);
      }
    } catch { /* ignore */ }
  }
  if (!online) {
    const mr = await tryFetch("/v1/models");
    if (mr && mr.ok) online = true;
  }
  if (online && voices.length === 0) voices = KOKORO_FALLBACK_VOICES;
  kokoroProbeCache = { at: Date.now(), online, voices };
  return kokoroProbeCache;
}

const NOVELTY_SAY = new Set(["Albert","Bad News","Bahh","Bells","Boing","Bubbles","Cellos","Good News","Jester","Organ","Trinoids","Whisper","Wobble","Zarvox"]);
const DEMOTED_SAY = new Set(["Grandma","Grandpa","Junior","Kathy","Ralph","Superstar"]);
const SAY_BOOST = ["Samantha","Daniel","Alex","Ava","Allison","Susan","Karen","Moira","Serena","Tessa","Eddy","Flo","Reed","Sandy","Shelley"];
export interface SayVoice { name: string; locale: string; sample: string }
let sayCache: { at: number; voices: SayVoice[] } | null = null;

export function parseSayVoiceLine(line: string): SayVoice | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const hashIdx = trimmed.indexOf("#");
  const left = (hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed).trimEnd();
  const sample = hashIdx >= 0 ? trimmed.slice(hashIdx + 1).trim() : "";
  const m = /^(.+?)\s+([a-z]{2,3}(?:[-_][A-Za-z0-9-]+)*)$/.exec(left);
  if (m) {
    return {
      name: m[1].trim(),
      locale: m[2].replace(/_/g, "-"),
      sample,
    };
  }
  const parts = left.split(/\s{2,}/);
  if (parts[0]?.trim()) return { name: parts[0].trim(), locale: "en-US", sample };
  return null;
}

function listSayVoicesSync(): SayVoice[] {
  if (sayCache && Date.now() - sayCache.at < 15000) return sayCache.voices;
  let voices: SayVoice[] = [];
  try {
    const r = spawnSync("/usr/bin/say", ["-v", "?"], { encoding: "utf-8", timeout: 10000 });
    if (r.status === 0 && r.stdout) {
      for (const line of r.stdout.split(/\r?\n/)) {
        const parsed = parseSayVoiceLine(line);
        if (parsed) voices.push(parsed);
      }
    }
  } catch { /* ignore */ }
  voices = voices.filter((v) => v.name && !NOVELTY_SAY.has(v.name));
  const rank = (v: SayVoice): number => {
    let s = 0;
    if (/^en[-_]US$/i.test(v.locale)) s += 220;
    else if (/^en[-_]GB$/i.test(v.locale)) s += 210;
    else if (/^en(?:[-_]|$)/i.test(v.locale)) s += 200;
    if (/Siri/i.test(v.name)) s += 100;
    if (/Premium/i.test(v.name)) s += 90;
    if (/Enhanced/i.test(v.name)) s += 80;
    if (/Neural/i.test(v.name)) s += 85;
    if (/Natural/i.test(v.name)) s += 85;
    const base = v.name.split(" ")[0];
    const bi = SAY_BOOST.indexOf(base);
    if (bi >= 0) s += 50 - bi;
    if (DEMOTED_SAY.has(base)) s -= 60;
    return s;
  };
  voices.sort((a, b) => rank(b) - rank(a));
  sayCache = { at: Date.now(), voices };
  return voices;
}

function findPiperModels(): string[] {
  const out: string[] = [];
  const addDir = (dir: string) => {
    try { for (const f of readdirSync(dir)) if (f.endsWith(".onnx")) out.push(path.join(dir, f)); } catch { /* ignore */ }
  };
  if (process.env.PIPER_MODEL && existsSync(process.env.PIPER_MODEL)) out.push(process.env.PIPER_MODEL);
  if (process.env.PIPER_MODELS_DIR) addDir(process.env.PIPER_MODELS_DIR);
  addDir(path.join(homedir(), ".local", "share", "piper"));
  addDir("/usr/share/piper");
  addDir(path.join(DATA_DIR, "models", "piper"));
  return [...new Set(out)];
}
function piperBinary(): string | null { return whichBinary("piper"); }
function espeakBinary(): string | null { return whichBinary("espeak-ng") || whichBinary("espeak"); }
function sayAvailable(): boolean { return process.platform === "darwin" && existsSync("/usr/bin/say"); }

export interface LocalTtsCapabilities {
  available: boolean;
  engine: string | null;
  engines: string[];
  kokoroOnline: boolean;
  piperAvailable: boolean;
  piperModels: string[];
  sayAvailable: boolean;
  espeakAvailable: boolean;
  sapiAvailable: boolean;
}

let capCache: { at: number; value: LocalTtsCapabilities } | null = null;

export function clearLocalTtsCache(): void {
  kokoroProbeCache = null;
  sayCache = null;
  capCache = null;
}
export async function detectLocalTtsCapabilities(): Promise<LocalTtsCapabilities> {
  if (capCache && Date.now() - capCache.at < 5000) return capCache.value;
  const kokoro = await probeKokoro();
  const engines: string[] = [];
  if (kokoro.online) engines.push("kokoro-http");
  const hasPiper = Boolean(piperBinary() && findPiperModels().length > 0);
  if (hasPiper) engines.push("piper");
  const hasSay = sayAvailable();
  if (hasSay) engines.push("say");
  const hasEspeak = Boolean(espeakBinary());
  if (hasEspeak) engines.push("espeak");
  const hasSapi = process.platform === "win32";
  if (hasSapi) engines.push("sapi");
  const value: LocalTtsCapabilities = {
    available: engines.length > 0,
    engine: engines[0] ?? null,
    engines,
    kokoroOnline: kokoro.online,
    piperAvailable: hasPiper,
    piperModels: findPiperModels(),
    sayAvailable: hasSay,
    espeakAvailable: hasEspeak,
    sapiAvailable: hasSapi,
  };
  capCache = { at: Date.now(), value };
  return value;
}

export async function isLocalTtsAvailable(): Promise<boolean> {
  const c = await detectLocalTtsCapabilities();
  return c.available;
}

export async function listLocalVoices(): Promise<VoiceInfo[]> {
  const caps = await detectLocalTtsCapabilities();
  const out: VoiceInfo[] = [];
  out.push({ name: "Auto (best local)", description: "Automatically picks the best free local voice", id: "local:auto", source: "local", engine: "auto", free: true });
  if (caps.kokoroOnline) {
    const k = await probeKokoro();
    out.push(...k.voices);
  }
  if (caps.sayAvailable) {
    const femaleSay = new Set(["Samantha","Ava","Allison","Susan","Karen","Moira","Serena","Tessa","Flo","Sandy","Shelley","Veena","Fiona","Kate","Emily","Joanna","Tara","Zosia","Milena","Paulina","Luciana","Mónica","Amélie","Anna","Alice","Kyoko","Tingting","Meijia","Sinji","Yuna"]);
    const maleSay = new Set(["Daniel","Alex","Eddy","Reed","Fred","Tom","David","Aaron","Arthur","Gordon","Nicky","Aman","Rishi","Rocko","Thomas","Xander","Jacques"]);
    for (const v of listSayVoicesSync()) {
      const baseName = v.name.split(" ")[0];
      const gender = femaleSay.has(baseName) ? "female" as const : maleSay.has(baseName) ? "male" as const : "neutral" as const;
      out.push({ name: v.name, description: `macOS ${v.locale}${v.sample ? ` — ${v.sample.slice(0, 60)}` : ""}`, id: `local:say:${v.name}`, source: "local", engine: "say", free: true, lang: v.locale, gender });
    }
  }
  if (caps.piperAvailable) {
    for (const m of caps.piperModels) {
      const base = path.basename(m, ".onnx");
      out.push({ name: base, description: `Piper neural voice (${base})`, id: `local:piper:${base}`, source: "local", engine: "piper", free: true });
    }
  }
  if (caps.espeakAvailable) {
    const basics: Array<[string, string]> = [["en-us", "English (US)"], ["en-gb", "English (GB)"], ["en-us+f3", "English (US, female)"], ["en-gb+f2", "English (GB, female)"]];
    for (const [code, label] of basics) out.push({ name: code, description: `eSpeak ${label}`, id: `local:espeak:${code}`, source: "local", engine: "espeak", free: true, lang: code.slice(0, 5) });
  }
  if (caps.sapiAvailable) {
    out.push({ name: "default", description: "Windows SAPI default voice", id: "local:sapi:default", source: "local", engine: "sapi", free: true });
  }
  return out;
}

async function synthKokoro(text: string, voiceName: string, speed: number): Promise<Buffer> {
  const base = getLocalTtsUrl().replace(/\/+$/, "");
  const voice = voiceName || "af_heart";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "wav", speed }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Kokoro TTS failed (${r.status})`);
    return normalizeToWav24kMono(Buffer.from(await r.arrayBuffer()));
  } finally { clearTimeout(t); }
}

async function synthSay(text: string, voiceName: string, speed: number): Promise<Buffer> {
  const voices = listSayVoicesSync();
  const chosen = (voiceName && voices.find((v) => v.name === voiceName)?.name) || voices[0]?.name || "Samantha";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpTxt = path.join(tmpdir(), `vs-say-${stamp}.txt`);
  const tmpWav = path.join(tmpdir(), `vs-say-${stamp}.wav`);
  try {
    writeFileSync(tmpTxt, text, "utf-8");
    const args = ["-v", chosen, "-f", tmpTxt, "-o", tmpWav, "--file-format=WAVE", "--data-format=LEI16@24000"];
    if (speed !== 1) {
      const wpm = Math.round(Math.max(90, Math.min(420, 185 * speed)));
      args.push("-r", String(wpm));
    }
    await runCommand("/usr/bin/say", args, { timeoutMs: 120000 });
    return normalizeToWav24kMono(readFileSync(tmpWav));
  } finally {
    for (const f of [tmpTxt, tmpWav]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ } }
  }
}

async function synthEspeak(text: string, voiceName: string, speed: number): Promise<Buffer> {
  const bin = espeakBinary();
  if (!bin) throw new Error("espeak is not installed");
  const voice = voiceName || "en-us";
  const wpm = Math.round(Math.max(80, Math.min(450, 175 * speed)));
  const { stdout } = await runCommand(bin, ["-v", voice, "-s", String(wpm), "--stdin", "--stdout"], { input: text, timeoutMs: 120000 });
  if (!stdout || stdout.length === 0) throw new Error("espeak returned no audio");
  return normalizeToWav24kMono(stdout);
}

async function synthPiper(text: string, voiceName: string): Promise<Buffer> {
  const bin = piperBinary();
  if (!bin) throw new Error("piper is not installed");
  const models = findPiperModels();
  if (models.length === 0) throw new Error("No Piper voice models found");
  const model = models.find((m) => path.basename(m, ".onnx") === voiceName) || models[0];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpWav = path.join(tmpdir(), `vs-piper-${stamp}.wav`);
  try {
    await runCommand(bin, ["--model", model, "--output_file", tmpWav], { input: text, timeoutMs: 120000 });
    return normalizeToWav24kMono(readFileSync(tmpWav));
  } finally { try { if (existsSync(tmpWav)) unlinkSync(tmpWav); } catch { /* ignore */ } }
}

async function synthSapi(text: string, voiceName: string, speed: number): Promise<Buffer> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpWav = path.join(tmpdir(), `vs-sapi-${stamp}.wav`);
  const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 5)));
  const voiceLine = voiceName && voiceName !== "default" ? `try { $s.SelectVoice('${voiceName.replace(/'/g, "''")}') } catch {}` : "";
  const script =
    `$t = [Console]::In.ReadToEnd(); ` +
    `Add-Type -AssemblyName System.Speech; ` +
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `${voiceLine} ` +
    `$s.Rate = ${rate}; ` +
    `$s.SetOutputToWaveFile('${tmpWav.replace(/'/g, "''")}'); ` +
    `$s.Speak($t); $s.Dispose();`;
  try {
    await runCommand("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { input: text, timeoutMs: 120000 });
    return normalizeToWav24kMono(readFileSync(tmpWav));
  } finally { try { if (existsSync(tmpWav)) unlinkSync(tmpWav); } catch { /* ignore */ } }
}

async function resolveAutoEngine(): Promise<string> {
  const caps = await detectLocalTtsCapabilities();
  if (!caps.engine) throw new Error("No local TTS engine is available. Install Piper, start Kokoro, or use an OS voice.");
  return caps.engine;
}

async function doSynthesize(text: string, voice: string, speed: number): Promise<LocalTtsOutput> {
  const parsed = parseLocalVoiceId(voice) ?? { engine: "auto", voiceName: "" };
  let engine = parsed.engine;
  let voiceName = parsed.voiceName;
  if (engine === "auto" || !engine) {
    engine = await resolveAutoEngine();
    if (engine === "kokoro-http" && !voiceName) voiceName = "af_heart";
    if (engine === "say" && !voiceName) voiceName = listSayVoicesSync()[0]?.name ?? "Samantha";
    if (engine === "espeak" && !voiceName) voiceName = "en-us";
    if (engine === "sapi" && !voiceName) voiceName = "default";
    if (engine === "piper" && !voiceName) {
      const models = findPiperModels();
      voiceName = models.length ? path.basename(models[0], ".onnx") : "";
    }
  }
  const resolvedVoice = `local:${engine}:${voiceName}`;
  let wav: Buffer;
  if (engine === "kokoro-http") wav = await synthKokoro(text, voiceName, speed);
  else if (engine === "piper") wav = await withSemaphore(() => synthPiper(text, voiceName));
  else if (engine === "say") wav = await withSemaphore(() => synthSay(text, voiceName, speed));
  else if (engine === "espeak") wav = await withSemaphore(() => synthEspeak(text, voiceName, speed));
  else if (engine === "sapi") wav = await withSemaphore(() => synthSapi(text, voiceName, speed));
  else throw new Error(`Unknown local TTS engine: ${engine}`);
  return { wav, engine, voice: resolvedVoice, free: true };
}

export async function synthesizeLocalSpeech(text: string, voice: string, speed = 1): Promise<LocalTtsOutput> {
  const clean = (text || "").trim();
  if (!clean) throw new Error("Nothing to speak.");
  const safeSpeed = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  const key = `${voice}::${safeSpeed}::${clean}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = doSynthesize(clean, voice, safeSpeed).finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

const GEMINI_VOICE_NAMES_LOWER = new Set(GEMINI_VOICES.map((v) => v.name.toLowerCase()));
const FEMALE_CLOUD = new Set(["Kore","Aoede","Leda","Callirrhoe","Despina","Erinome","Autonoe","Laomedeia","Vindemiatrix","Pulcherrima","Achernar","Zephyr","Schedar","Sulafat"]);
const MALE_CLOUD = new Set(["Puck","Fenrir","Charon","Orus","Iapetus","Algenib","Rasalgethi","Gacrux","Algieba","Enceladus","Sadaltager","Umbriel","Alnilam","Achird","Zubenelgenubi","Sadachbia"]);

export async function mapCloudVoiceToLocal(
  voiceName: string,
  preferredEngine?: string,
): Promise<string> {
  const voices = await listLocalVoices();
  const concrete = voices.filter((v) => v.id && v.id !== "local:auto");
  if (concrete.length === 0) return "local:auto";

  const rawEngine = (preferredEngine || "").trim();
  const normalizedEngine =
    rawEngine && rawEngine !== "auto"
      ? (ENGINE_ALIASES[rawEngine] ?? rawEngine)
      : "";
  const engineMatches = normalizedEngine
    ? concrete.filter((v) => v.engine === normalizedEngine)
    : [];
  const poolBase = engineMatches.length > 0 ? engineMatches : concrete;

  const needle = (voiceName || "").trim().toLowerCase();
  if (needle && !GEMINI_VOICE_NAMES_LOWER.has(needle)) {
    const exact = poolBase.find(
      (v) =>
        v.name.toLowerCase() === needle ||
        (v.id && v.id.toLowerCase() === needle) ||
        v.name.split(" (")[0].trim().toLowerCase() === needle,
    );
    if (exact?.id) return exact.id;

    const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const enFirst = poolBase.filter((v) => !v.lang || /^en(?:[-_]|$)/i.test(v.lang));
    const searchPool = enFirst.length > 0 ? enFirst : poolBase;
    const wordRx = new RegExp(`(?:^|[^a-z0-9])${escapeRx(needle)}(?:$|[^a-z0-9])`, "i");
    const sub = searchPool.find((v) => wordRx.test(v.name.split(" (")[0]));
    if (sub?.id) return sub.id;
  }

  const gender: "male" | "female" | "neutral" = FEMALE_CLOUD.has(voiceName)
    ? "female"
    : MALE_CLOUD.has(voiceName)
      ? "male"
      : "neutral";
  const hash = [...(voiceName || "")].reduce(
    (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
    7,
  );
  const byGender = poolBase.filter((v) => v.gender === gender);
  const genderPool = byGender.length ? byGender : poolBase;
  const enPool = genderPool.filter(
    (v) => !v.lang || /^en(?:[-_]|$)/i.test(v.lang),
  );
  const pool = enPool.length ? enPool : genderPool;
  const nonNovelty = pool.filter((v) => !DEMOTED_SAY.has(v.name.split(" ")[0]));
  const cleanPool = nonNovelty.length ? nonNovelty : pool;
  const kokoroPool =
    !normalizedEngine || normalizedEngine === "kokoro-http"
      ? cleanPool.filter((v) => v.engine === "kokoro-http")
      : [];
  const ordered = kokoroPool.length ? kokoroPool : cleanPool;
  const geminiIdx = GEMINI_VOICES.findIndex((v) => v.name === voiceName);
  const idx = Math.abs(geminiIdx >= 0 ? geminiIdx : hash) % ordered.length;
  // Prefer kokoro gender-coded names when available for clearer distinction.
  if (kokoroPool.length) {
    const coded = kokoroPool.filter((v) =>
      gender === "female"
        ? /^[ab]f_/.test(v.name)
        : gender === "male"
          ? /^[ab]m_/.test(v.name)
          : true,
    );
    if (coded.length) return coded[idx % coded.length].id!;
  }
  return ordered[idx].id!;
}
