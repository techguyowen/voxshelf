"use client";

import {
  BookOpenText,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, formatBytes } from "@/lib/client";
import { formatChars, formatUsd } from "@/lib/pricing";
import type {
  CacheStats,
  ModelInfo,
  ModelsResponse,
  PublicSettings,
  SyncStatusDto,
} from "@/lib/types";
import { VOICE_NAMES } from "@/lib/voices";
import { Modal } from "./Modal";
import { PronunciationModal } from "./PronunciationModal";
import { ServerBrowserModal } from "./ServerBrowserModal";
import { useToast } from "./Toast";
import { VoicePreviewButton } from "./VoicePreviewButton";

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

function formatSyncTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

function SyncSection() {
  const [status, setStatus] = useState<SyncStatusDto | null>(null);
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [syncKey, setSyncKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [mode, setMode] = useState<"full" | "selective">("full");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const s = await api.syncStatus();
      setStatus(s);
      setUrl(s.serverUrl);
      setEnabled(s.enabled);
      setMode(s.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sync status.");
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollAfterSave() {
    if (pollRef.current) clearInterval(pollRef.current);
    let n = 0;
    pollRef.current = setInterval(() => {
      n += 1;
      void refresh();
      if (n >= 5 && pollRef.current) clearInterval(pollRef.current);
    }, 3000);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const patch: {
        serverUrl: string;
        enabled: boolean;
        apiKey?: string;
        mode: "full" | "selective";
      } = { serverUrl: url, enabled, mode };
      if (keyTouched) patch.apiKey = syncKey;
      const s = await api.syncConfig(patch);
      setStatus(s);
      setKeyTouched(false);
      setSyncKey("");
      toast.success(s.serverUrl ? "Sync server saved — syncing…" : "Sync disabled (standalone mode).");
      if (s.serverUrl && s.enabled) pollAfterSave();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save sync settings.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const r = await api.syncNow();
      await refresh();
      window.dispatchEvent(new Event("voxshelf:library-changed"));
      if (r.ok) {
        toast.success(`Synced: ${r.pushed} sent, ${r.pulled} received.`);
      } else {
        toast.error(r.error || "Sync failed.");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed.";
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  const last = status?.lastResult ?? null;
  const skewMins = last?.skewMs === undefined ? null : Math.round(last.skewMs / 60000);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Server
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.10:38492"
            className={`${inputCls} pl-9`}
            autoComplete="off"
            spellCheck={false}
            aria-label="Sync server URL"
          />
        </div>
        <button
          onClick={syncNow}
          disabled={syncing || !status?.serverUrl}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Sync now
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-emerald-600"
        />
        Sync automatically in the background
      </label>
      <div>
        <input
          type="password"
          value={keyTouched ? syncKey : status?.syncKeySet ? "••••••••" : ""}
          onChange={(e) => {
            setSyncKey(e.target.value);
            setKeyTouched(true);
          }}
          placeholder="Server API key (only if that server is locked)"
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
          aria-label="Sync server API key"
        />
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          What this device pulls from the server
        </legend>
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
            <input
              type="radio"
              name="sync-mode"
              checked={mode === "full"}
              onChange={() => setMode("full")}
              className="mt-0.5 h-4 w-4 accent-emerald-600"
            />
            <span>
              <span className="font-medium">Full library</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                Everything on the server syncs here automatically.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
            <input
              type="radio"
              name="sync-mode"
              checked={mode === "selective"}
              onChange={() => setMode("selective")}
              className="mt-0.5 h-4 w-4 accent-emerald-600"
            />
            <span>
              <span className="font-medium">Selected only</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                Only downloaded documents and folders stay in sync.
                {status && status.selection.docs.length + status.selection.folders.length > 0
                  ? ` (${status.selection.docs.length} docs · ${status.selection.folders.length} folders picked)`
                  : ""}
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      {status?.serverUrl && (
        <div>
          <button
            onClick={() => setBrowserOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <FolderOpen size={15} />
            Browse server library…
          </button>
        </div>
      )}
      <div>
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Save sync settings
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="rounded-lg border border-zinc-200 px-3 py-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
        {!status ? (
          <span className="flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" /> Loading sync status…
          </span>
        ) : !status.serverUrl ? (
          <span>
            Standalone mode — your library lives only on this device. Enter a
            server URL above to sync with your Docker server or another device.
          </span>
        ) : (
          <span className="space-y-1">
            <span className="block">
              {status.enabled ? "Syncing with " : "Paused — last synced with "}
              <span className="font-mono">{status.serverUrl}</span>
              {" · "}last sync {formatSyncTime(status.lastSyncAt)}
            </span>
            {last && (
              <span className="block">
                {last.ok
                  ? `${last.pushed} sent · ${last.pulled} received${last.conflicts > 0 ? ` · ${last.conflicts} conflict${last.conflicts === 1 ? "" : "s"} (newest won)` : ""}`
                  : `Last sync failed: ${last.error || "unknown error"}${
                      /401|Unauthorized/i.test(last.error || "")
                        ? " — that server is locked; enter its API key above."
                        : ""
                    }`}
                {status.pendingLocal > 0 && ` · ${status.pendingLocal} local change${status.pendingLocal === 1 ? "" : "s"} waiting`}
              </span>
            )}
            {skewMins !== null && Math.abs(skewMins) >= 5 && (
              <span className="block font-medium text-amber-600 dark:text-amber-400">
                Device clocks differ by ~{Math.abs(skewMins)} min — sync order
                follows timestamps, so enable automatic time on both devices.
              </span>
            )}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {status?.mode === "selective"
          ? "Selective mode: this device pulls only its picked documents and folders (settings always sync). Anything you create here still uploads to the server."
          : "Syncs documents, progress, bookmarks, highlights, folders, podcast scripts, settings, and reading stats. Audio cache and your API key stay on this device."}
      </p>
      {browserOpen && (
        <ServerBrowserModal
          onClose={() => setBrowserOpen(false)}
          onChanged={() => {
            void refresh();
            window.dispatchEvent(new Event("voxshelf:library-changed"));
          }}
        />
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
  const [testingKey, setTestingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<
    { ok: boolean; message: string } | null
  >(null);
  const [voice, setVoice] = useState("Kore");
  const [speed, setSpeed] = useState(1);
  const [ttsModel, setTtsModel] = useState("");
  const [textModel, setTextModel] = useState("");
  const [modelLists, setModelLists] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pronOpen, setPronOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

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

  async function testKey() {
    setTestingKey(true);
    setKeyStatus(null);
    try {
      const res = await api.models(
        keyTouched && apiKey.trim() ? apiKey : undefined,
      );
      if (res.live) {
        const count = res.ttsModels.length + res.textModels.length;
        const message = `Valid Key ✓ (${count} models active)`;
        setKeyStatus({ ok: true, message });
        setModelLists(res);
        setModelsError(null);
        toast.success(message);
      } else {
        const message = res.error || "Key check failed: no live models returned.";
        setKeyStatus({ ok: false, message });
        toast.error(message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Key check failed.";
      setKeyStatus({ ok: false, message });
      toast.error(message);
    } finally {
      setTestingKey(false);
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
      toast.success(`Import complete: ${res.imported} imported, ${res.skipped} skipped.`);
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
                    setKeyStatus(null);
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
              <button
                onClick={testKey}
                disabled={testingKey}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {testingKey ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <KeyRound size={14} />
                )}
                Test Key
              </button>
            </div>
            {keyStatus && (
              <div
                role="status"
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  keyStatus.ok
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                }`}
              >
                {keyStatus.message}
              </div>
            )}
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
              <div>
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Default voice
                </span>
                <div className="flex gap-2">
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    className={`${inputCls} min-h-[44px] flex-1`}
                    aria-label="Default voice"
                  >
                    {VOICE_NAMES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <VoicePreviewButton voice={voice} />
                </div>
              </div>
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

          <Section title="Library sync">
            <SyncSection />
          </Section>

          <Section title="Pronunciation">
            <button
              onClick={() => setPronOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <BookOpenText size={16} />
              Open Pronunciation Dictionary
            </button>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Fix how names and tricky words are spoken across every document.
            </p>
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

          <Section title="💰 Cost & pricing transparency">
            <div className="space-y-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-800">
              <p className="text-zinc-700 dark:text-zinc-300">
                <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Gemini Free Tier:
                </strong>{" "}
                free up to standard rate limits (15 RPM / 1M TPM) — plenty
                for everyday listening.
              </p>
              <p className="text-zinc-700 dark:text-zinc-300">
                <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Paid Tier:
                </strong>{" "}
                TTS ~$0.02 per 100k characters (a full novel is only a few
                cents!). Text/OCR ~$0.075 / 1M tokens.
              </p>
              <p className="text-zinc-700 dark:text-zinc-300">
                <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Value:
                </strong>{" "}
                Commercial TTS subscriptions often cost $100–$250/year, while
                VoxShelf with your Gemini API key is essentially free or pennies per month.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-zinc-100 px-2 py-2.5 dark:bg-zinc-800/70">
                <p className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {stats ? formatChars(stats.servedChars ?? 0) : "—"}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                  chars synthesized
                </p>
              </div>
              <div className="rounded-lg bg-zinc-100 px-2 py-2.5 dark:bg-zinc-800/70">
                <p className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {stats ? formatUsd(stats.estimatedCostUsd ?? 0) : "—"}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                  est. cost spent
                </p>
              </div>
              <div className="rounded-lg bg-emerald-100 px-2 py-2.5 dark:bg-emerald-950/60">
                <p className="text-base font-bold tabular-nums text-emerald-800 dark:text-emerald-300">
                  {stats ? formatUsd(stats.estimatedSavedUsd ?? 0) : "—"}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
                  saved by caching
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Every repeat play is served from your local disk cache instead of
              a billable API call, so re-listening is always free.
            </p>
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
      {pronOpen && <PronunciationModal onClose={() => setPronOpen(false)} />}
    </Modal>
  );
}
