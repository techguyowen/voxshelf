"use client";

import { Loader2, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import { useToast } from "./Toast";

/** Full-screen gate shown when the server has API_KEY set and no valid cookie. */
export function UnlockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function unlock() {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.authLogin(key);
      toast.success("Unlocked.");
      onUnlock();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unlock failed.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <form
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950">
            <LockKeyhole size={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">VoxShelf is locked</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Enter this server&apos;s API key to continue.
            </p>
          </div>
        </div>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Server API key"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label="Server API key"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Unlock
        </button>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          The key is set by whoever runs this server (API_KEY). This device
          stays unlocked for 30 days.
        </p>
      </form>
    </div>
  );
}
