"use client";

import {
  Archive,
  BarChart3,
  BookOpen,
  Download,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Globe,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadTextFile, formatBytes, safeFilename } from "@/lib/client";
import {
  getOfflineDocument,
  listOfflineDocuments,
  removeDocumentFromDevice,
  saveDocumentToDevice,
} from "@/lib/offlineStore";
import { estimateSecondsLeft, formatDuration } from "@/lib/readingTime";
import type { DocumentSummary, Folder, SourceType } from "@/lib/types";
import { useUI } from "./AppShell";
import { Modal } from "./Modal";
import { PrerenderModal } from "./PrerenderModal";
import { useToast } from "./Toast";

const FOLDER_COLORS = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

function sourceBadge(source: SourceType): { label: string; icon: React.ReactNode } {
  switch (source) {
    case "file-pdf":
      return { label: "PDF", icon: <FileText size={12} /> };
    case "file-epub":
      return { label: "EPUB", icon: <BookOpen size={12} /> };
    case "file-docx":
      return { label: "DOCX", icon: <FileText size={12} /> };
    case "file-txt":
      return { label: "TXT", icon: <FileText size={12} /> };
    case "file-md":
      return { label: "MD", icon: <FileText size={12} /> };
    case "file-image":
      return { label: "Image", icon: <ScanLine size={12} /> };
    case "camera":
      return { label: "Scan", icon: <ScanLine size={12} /> };
    case "url-article":
      return { label: "Article", icon: <Globe size={12} /> };
    case "url-gdocs":
      return { label: "GDocs", icon: <Link2 size={12} /> };
    default:
      return { label: "Text", icon: <FileText size={12} /> };
  }
}

function progressPct(doc: DocumentSummary): number {
  if (doc.sentenceCount <= 1) return doc.progressSentenceIndex > 0 ? 100 : 0;
  return Math.min(
    100,
    Math.round((doc.progressSentenceIndex / (doc.sentenceCount - 1)) * 100),
  );
}

function readingTimeBadge(doc: DocumentSummary): string {
  const speed = Number.isFinite(doc.speed) && doc.speed > 0 ? doc.speed : 1;
  if (progressPct(doc) >= 100 || doc.wordCount <= 0) return "📖 Done";
  const frac =
    doc.sentenceCount > 1
      ? Math.min(1, Math.max(0, doc.progressSentenceIndex / (doc.sentenceCount - 1)))
      : 0;
  const wordsLeft = Math.round(doc.wordCount * (1 - frac));
  if (wordsLeft <= 0) return "📖 Done";
  return `📖 ${formatDuration(estimateSecondsLeft(wordsLeft, speed))} left @ ${speed.toFixed(1)}x`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Library() {
  const { openImport, openStats } = useUI();
  const toast = useToast();
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("updated");
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState("");
  const [folderModal, setFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[5]);
  const [folderBusy, setFolderBusy] = useState(false);
  const [prerenderDoc, setPrerenderDoc] = useState<DocumentSummary | null>(null);
  const [editDoc, setEditDoc] = useState<DocumentSummary | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [deviceMap, setDeviceMap] = useState<
    Record<string, { bytes: number; downloadedAt: string }>
  >({});
  const [onDeviceOnly, setOnDeviceOnly] = useState(false);
  const [deviceProg, setDeviceProg] = useState<
    Record<string, { done: number; total: number; bytes: number }>
  >({});
  const [offlineLib, setOfflineLib] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const refreshFolders = useCallback(async () => {
    try {
      const res = await api.listFolders();
      setFolders(res.folders);
    } catch {
      // Non-fatal: folder bar stays hidden.
    }
  }, []);

  const refreshDeviceMap = useCallback(async () => {
    try {
      const offline = await listOfflineDocuments();
      const map: Record<string, { bytes: number; downloadedAt: string }> = {};
      for (const o of offline) {
        map[o.id] = { bytes: o.bytes, downloadedAt: o.downloadedAt };
      }
      setDeviceMap(map);
    } catch {
      // Device storage unreadable; on-device badges stay hidden.
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOfflineLib(false);
    try {
      const res = await api.listDocuments({
        q: debouncedQ || undefined,
        tag: tag || undefined,
        sort,
        archived: showArchived,
        folder: folder || undefined,
      });
      setDocs(res.documents);
      setTags(res.tags);
    } catch (e) {
      // Server unreachable: fall back to books stored on this device.
      try {
        const offline = await listOfflineDocuments();
        if (offline.length > 0) {
          const details = await Promise.all(
            offline.map((o) => getOfflineDocument(o.id)),
          );
          const summaries: DocumentSummary[] = [];
          for (const d of details) {
            if (!d) continue;
            const {
              sentences: _sentences,
              bookmarks: _bookmarks,
              highlights: _highlights,
              stylePrompt: _stylePrompt,
              ...summary
            } = d;
            summaries.push(summary);
          }
          if (summaries.length > 0) {
            setDocs(summaries);
            setTags([]);
            setOfflineLib(true);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Fall through to the error state below.
      }
      setError(e instanceof Error ? e.message : "Failed to load library.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, tag, sort, showArchived, folder]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Sync downloads/removals land while Settings is open above us.
    const onChanged = () => {
      void refresh();
      void refreshFolders();
    };
    window.addEventListener("voxshelf:library-changed", onChanged);
    return () => window.removeEventListener("voxshelf:library-changed", onChanged);
  }, [refresh, refreshFolders]);

  useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  useEffect(() => {
    void refreshDeviceMap();
  }, [refreshDeviceMap]);

  const filtered = useMemo(
    () => (onDeviceOnly ? docs.filter((d) => deviceMap[d.id]) : docs),
    [docs, onDeviceOnly, deviceMap],
  );

  const activeQuery = debouncedQ || q.trim();
  const hasActiveFilters =
    activeQuery !== "" || tag !== "" || folder !== "";
  const folderName =
    folder === "unfiled"
      ? "Unfiled"
      : folders.find((f) => f.id === folder)?.name;

  function clearFilters() {
    setQ("");
    setDebouncedQ("");
    setTag("");
    setFolder("");
    setOnDeviceOnly(false);
  }

  function zeroResultsMessage(): string {
    if (activeQuery) return `No documents found matching '${activeQuery}'`;
    if (tag && folderName)
      return `No documents found tagged "${tag}" in ${folderName}`;
    if (tag) return `No documents found tagged "${tag}"`;
    if (folderName) return `No documents found in ${folderName}`;
    return "No documents found for these filters";
  }

  const onDeviceCount = useMemo(
    () => Object.keys(deviceMap).length,
    [deviceMap],
  );

  async function downloadToDevice(doc: DocumentSummary) {
    if (deviceProg[doc.id]) return;
    setDeviceProg((p) => ({ ...p, [doc.id]: { done: 0, total: 0, bytes: 0 } }));
    try {
      const detail = await api.getDocument(doc.id);
      await saveDocumentToDevice(detail, (done, total, bytes) => {
        setDeviceProg((p) => ({ ...p, [doc.id]: { done, total, bytes } }));
      });
      await refreshDeviceMap();
      toast.success(`"${doc.title}" saved to this device.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download to device failed.");
    } finally {
      setDeviceProg((p) => {
        const next = { ...p };
        delete next[doc.id];
        return next;
      });
    }
  }

  async function removeFromDevice(id: string) {
    try {
      await removeDocumentFromDevice(id);
      await refreshDeviceMap();
      toast.info("Removed from this device.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove download.");
    }
  }

  async function removeDoc(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This removes the document, progress and bookmarks. Cached audio is kept.`)) {
      return;
    }
    setBusyId(id);
    try {
      await api.deleteDocument(id);
      setDocs((d) => d.filter((x) => x.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchive(doc: DocumentSummary) {
    setBusyId(doc.id);
    try {
      const updated = await api.updateDocument(doc.id, {
        isArchived: !doc.isArchived,
      });
      if (!showArchived && updated.isArchived) {
        setDocs((d) => d.filter((x) => x.id !== doc.id));
      } else {
        setDocs((d) => d.map((x) => (x.id === doc.id ? updated : x)));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    setFolderBusy(true);
    try {
      const f = await api.createFolder(newFolderName.trim(), newFolderColor);
      setFolders((list) => [...list, f].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName("");
      setFolderModal(false);
      toast.success(`Folder "${f.name}" created.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create folder.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function removeFolder(id: string, name: string) {
    if (!confirm(`Delete folder "${name}"? Documents inside become unfiled.`)) return;
    try {
      await api.deleteFolder(id);
      setFolders((list) => list.filter((f) => f.id !== id));
      if (folder === id) setFolder("");
      else void refreshFolders();
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete folder.");
    }
  }

  async function moveDoc(doc: DocumentSummary, folderId: string | null) {
    setBusyId(doc.id);
    try {
      const updated = await api.updateDocument(doc.id, { folderId });
      const stillVisible =
        folder === "" ||
        (folder === "unfiled" ? updated.folderId === null : updated.folderId === folder);
      setDocs((d) =>
        stillVisible
          ? d.map((x) => (x.id === doc.id ? updated : x))
          : d.filter((x) => x.id !== doc.id),
      );
      void refreshFolders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move document.");
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(doc: DocumentSummary) {
    setEditDoc(doc);
    setEditTitle(doc.title);
    setEditAuthor(doc.author ?? "");
    setEditTags(doc.tags.join(", "));
  }

  async function saveEdit() {
    if (!editDoc || !editTitle.trim()) return;
    setEditBusy(true);
    try {
      const updated = await api.updateDocument(editDoc.id, {
        title: editTitle.trim(),
        author: editAuthor.trim() || null,
        tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setDocs((d) => d.map((x) => (x.id === editDoc.id ? updated : x)));
      setEditDoc(null);
      toast.success("Document details updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setEditBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelSelection() {
    setSelected(new Set());
    setSelectMode(false);
  }

  // Drop selected ids that are no longer in the list (deleted/moved away).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(docs.map((d) => d.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [docs]);

  async function moveSelected(folderId: string | null) {
    if (selected.size === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      const ids = [...selected];
      await Promise.all(ids.map((id) => api.updateDocument(id, { folderId })));
      setSelected(new Set());
      await refresh();
      await refreshFolders();
      toast.success(`Moved ${ids.length} document${ids.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move documents.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function exportSelected() {
    if (selected.size === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      const ids = [...selected];
      const details = await Promise.all(ids.map((id) => api.getDocument(id)));
      downloadTextFile(
        `voxshelf-export-${ids.length}-doc${ids.length === 1 ? "" : "s"}.json`,
        JSON.stringify(details, null, 2),
        "application/json",
      );
      toast.success(`Exported ${ids.length} document${ids.length === 1 ? "" : "s"} as JSON.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0 || batchBusy) return;
    const n = selected.size;
    if (
      !confirm(
        `Delete ${n} document${n === 1 ? "" : "s"}? This removes documents, progress and bookmarks. Cached audio is kept.`,
      )
    ) {
      return;
    }
    setBatchBusy(true);
    try {
      const ids = [...selected];
      const results = await Promise.allSettled(
        ids.map((id) => api.deleteDocument(id)),
      );
      const removed = new Set(
        ids.filter((_, i) => results[i].status === "fulfilled"),
      );
      const failed = ids.length - removed.size;
      setDocs((d) => d.filter((x) => !removed.has(x.id)));
      setSelected(new Set());
      if (failed > 0) toast.error(`${failed} of ${n} deletes failed.`);
      else toast.success(`Deleted ${n} document${n === 1 ? "" : "s"}.`);
    } finally {
      setBatchBusy(false);
    }
  }

  async function exportDoc(doc: DocumentSummary, format: "txt" | "md") {
    setBusyId(doc.id);
    try {
      const detail = await api.getDocument(doc.id);
      const body = detail.sentences.map((s) => s.text).join(format === "md" ? "\n\n" : " ");
      const text =
        format === "md"
          ? `# ${detail.title}\n\n${detail.author ? `*${detail.author}*\n\n` : ""}${body}\n`
          : `${detail.title}\n${detail.author || ""}\n\n${body}\n`;
      downloadTextFile(
        safeFilename(detail.title, format),
        text,
        format === "md" ? "text/markdown" : "text/plain",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={selected.size > 0 ? "pb-28 pt-5" : "pt-5"}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Library</h1>
        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {docs.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              if (selectMode) cancelSelection();
              else setSelectMode(true);
            }}
            aria-pressed={selectMode}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              selectMode
                ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
            title="Select multiple documents for batch actions"
          >
            {selectMode ? "Done" : "Select"}
          </button>
          <button
            onClick={openStats}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Reading stats, streaks and history"
          >
            <BarChart3 size={15} />
            <span className="hidden sm:inline">Reading Stats</span>
          </button>
          <button
            onClick={() => setView("grid")}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 ${view === "grid" ? "bg-zinc-200 dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
            aria-label="Grid view"
            title="Grid view"
          >
            <LayoutGrid size={17} />
          </button>
          <button
            onClick={() => setView("list")}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 ${view === "list" ? "bg-zinc-200 dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
            aria-label="List view"
            title="List view"
          >
            <List size={17} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Folders">
        <button
          onClick={() => setFolder("")}
          role="tab"
          aria-selected={folder === ""}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            folder === ""
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          All Documents
        </button>
        <button
          onClick={() => setFolder(folder === "unfiled" ? "" : "unfiled")}
          role="tab"
          aria-selected={folder === "unfiled"}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            folder === "unfiled"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          Unfiled
        </button>
        <button
          onClick={() => setOnDeviceOnly((v) => !v)}
          role="tab"
          aria-selected={onDeviceOnly}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            onDeviceOnly
              ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
          title="Show only books stored on this device"
        >
          📱 On Device
          {onDeviceCount > 0 && (
            <span className="opacity-70">({onDeviceCount})</span>
          )}
        </button>
        {folders.map((f) => (
          <span
            key={f.id}
            className={`flex min-h-[44px] shrink-0 items-center gap-1 rounded-full py-0.5 pl-3 pr-1 text-xs font-medium ${
              folder === f.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            <button
              onClick={() => setFolder(folder === f.id ? "" : f.id)}
              role="tab"
              aria-selected={folder === f.id}
              className="flex items-center gap-1.5 py-1"
            >
              <FolderIcon size={13} style={{ color: f.color || undefined }} />
              {f.name}
              {typeof f.documentCount === "number" && (
                <span className="opacity-60">({f.documentCount})</span>
              )}
            </button>
            <button
              onClick={() => void removeFolder(f.id, f.name)}
              className="rounded-full p-1 opacity-50 hover:bg-red-100 hover:text-red-600 hover:opacity-100 dark:hover:bg-red-950"
              title={`Delete folder "${f.name}"`}
              aria-label={`Delete folder "${f.name}"`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <button
          onClick={() => setFolderModal(true)}
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:border-emerald-500 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-emerald-400"
        >
          <FolderPlus size={13} /> New Folder
        </button>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, author, tags…"
            className="min-h-[44px] w-full rounded-lg border border-zinc-300 py-2 pl-9 pr-9 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {q && (
            <button
              onClick={() => {
                setQ("");
                setDebouncedQ("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="min-h-[44px] rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Sort"
          >
            <option value="updated">Recently Read / Updated</option>
            <option value="created">Date Added (Newest first)</option>
            <option value="title">Title (A → Z)</option>
            <option value="length-desc">Length (Longest first)</option>
            <option value="length-asc">Length (Shortest first)</option>
          </select>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${
              showArchived
                ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
                : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            }`}
            title="Show archived documents"
          >
            <Archive size={15} />
            <span className="hidden sm:inline">Archived</span>
          </button>
        </div>
      </div>

      {offlineLib && (
        <div className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
          Server unreachable — showing books stored on this device. Reading
          and listening work fully offline.
        </div>
      )}

      {tags.length > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setTag("")}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              tag === ""
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            All
          </button>
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? "" : t)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                tag === t
                  ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={18} /> Loading library…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}{" "}
          <button onClick={() => void refresh()} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        hasActiveFilters ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-14 text-center dark:border-zinc-700">
            <Search size={32} className="text-zinc-400" />
            <div>
              <p className="font-semibold">{zeroResultsMessage()}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Try a different search, or clear every filter to see the full
                library again.
              </p>
            </div>
            <button
              onClick={clearFilters}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              Clear Filters
            </button>
          </div>
        ) : onDeviceOnly ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-14 text-center dark:border-zinc-700">
            <div className="text-3xl">📱</div>
            <div>
              <p className="font-semibold">No books on this device yet</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Use “📱 Download to Device” on any book to read and listen
                with no network connection.
              </p>
            </div>
            <button
              onClick={() => setOnDeviceOnly(false)}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Show all documents
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-14 text-center dark:border-zinc-700">
            <BookOpen size={32} className="text-zinc-400" />
            <div>
              <p className="font-semibold">Your library is empty</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Import a PDF, article, scan or paste text to start listening.
              </p>
            </div>
            <button
              onClick={openImport}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              <Plus size={16} /> Import something
            </button>
          </div>
        )
      ) : (
        <div
          className={
            view === "grid"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              : "flex flex-col gap-2"
          }
        >
          {filtered.map((doc) => {
            const badge = sourceBadge(doc.sourceType);
            const pct = progressPct(doc);
            return (
              <article
                key={doc.id}
                className={`group rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${
                  selected.has(doc.id) ? "border-emerald-500 ring-1 ring-emerald-500" : ""
                }${
                  view === "list" ? "sm:flex sm:items-center sm:gap-4" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        className="h-5 w-5 shrink-0 cursor-pointer accent-emerald-600"
                        aria-label={`Select "${doc.title}"`}
                      />
                    )}
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {badge.icon}
                      {badge.label}
                    </span>
                    {doc.isArchived && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Archived
                      </span>
                    )}
                    {doc.folderId && (
                      <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        <FolderIcon
                          size={11}
                          style={{ color: folders.find((f) => f.id === doc.folderId)?.color || undefined }}
                        />
                        {folders.find((f) => f.id === doc.folderId)?.name || "Folder"}
                      </span>
                    )}
                    {doc.prerenderPct === 100 ? (
                      <span
                        className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        title="All sentences have cached audio — ready for offline listening"
                      >
                        <Zap size={11} /> Offline Ready
                      </span>
                    ) : typeof doc.prerenderPct === "number" && doc.prerenderPct > 0 ? (
                      <span
                        className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        title={`${doc.prerenderPct}% of sentences have cached audio`}
                      >
                        <Zap size={11} /> {doc.prerenderPct}%
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[11px] text-zinc-400">
                      {timeAgo(doc.updatedAt)}
                    </span>
                  </div>
                  <button
                    onClick={() => router.push(`/reader/${doc.id}`)}
                    className="mt-1.5 block w-full truncate text-left text-[15px] font-semibold hover:text-emerald-700 dark:hover:text-emerald-400"
                    title={doc.title}
                  >
                    {doc.title}
                  </button>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {doc.author || doc.voice} · {doc.wordCount.toLocaleString()} words ·{" "}
                    {doc.sentenceCount.toLocaleString()} sentences
                  </p>
                  <span
                    className="mt-1.5 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    title={`Estimated listening time remaining at ${doc.speed.toFixed(1)}x speed`}
                  >
                    {readingTimeBadge(doc)}
                  </span>
                  {doc.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {doc.tags.slice(0, 4).map((t) => (
                        <button
                          key={t}
                          onClick={() => setTag(t)}
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Reading progress"
                    >
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                        pct >= 100
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                          : pct > 0
                            ? "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                      title={`Sentence ${doc.progressSentenceIndex + 1} of ${doc.sentenceCount}`}
                    >
                      {pct >= 100 ? "✓ Finished" : pct > 0 ? `${pct}% read` : "○ New"}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    {deviceProg[doc.id] ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-sky-800 dark:bg-sky-950/70 dark:text-sky-300"
                        aria-live="polite"
                      >
                        <Loader2 size={11} className="animate-spin" />
                        📱 {deviceProg[doc.id].done.toLocaleString()}/
                        {deviceProg[doc.id].total.toLocaleString()} clips (
                        {formatBytes(deviceProg[doc.id].bytes)})
                      </span>
                    ) : deviceMap[doc.id] ? (
                      <button
                        onClick={() => void removeFromDevice(doc.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
                        title={`Saved on this device (${formatBytes(deviceMap[doc.id].bytes)}) — click to remove`}
                      >
                        📱 On Device ({formatBytes(deviceMap[doc.id].bytes)}) ·{" "}
                        <X size={11} />
                      </button>
                    ) : (
                      <button
                        onClick={() => void downloadToDevice(doc)}
                        disabled={offlineLib}
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-sky-100 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-sky-950 dark:hover:text-sky-300"
                        title={
                          offlineLib
                            ? "Reconnect to download this book to the device"
                            : "Download book + audio to this device"
                        }
                      >
                        📱 Download to Device
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`mt-3 flex items-center gap-1 sm:mt-0 ${
                    view === "grid" ? "border-t border-zinc-100 pt-2 dark:border-zinc-800" : "shrink-0 sm:border-0 sm:pt-0"
                  }`}
                >
                  <button
                    onClick={() => router.push(`/reader/${doc.id}`)}
                    className="flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {pct > 0 && pct < 100 ? "Resume" : pct >= 100 ? "Replay" : "Read"}
                  </button>
                  <select
                    value={doc.folderId || ""}
                    onChange={(e) => void moveDoc(doc, e.target.value || null)}
                    disabled={busyId === doc.id}
                    className="max-w-28 min-h-[44px] rounded-lg border border-zinc-200 px-1 py-1.5 text-xs text-zinc-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                    title="Move to folder"
                    aria-label={`Move "${doc.title}" to folder`}
                  >
                    <option value="">Unfiled</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => openEdit(doc)}
                    disabled={busyId === doc.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    title="✏️ Edit Details"
                    aria-label={`Edit details for "${doc.title}"`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setPrerenderDoc(doc)}
                    disabled={busyId === doc.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-zinc-500 hover:bg-amber-100 hover:text-amber-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-amber-950 dark:hover:text-amber-300"
                    title="Pre-render full audio"
                    aria-label={`Pre-render full audio for "${doc.title}"`}
                  >
                    <Zap size={16} />
                  </button>
                  <button
                    onClick={() => void exportDoc(doc, "txt")}
                    disabled={busyId === doc.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    title="Export as .txt"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={() => void toggleArchive(doc)}
                    disabled={busyId === doc.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    title={doc.isArchived ? "Unarchive" : "Archive"}
                  >
                    <Archive size={16} />
                  </button>
                  <button
                    onClick={() => void removeDoc(doc.id, doc.title)}
                    disabled={busyId === doc.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-zinc-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                    title="Delete"
                  >
                    {busyId === doc.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {folderModal && (
        <Modal title="New Folder" onClose={() => setFolderModal(false)}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Folder name
              </span>
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createFolder();
                }}
                placeholder="e.g. Research papers"
                maxLength={100}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Folder color
              </span>
              <div className="flex gap-2">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewFolderColor(c)}
                    aria-label={`Folder color ${c}`}
                    aria-pressed={newFolderColor === c}
                    className={`h-8 w-8 rounded-full border-2 transition-transform ${
                      newFolderColor === c
                        ? "border-zinc-900 scale-110 dark:border-white"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFolderModal(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => void createFolder()}
                disabled={folderBusy || !newFolderName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                {folderBusy && <Loader2 size={14} className="animate-spin" />}
                Create folder
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editDoc && (
        <Modal title="✏️ Edit Details" onClose={() => setEditDoc(null)}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Title
              </span>
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={300}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Author
              </span>
              <input
                value={editAuthor}
                onChange={(e) => setEditAuthor(e.target.value)}
                placeholder="Unknown author"
                maxLength={300}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Tags (comma-separated)
              </span>
              <input
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="e.g. fiction, favorites"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditDoc(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveEdit()}
                disabled={editBusy || !editTitle.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                {editBusy && <Loader2 size={14} className="animate-spin" />}
                Save changes
              </button>
            </div>
          </div>
        </Modal>
      )}

      {prerenderDoc && (
        <PrerenderModal
          docId={prerenderDoc.id}
          title={prerenderDoc.title}
          currentIdx={prerenderDoc.progressSentenceIndex}
          onClose={() => {
            setPrerenderDoc(null);
            void refresh();
          }}
        />
      )}

      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur animate-fade-up dark:border-zinc-700 dark:bg-zinc-900/95"
            role="toolbar"
            aria-label="Batch actions for selected documents"
          >
            <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
              {selected.size} selected
            </span>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              <FolderIcon size={14} />
              <select
                value=""
                disabled={batchBusy}
                onChange={(e) => {
                  void moveSelected(e.target.value || null);
                  e.target.value = "";
                }}
                className="cursor-pointer bg-transparent outline-none disabled:cursor-not-allowed dark:bg-zinc-900"
                aria-label="Move selected to folder"
              >
                <option value="" disabled>
                  Move to Folder
                </option>
                <option value="">Unfiled</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void exportSelected()}
              disabled={batchBusy}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {batchBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Export Selected (.json)
            </button>
            <button
              onClick={() => void deleteSelected()}
              disabled={batchBusy}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
            >
              <Trash2 size={14} />
              Delete Selected
            </button>
            <button
              onClick={cancelSelection}
              className="flex min-h-[44px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Cancel selection"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
