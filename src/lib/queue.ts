"use client";

import type { PlaybackQueueState, QueueItem } from "./types";

const QUEUE_KEY = "vs-playback-queue";

function defaultState(): PlaybackQueueState {
  return { items: [], autoAdvance: true };
}

function load(): PlaybackQueueState {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<PlaybackQueueState>;
    return {
      items: Array.isArray(parsed.items)
        ? parsed.items.filter(
            (i): i is QueueItem =>
              !!i && typeof i.docId === "string" && typeof i.title === "string",
          )
        : [],
      autoAdvance: parsed.autoAdvance !== false,
    };
  } catch {
    return defaultState();
  }
}

let state: PlaybackQueueState | null = null;
const listeners = new Set<(s: PlaybackQueueState) => void>();

function current(): PlaybackQueueState {
  if (!state) state = typeof window === "undefined" ? defaultState() : load();
  return state;
}

function persist(): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state));
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

function update(next: PlaybackQueueState): void {
  state = next;
  persist();
  emit();
}

export function getQueueState(): PlaybackQueueState {
  return current();
}

export function subscribeQueue(
  fn: (state: PlaybackQueueState) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function enqueueDocument(
  item: Omit<QueueItem, "addedAt">,
  position: "end" | "next" = "end",
): void {
  const s = current();
  const rest = s.items.filter((i) => i.docId !== item.docId);
  const full: QueueItem = { ...item, addedAt: new Date().toISOString() };
  update({
    ...s,
    items: position === "next" ? [full, ...rest] : [...rest, full],
  });
}

export function enqueueMultiple(items: Omit<QueueItem, "addedAt">[]): void {
  if (items.length === 0) return;
  const s = current();
  const seen = new Set(s.items.map((i) => i.docId));
  const fresh: QueueItem[] = [];
  for (const item of items) {
    if (seen.has(item.docId)) continue;
    seen.add(item.docId);
    fresh.push({ ...item, addedAt: new Date().toISOString() });
  }
  if (fresh.length === 0) return;
  update({ ...s, items: [...s.items, ...fresh] });
}

export function removeFromQueue(docId: string): void {
  const s = current();
  if (!s.items.some((i) => i.docId === docId)) return;
  update({ ...s, items: s.items.filter((i) => i.docId !== docId) });
}

export function moveQueueItem(docId: string, direction: "up" | "down"): void {
  const s = current();
  const idx = s.items.findIndex((i) => i.docId === docId);
  if (idx < 0) return;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= s.items.length) return;
  const items = [...s.items];
  [items[idx], items[swap]] = [items[swap], items[idx]];
  update({ ...s, items });
}

export function clearQueue(): void {
  const s = current();
  if (s.items.length === 0) return;
  update({ ...s, items: [] });
}

export function setQueueAutoAdvance(autoAdvance: boolean): void {
  const s = current();
  if (s.autoAdvance === autoAdvance) return;
  update({ ...s, autoAdvance });
}

export function popNextQueueItem(): QueueItem | null {
  const s = current();
  if (s.items.length === 0) return null;
  const [first, ...rest] = s.items;
  update({ ...s, items: rest });
  return first;
}
