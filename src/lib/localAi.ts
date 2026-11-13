import { getLocalLlmUrl, getOllamaUrl } from "./settings";

export interface LocalModelInfo { id: string; name: string; provider: "ollama" | "local-openai"; }
export interface LocalAiDiscovery {
  ollamaOnline: boolean;
  ollamaUrl: string;
  ollamaModels: LocalModelInfo[];
  localLlmOnline: boolean;
  localLlmUrl: string;
  localLlmModels: LocalModelInfo[];
}

let discCache: { at: number; value: LocalAiDiscovery } | null = null;

export function clearLocalAiCache(): void {
  discCache = null;
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { ok: r.ok, status: r.status, json, text };
  } finally { clearTimeout(t); }
}

export async function discoverLocalAiServers(): Promise<LocalAiDiscovery> {
  if (discCache && Date.now() - discCache.at < 5000) return discCache.value;
  const ollamaUrl = getOllamaUrl().replace(/\/+$/, "");
  const localLlmUrl = getLocalLlmUrl().replace(/\/+$/, "");
  let ollamaModels: LocalModelInfo[] = [];
  let ollamaOnline = false;
  try {
    const r = await fetchJson(`${ollamaUrl}/api/tags`, 400);
    if (r.ok && r.json && typeof r.json === "object") {
      ollamaOnline = true;
      const models = (r.json as { models?: Array<{ name?: string; model?: string }> }).models ?? [];
      ollamaModels = models.map((m) => {
        const name = m.name || m.model || "";
        return { id: `ollama:${name}`, name, provider: "ollama" as const };
      }).filter((m) => m.name);
    }
  } catch { ollamaOnline = false; }
  let localLlmModels: LocalModelInfo[] = [];
  let localLlmOnline = false;
  try {
    const r = await fetchJson(`${localLlmUrl}/models`, 400);
    if (r.ok && r.json && typeof r.json === "object") {
      localLlmOnline = true;
      const data = (r.json as { data?: Array<{ id?: string }> }).data ?? [];
      localLlmModels = data.map((m) => ({ id: `local:${m.id ?? ""}`, name: m.id ?? "", provider: "local-openai" as const })).filter((m) => m.name);
      if (localLlmModels.length === 0) localLlmModels = [{ id: "local:default", name: "default", provider: "local-openai" }];
    }
  } catch { localLlmOnline = false; }
  const value: LocalAiDiscovery = { ollamaOnline, ollamaUrl, ollamaModels, localLlmOnline, localLlmUrl, localLlmModels };
  discCache = { at: Date.now(), value };
  return value;
}

export async function discoverBestLocalLlmModel(): Promise<string | null> {
  const d = await discoverLocalAiServers();
  if (d.ollamaModels.length) return d.ollamaModels[0].id;
  if (d.localLlmModels.length) return d.localLlmModels[0].id;
  if (d.ollamaOnline) return null;
  if (d.localLlmOnline) return "local:default";
  return null;
}

export type ParsedModelId =
  | { kind: "builtin"; model: string }
  | { kind: "ollama"; model: string }
  | { kind: "local"; model: string }
  | { kind: "gemini"; model: string };

export function parseModelId(id: string): ParsedModelId {
  const v = (id || "").trim();
  if (v.startsWith("builtin:")) return { kind: "builtin", model: v.slice("builtin:".length) };
  if (v.startsWith("ollama:")) return { kind: "ollama", model: v.slice("ollama:".length) };
  if (v.startsWith("local:")) return { kind: "local", model: v.slice("local:".length) };
  return { kind: "gemini", model: v };
}

export async function ollamaGenerate(model: string, prompt: string, opts: { json?: boolean; system?: string } = {}): Promise<string> {
  const base = getOllamaUrl().replace(/\/+$/, "");
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, ...(opts.json ? { format: "json" } : {}), options: { temperature: 0.25, num_ctx: 8192 } }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Ollama request failed (${r.status})`);
    const j = (await r.json()) as { message?: { content?: string }; response?: string };
    const out = (j.message?.content ?? j.response ?? "").trim();
    if (!out) throw new Error("Ollama returned empty text");
    return out;
  } finally { clearTimeout(t); }
}

export async function localOpenAiGenerate(model: string, prompt: string, opts: { json?: boolean; system?: string } = {}): Promise<string> {
  const base = getLocalLlmUrl().replace(/\/+$/, "");
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || "default", messages, temperature: 0.25, ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Local LLM request failed (${r.status})`);
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const out = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!out) throw new Error("Local LLM returned empty text");
    return out;
  } finally { clearTimeout(t); }
}

export async function localLlmGenerate(modelId: string, prompt: string, opts: { json?: boolean; system?: string } = {}): Promise<string> {
  const p = parseModelId(modelId);
  if (p.kind === "ollama") return ollamaGenerate(p.model, prompt, opts);
  if (p.kind === "local") return localOpenAiGenerate(p.model, prompt, opts);
  throw new Error(`Not a local LLM model: ${modelId}`);
}

export function parseLlmJson<T>(raw: string, kind: "object" | "array"): T {
  const trimmed = (raw || "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = kind === "object" ? body.indexOf("{") : body.indexOf("[");
  const end = kind === "object" ? body.lastIndexOf("}") : body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("No JSON found in model response");
  let slice = body.slice(start, end + 1);
  try { return JSON.parse(slice) as T; } catch { /* repair */ }
  slice = slice.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(slice) as T;
}
