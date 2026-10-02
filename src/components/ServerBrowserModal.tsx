"use client";

import { Check, Download, FolderOpen, Loader2, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { RemoteLibraryDto } from "@/lib/types";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

/** Browse the sync server's library and pick documents/folders for this device. */
export function ServerBrowserModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [remote, setRemote] = useState<RemoteLibraryDto | null>(null);
  const [localIds, setLocalIds] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [lib, local] = await Promise.all([
        api.syncRemoteLibrary(),
        api.listDocuments(),
      ]);
      setRemote(lib);
      setLocalIds(new Set(local.documents.map((d) => d.id)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the server library.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    if (!remote) return [];
    const q = query.trim().toLowerCase();
    if (!q) return remote.documents;
    return remote.documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.author || "").toLowerCase().includes(q),
    );
  }, [remote, query]);

  const groups = useMemo(() => {
    const byFolder = new Map<string | null, typeof filtered>();
    for (const d of filtered) {
      const list = byFolder.get(d.folderId) || [];
      list.push(d);
      byFolder.set(d.folderId, list);
    }
    const folderName = (fid: string | null): string | null => {
      if (!fid || !remote) return null;
      return remote.folders.find((f) => f.id === fid)?.name ?? "Unknown folder";
    };
    return [...byFolder.entries()]
      .map(([fid, docs]) => ({ folderId: fid, folderName: folderName(fid), docs }))
      .sort((a, b) => (a.folderName || "zzz").localeCompare(b.folderName || "zzz"));
  }, [filtered, remote]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFolder(ids: string[]) {
    setPicked((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function downloadPicked() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.syncDownload({ docIds: [...picked] });
      setPicked(new Set());
      await refresh();
      onChanged();
      toast.success(
        r.downloaded.length > 0
          ? `Downloaded ${r.downloaded.length} document${r.downloaded.length === 1 ? "" : "s"}.`
          : "Nothing new to download.",
      );
      if (r.missing.length > 0) {
        toast.error(`${r.missing.length} no longer on the server.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removePicked() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.syncRemove({ docIds: [...picked] });
      setPicked(new Set());
      await refresh();
      onChanged();
      toast.success(
        r.removed.length > 0
          ? `Removed ${r.removed.length} from this device (server keeps them).`
          : "Nothing to remove.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Server library" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or author…"
            className="w-full rounded-lg border border-zinc-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
            aria-label="Filter server documents"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!remote ? (
          <p className="flex items-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 size={15} className="animate-spin" /> Loading server library…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            {remote.documents.length === 0
              ? "The server library is empty."
              : "No documents match this filter."}
          </p>
        ) : (
          <div className="max-h-[46vh] space-y-4 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.folderId || "unfiled"}>
                <button
                  onClick={() => toggleFolder(g.docs.map((d) => d.id))}
                  className="mb-1 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <FolderOpen size={14} />
                  {g.folderName || "Unfiled"} ({g.docs.length})
                </button>
                <ul className="space-y-1">
                  {g.docs.map((d) => {
                    const onDevice = localIds.has(d.id);
                    const checked = picked.has(d.id);
                    return (
                      <li key={d.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-200 px-2.5 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(d.id)}
                            className="h-4 w-4 shrink-0 accent-emerald-600"
                            aria-label={`Select ${d.title}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {d.title}
                            </span>
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                              {d.author ? `${d.author} · ` : ""}
                              {d.wordCount.toLocaleString()} words
                            </span>
                          </span>
                          {onDevice && (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              <Check size={12} /> On device
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {picked.size} selected
            {remote ? ` · ${remote.documents.length} on server` : ""}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void removePicked()}
              disabled={busy || picked.size === 0}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Remove from device
            </button>
            <button
              onClick={() => void downloadPicked()}
              disabled={busy || picked.size === 0}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Download
            </button>
          </div>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Removing deletes from this device only — the server keeps everything.
          Downloads join this device&apos;s sync pick.
        </p>
      </div>
    </Modal>
  );
}
