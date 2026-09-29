"use client";

import { CheckCircle2, Loader2, Pause, Play, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/client";
import {
  isDocumentOnDevice,
  removeDocumentFromDevice,
  saveDocumentToDevice,
} from "@/lib/offlineStore";
import type { DocumentDetail } from "@/lib/types";
import { Modal } from "./Modal";

type Phase = "working" | "paused" | "done" | "error";

/**
 * Rough WAV bytes-per-character heuristic (24 kHz 16-bit mono ≈ 48 KB/s at
 * ~800 chars/min) used only until real download bytes are known.
 */
const BYTES_PER_CHAR_ESTIMATE = 3.5;

export function DownloadToDeviceModal({
  doc,
  onClose,
  onDone,
}: {
  doc: DocumentDetail;
  onClose: () => void;
  onDone?: () => void;
}) {
  const total = doc.sentences.length;
  const [done, setDone] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [phase, setPhase] = useState<Phase>("working");
  const [error, setError] = useState<string | null>(null);
  const [wasOnDevice, setWasOnDevice] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const start = useCallback(() => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setError(null);
    setPhase("working");
    void saveDocumentToDevice(
      doc,
      (d, _t, b) => {
        // Monotonic: a resumed run re-reports from 0 while fast-forwarding
        // through already-cached clips.
        setDone((prev) => Math.max(prev, d));
        setBytes((prev) => Math.max(prev, b));
      },
      { signal: ctrl.signal },
    )
      .then(() => {
        if (!mountedRef.current) return;
        setPhase("done");
        doneRef.current?.();
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        if (ctrl.signal.aborted) return; // Pause / Cancel own the UI state.
        setError(e instanceof Error ? e.message : "Download failed.");
        setPhase("error");
      });
  }, [doc]);

  useEffect(() => {
    mountedRef.current = true;
    isDocumentOnDevice(doc.id)
      .then((s) => {
        if (mountedRef.current) setWasOnDevice(s.onDevice);
      })
      .catch(() => {});
    start();
    return () => {
      mountedRef.current = false;
      ctrlRef.current?.abort();
    };
  }, [doc.id, start]);

  function pause() {
    ctrlRef.current?.abort();
    setPhase("paused");
  }

  async function cancel() {
    ctrlRef.current?.abort();
    // Discard partial audio, but never delete a previously good copy.
    if (!wasOnDevice) {
      try {
        await removeDocumentFromDevice(doc.id);
      } catch {
        // Best-effort cleanup.
      }
    }
    onClose();
  }

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
  const estimatedTotal =
    done > 0 && bytes > 0
      ? Math.round((bytes / done) * total)
      : Math.round(doc.totalChars * BYTES_PER_CHAR_ESTIMATE);

  return (
    <Modal title="📱 Download to Device" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="truncate text-sm font-semibold">{doc.title}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString()} clips · {doc.wordCount.toLocaleString()}{" "}
            words · voice {doc.voice}
          </p>
        </div>

        <div
          className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Download progress"
        >
          <div
            className={`h-full rounded-full transition-all ${
              phase === "done" ? "bg-emerald-500" : "bg-sky-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {phase === "done" ? (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <span>
              📱 Saved on device! Ready for offline listening. (
              {formatBytes(bytes)} · {done.toLocaleString()} clips)
            </span>
          </div>
        ) : phase === "error" ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <XCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error || "Download failed."}</span>
          </div>
        ) : (
          <p
            className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300"
            aria-live="polite"
          >
            {phase === "paused" ? "Paused: " : "Downloading to device: "}
            {done.toLocaleString()} / {total.toLocaleString()} clips (
            {formatBytes(bytes)})
          </p>
        )}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {phase === "done" ? (
            <>Stored on this device: {formatBytes(bytes)}.</>
          ) : (
            <>
              Estimated storage size on device: ~
              {formatBytes(estimatedTotal)}. Missing audio is synthesized
              first, then every clip is stored in this browser.
            </>
          )}
        </p>

        <div className="flex items-center justify-end gap-2">
          {phase === "working" && (
            <>
              <button
                onClick={pause}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <Pause size={15} /> Pause
              </button>
              <button
                onClick={() => void cancel()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          )}
          {phase === "paused" && (
            <>
              <button
                onClick={start}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                <Play size={15} /> Resume
              </button>
              <button
                onClick={() => void cancel()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          )}
          {phase === "error" && (
            <>
              <button
                onClick={start}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                {done > 0 ? (
                  <>
                    <Play size={15} /> Resume
                  </>
                ) : (
                  <>
                    <Loader2 size={15} /> Retry
                  </>
                )}
              </button>
              <button
                onClick={() => void cancel()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          )}
          {phase === "done" && (
            <button
              onClick={onClose}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
