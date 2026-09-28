"use client";

import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, formatBytes } from "@/lib/client";
import type {
  CacheStats,
  ModelInfo,
  ModelsResponse,
  PublicSettings,
} from "@/lib/types";
import { VOICE_NAMES } from "@/lib/voices";
import { Modal } from "./Modal";

const inputCls =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-zinc-200 pb-5 last:border-0 last:pb-0 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "recommended" | "fast" | "muted";
}) {
  const cls =
    tone === "recommended"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
      : tone === "fast"
        ? "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold leading-4 ${cls}`}
    >
      {children}
    </span>
  );
}

function ModelBadges({ model }: { model: ModelInfo }) {
  return (
    <>
      {model.isRecommended && <Badge tone="recommended">Recommended</Badge>}
      {model.speed === "fast" && <Badge tone="fast">Fast</Badge>}
      {model.category === "vision" && <Badge tone="muted">Vision</Badge>}
    </>
  );
}

/**
 * Searchable model picker with a manual "Custom" input for fine-tuned IDs.
 * Expands inline (not as an overlay) so it works inside the scrolling modal.
 */
function ModelSelector({
  label,
  value,
  onChange,
  models,
  loading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  models: ModelInfo[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const autoCustomDone = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = models.find((m) => m.id === value);

  // If the saved value isn't a known model (e.g. a fine-tuned ID), open the
  // custom input once the lists arrive instead of showing a blank picker.
  useEffect(() => {
    if (!autoCustomDone.current && models.length > 0 && value && !selected) {
      autoCustomDone.current = true;
      setCustom(true);
    }
  }, [models, value, selected]);

  useEffect(() => {
    if (open && !custom) searchRef.current?.focus();
  }, [open, custom]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) =>
        `${m.id} ${m.name} ${m.description ?? ""}`.toLowerCase().includes(q),
      )
    : models;

  function pick(id: string) {
    onChange(id);
    setCustom(false);
    setOpen(false);
    setQuery("");
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {label}
        </span>
        <button
          type="button"
          onClick={() => {
            setCustom((v) => !v);
            setOpen(false);
          }}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 underline-offset-2 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {custom ? "Choose from list" : "Custom model"}
        </button>
      </div>

      {custom ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. tunedModels/my-fine-tune"
          className={inputCls}
          spellCheck={false}
          autoComplete="off"
        />
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`${inputCls} flex items-center justify-between gap-2 text-left`}
            aria-expanded={open}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {loading && models.length === 0 ? (
                <span className="text-zinc-400">Loading models…</span>
              ) : selected ? (
                <>
                  <span className="truncate font-medium">{selected.name}</span>
                  <ModelBadges model={selected} />
                </>
              ) : value ? (
                <>
                  <span className="truncate font-mono text-[13px]">{value}</span>
                  <Badge tone="muted">custom</Badge>
                </>
              ) : (
                <span className="text-zinc-400">Select a model…</span>
              )}
            </span>
            <ChevronDown
              size={16}
              className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>

          {open && (
            <div className="mt-1 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
              <div className="relative border-b border-zinc-200 dark:border-zinc-800">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='Search models… e.g. "flash" or "pro"'
                  className="w-full bg-transparent py-2 pl-9 pr-3 text-sm outline-none placeholder:text-zinc-400"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="max-h-56 overflow-y-auto bg-white dark:bg-zinc-900">
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-zinc-500">
                    {models.length === 0
                      ? "No models loaded yet."
                      : `No models match "${query.trim()}".`}
                  </p>
                ) : (
                  filtered.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pick(m.id)}
                      title={m.description ?? m.id}
                      className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        m.id === value ? "bg-emerald-50 dark:bg-emerald-950/40" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                          <span className="truncate">{m.name}</span>
                          <ModelBadges model={m} />
                        </span>
                        <span className="block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {m.id}
                        </span>
                        {m.description && (
                          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {m.description}
                          </span>
                        )}
                      </span>
                      {m.id === value && (
                        <Check
                          size={15}
                          className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                        />
                      )}
                    </button>
                  ))
                )}
              </div>
              <p className="border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                {filtered.length} of {models.length} models
                {q && ` matching "${query.trim()}"`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [voice, setVoice] = useState("Kore");
  const [speed, setSpeed] = useState(1);
  const [ttsModel, setTtsModel] = useState("");
  const [textModel, setTextModel] = useState("");
  const [modelLists, setModelLists] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setModelsLoading(true);
    Promise.all([api.settings(), api.cacheStats(), api.models()])
      .then(([s, c, m]) => {
        if (!live) return;
        setSettings(s);
        setStats(c);
        setVoice(s.defaultVoice);
        setSpeed(s.defaultSpeed);
        setTtsModel(s.ttsModel);
        setTextModel(s.textModel);
        setModelLists(m);
        if (m.error) setModelsError(m.error);
        setLoading(false);
        setModelsLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Failed to load settings.");
        setLoading(false);
        setModelsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  async function fetchModels() {
    setModelsLoading(true);
    setModelsError(null);
    try {
      // Pass the freshly typed key if there is one; otherwise the server
      // falls back to the stored setting and then the environment key.
      const res = await api.models(
        keyTouched && apiKey.trim() ? apiKey : undefined,
      );
      setModelLists(res);
      if (res.error) setModelsError(res.error);
    } catch (e) {
      setModelsError(
        e instanceof Error ? e.message : "Failed to fetch models.",
      );
    } finally {
      setModelsLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {
        defaultVoice: voice,
        defaultSpeed: speed,
        ttsModel,
        textModel,
      };
      if (keyTouched) patch.geminiApiKey = apiKey;
      const s = await api.updateSettings(patch);
      setSettings(s);
      setKeyTouched(false);
      setSavedTick(true);
      onSaved();
      setTimeout(() => setSavedTick(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function clearCache() {
    if (!confirm("Delete all cached audio? Sentences will be re-synthesized on next play.")) return;
    setClearing(true);
    try {
      await api.clearCache();
      setStats(await api.cacheStats());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear cache.");
    } finally {
      setClearing(false);
    }
  }

  async function onImportFile(file: File) {
    setImporting(true);
    setError(null);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      const res = await api.importData(data);
      alert(`Import complete: ${res.imported} imported, ${res.skipped} skipped.`);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Invalid import file.",
      );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={18} /> Loading…
        </div>
      ) : (
        <div className="space-y-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Section title="Gemini API key">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type={showKey ? "text" : "password"}
                  value={keyTouched ? apiKey : settings?.hasApiKey ? "••••••••••••••••" : ""}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyTouched(true);
                  }}
                  placeholder="AIza…"
                  className={`${inputCls} pl-9 pr-10`}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  aria-label={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {settings?.serverKeyConfigured
                ? "A server-side GEMINI_API_KEY is configured; a key saved here overrides it. "
                : "Get a free key at aistudio.google.com/apikey. "}
              Saving an empty key clears the override.
              {!settings?.hasApiKey && (
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {" "}TTS and AI features need a key.
                </span>
              )}
            </p>
          </Section>

          <Section title="Defaults">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Default voice
                </span>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className={inputCls}
                >
                  {VOICE_NAMES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Default speed: {speed.toFixed(1)}×
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={4.5}
                  step={0.1}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            </div>
          </Section>

          <Section title="Models">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={fetchModels}
                disabled={modelsLoading}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {modelsLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                🔄 Fetch Live Models
              </button>
              {modelLists && (
                <span
                  className={`flex items-center gap-1.5 text-[11px] ${
                    modelLists.live
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      modelLists.live ? "bg-emerald-500" : "bg-zinc-400"
                    }`}
                  />
                  {modelLists.live
                    ? `Live from Gemini API (${modelLists.ttsModels.length + modelLists.textModels.length} models)`
                    : "Curated defaults — fetch with an API key for the live list"}
                </span>
              )}
            </div>
            {modelsError && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Live lookup failed ({modelsError}); showing curated defaults.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ModelSelector
                label="TTS model"
                value={ttsModel}
                onChange={setTtsModel}
                models={modelLists?.ttsModels ?? []}
                loading={modelsLoading}
              />
              <ModelSelector
                label="Text / vision model"
                value={textModel}
                onChange={setTextModel}
                models={modelLists?.textModels ?? []}
                loading={modelsLoading}
              />
            </div>
          </Section>

          <Section title="Audio cache">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-800">
              <span className="text-zinc-600 dark:text-zinc-300">
                {stats ? (
                  <>
                    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {stats.entries.toLocaleString()}
                    </strong>{" "}
                    clips · {formatBytes(stats.bytes)}
                  </>
                ) : (
                  "—"
                )}
              </span>
              <button
                onClick={clearCache}
                disabled={clearing}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {clearing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Clear cache
              </button>
            </div>
          </Section>

          <Section title="Data export / import">
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/data/export"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Export library (.json)
              </a>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {importing && <Loader2 size={14} className="animate-spin" />}
                Import backup…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                }}
              />
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Exports documents, reading progress and bookmarks. Audio cache is
              not included (it rebuilds on demand).
            </p>
          </Section>

          <div className="flex items-center justify-end gap-2 pt-1">
            {savedTick && (
              <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                <Check size={15} /> Saved
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Save settings
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
