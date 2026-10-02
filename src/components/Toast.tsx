"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider.");
  return ctx;
}

const KIND_STYLE: Record<ToastKind, { bar: string; icon: ReactNode }> = {
  success: {
    bar: "border-emerald-500",
    icon: <CheckCircle2 size={17} className="shrink-0 text-emerald-500" />,
  },
  error: {
    bar: "border-red-500",
    icon: <XCircle size={17} className="shrink-0 text-red-500" />,
  },
  info: {
    bar: "border-sky-500",
    icon: <Info size={17} className="shrink-0 text-sky-500" />,
  },
};

const AUTO_DISMISS_MS = 4200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const msg = message.trim();
      if (!msg) return;
      idRef.current += 1;
      const id = idRef.current;
      setItems((list) => [...list.slice(-3), { id, kind, message: msg }]);
      window.setTimeout(() => {
        setItems((list) => list.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (m: string) => toast(m, "success"),
      error: (m: string) => toast(m, "error"),
      info: (m: string) => toast(m, "info"),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-28 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-8"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl border-l-4 ${KIND_STYLE[t.kind].bar} border-y border-r border-zinc-200 bg-white px-3.5 py-2.5 text-sm font-medium shadow-xl animate-fade-up dark:border-zinc-700 dark:bg-zinc-900`}
          >
            {KIND_STYLE[t.kind].icon}
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
