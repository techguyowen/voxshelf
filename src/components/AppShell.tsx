"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Header } from "./Header";
import { ImportModal } from "./ImportModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { SettingsModal } from "./SettingsModal";

interface UIContextValue {
  openImport: () => void;
  openSettings: () => void;
  /** Bumped whenever settings are saved, so indicators refresh. */
  settingsRev: number;
  bumpSettings: () => void;
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;
}

const UIContext = createContext<UIContextValue>({
  openImport: () => {},
  openSettings: () => {},
  settingsRev: 0,
  bumpSettings: () => {},
  shortcutsOpen: false,
  openShortcuts: () => {},
  closeShortcuts: () => {},
});

export function useUI() {
  return useContext(UIContext);
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsRev, setSettingsRev] = useState(0);

  const openImport = useCallback(() => setImportOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const bumpSettings = useCallback(
    () => setSettingsRev((r) => r + 1),
    [],
  );

  // Register the PWA service worker (offline audio + assets).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  }, []);

  // Global "?" (Shift+/) toggles the shortcuts cheat sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setShortcutsOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(
    () => ({
      openImport,
      openSettings,
      settingsRev,
      bumpSettings,
      shortcutsOpen,
      openShortcuts,
      closeShortcuts,
    }),
    [
      openImport,
      openSettings,
      settingsRev,
      bumpSettings,
      shortcutsOpen,
      openShortcuts,
      closeShortcuts,
    ],
  );

  return (
    <UIContext.Provider value={value}>
      <Header
        onImport={openImport}
        onSettings={openSettings}
        onShortcuts={openShortcuts}
        settingsRev={settingsRev}
      />
      <main className="mx-auto w-full max-w-6xl px-3 pb-24 sm:px-6">
        {children}
      </main>
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={bumpSettings}
        />
      )}
      {shortcutsOpen && (
        <KeyboardShortcutsModal onClose={closeShortcuts} />
      )}
    </UIContext.Provider>
  );
}
