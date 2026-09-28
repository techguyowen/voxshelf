"use client";

import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, formatBytes } from "@/lib/client";
import type { CacheStats, PublicSettings } from "@/lib/types";
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
  const [clearing, setClearing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.settings(), api.cacheStats()])
      .then(([s, c]) => {
        if (!live) return;
        setSettings(s);
        setStats(c);
        setVoice(s.defaultVoice);
        setSpeed(s.defaultSpeed);
        setTtsModel(s.ttsModel);
        setTextModel(s.textModel);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Failed to load settings.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  TTS model
                </span>
                <input
                  type="text"
                  value={ttsModel}
                  onChange={(e) => setTtsModel(e.target.value)}
                  className={inputCls}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Text / vision model
                </span>
                <input
                  type="text"
                  value={textModel}
                  onChange={(e) => setTextModel(e.target.value)}
                  className={inputCls}
                  spellCheck={false}
                />
              </label>
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
