"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ListVideo, Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  clearQueue,
  getQueueState,
  moveQueueItem,
  popNextQueueItem,
  removeFromQueue,
  setQueueAutoAdvance,
  subscribeQueue,
} from "@/lib/queue";
import type { PlaybackQueueState } from "@/lib/types";
import { Modal } from "./Modal";

export function QueueDrawer({
  onClose,
  currentDocId,
}: {
  onClose: () => void;
  currentDocId?: string;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<PlaybackQueueState>(() => getQueueState());

  useEffect(() => subscribeQueue(setQueue), []);

  const playNextNow = () => {
    const item = popNextQueueItem();
    if (!item) return;
    router.push(`/reader/${item.docId}?autoplay=1`);
    onClose();
  };

  const playNow = (docId: string) => {
    router.push(`/reader/${docId}?autoplay=1`);
    removeFromQueue(docId);
    onClose();
  };

  return (
    <Modal title="Listening Queue (Up Next)" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm dark:border-zinc-700">
            <input
              type="checkbox"
              checked={queue.autoAdvance}
              onChange={(e) => setQueueAutoAdvance(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            <span className="font-medium">Auto-advance to next queued document</span>
          </label>
          <button
            onClick={playNextNow}
            disabled={queue.items.length === 0}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            <Play size={16} /> Play Next Now
          </button>
          <button
            onClick={() => clearQueue()}
            disabled={queue.items.length === 0}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Trash2 size={16} /> Clear Queue
          </button>
        </div>

        {queue.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center dark:border-zinc-700">
            <ListVideo size={28} className="text-zinc-400" />
            <p className="text-sm font-semibold">Your queue is empty</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Queue books or articles from the Library with the queue button on
              any document, or press Cmd/Ctrl + K and use the Queue action on a
              search result. Queued documents play back-to-back.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {queue.items.map((item, i) => (
              <li
                key={item.docId}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {item.title}
                    {currentDocId === item.docId && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Now playing
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {item.author ?? "Unknown author"} · {item.sentenceCount.toLocaleString()} sentences
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={() => playNow(item.docId)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                    aria-label={`Play ${item.title} immediately`}
                    title="Play immediately"
                  >
                    <Play size={18} />
                  </button>
                  <button
                    onClick={() => moveQueueItem(item.docId, "up")}
                    disabled={i === 0}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    aria-label={`Move ${item.title} up`}
                    title="Move up"
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    onClick={() => moveQueueItem(item.docId, "down")}
                    disabled={i === queue.items.length - 1}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    aria-label={`Move ${item.title} down`}
                    title="Move down"
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    onClick={() => removeFromQueue(item.docId)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    aria-label={`Remove ${item.title} from queue`}
                    title="Remove"
                  >
                    <X size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
