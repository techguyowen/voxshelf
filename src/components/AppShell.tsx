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
import { FloatingMiniPlayer } from "./FloatingMiniPlayer";
import { Header } from "./Header";
import { ToastProvider } from "./Toast";
import { UnlockScreen } from "./UnlockScreen";
import { api } from "@/lib/client";
import { BatchAudiobookModal } from "./BatchAudiobookModal";
import { CommandPaletteModal } from "./CommandPaletteModal";
import { ImportModal } from "./ImportModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { QueueDrawer } from "./QueueDrawer";
import { SettingsModal } from "./SettingsModal";
import { StatsModal } from "./StatsModal";
import { TutorialModal } from "./TutorialModal";

interface UIContextValue {
  openImport: (tab?: string) => void;
  openSettings: () => void;
  /** Bumped whenever settings are saved, so indicators refresh. */
  settingsRev: number;
  bumpSettings: () => void;
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  openStats: () => void;
  openTutorial: () => void;
  openCommandPalette: () => void;
  openBatchAudiobook: () => void;
  openQueue: () => void;
}

const UIContext = createContext<UIContextValue>({
  openImport: () => {},
  openSettings: () => {},
  settingsRev: 0,
  bumpSettings: () => {},
  shortcutsOpen: false,
  openShortcuts: () => {},
  closeShortcuts: () => {},
  openStats: () => {},
  openTutorial: () => {},
  openCommandPalette: () => {},
  openBatchAudiobook: () => {},
  openQueue: () => {},
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
  const [importTab, setImportTab] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsRev, setSettingsRev] = useState(0);
  const [auth, setAuth] = useState<{ locked: boolean; authed: boolean } | null>(null);

  async function refreshAuth() {
    try {
      setAuth(await api.authStatus());
    } catch {
      // Status endpoint unreachable: render the app and let API calls surface it.
      setAuth({ locked: false, authed: true });
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  const openImport = useCallback((tab?: string) => {
    setImportTab(tab);
    setImportOpen(true);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const openStats = useCallback(() => setStatsOpen(true), []);
  const openTutorial = useCallback(() => setTutorialOpen(true), []);
  const openCommandPalette = useCallback(() => setCmdOpen(true), []);
  const openBatchAudiobook = useCallback(() => setBatchOpen(true), []);
  const openQueue = useCallback(() => setQueueOpen(true), []);
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

  // Handle PWA shortcut query params (?import=1&tab=..., ?batch=1, ?settings=1) on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    let handled = false;

    if (params.get("import") === "1") {
      const tab = params.get("tab") ?? undefined;
      openImport(tab);
      params.delete("import");
      params.delete("tab");
      handled = true;
    }
    if (params.get("batch") === "1") {
      openBatchAudiobook();
      params.delete("batch");
      handled = true;
    }
    if (params.get("settings") === "1") {
      openSettings();
      params.delete("settings");
      handled = true;
    }

    if (handled) {
      const qs = params.toString();
      const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [openImport, openBatchAudiobook, openSettings]);

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

  // Global Cmd/Ctrl+K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Global "I" opens Import; Cmd/Ctrl+I works even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isI = e.key === "i" || e.key === "I";
      if (!isI) return;
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod) {
        e.preventDefault();
        openImport();
        return;
      }
      if (e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      openImport();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openImport]);

  const value = useMemo(
    () => ({
      openImport,
      openSettings,
      settingsRev,
      bumpSettings,
      shortcutsOpen,
      openShortcuts,
      closeShortcuts,
      openStats,
      openTutorial,
      openCommandPalette,
      openBatchAudiobook,
      openQueue,
    }),
    [
      openImport,
      openSettings,
      settingsRev,
      bumpSettings,
      shortcutsOpen,
      openShortcuts,
      closeShortcuts,
      openStats,
      openTutorial,
      openCommandPalette,
      openBatchAudiobook,
      openQueue,
    ],
  );

  if (!auth) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (auth.locked && !auth.authed) {
    return (
      <ToastProvider>
        <UnlockScreen onUnlock={() => void refreshAuth()} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
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
      {importOpen && (
        <ImportModal
          initialTab={importTab}
          onClose={() => {
            setImportOpen(false);
            setImportTab(undefined);
          }}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={bumpSettings}
        />
      )}
      {shortcutsOpen && (
        <KeyboardShortcutsModal onClose={closeShortcuts} />
      )}
      {statsOpen && <StatsModal onClose={() => setStatsOpen(false)} />}
      {tutorialOpen && (
        <TutorialModal
          onClose={() => setTutorialOpen(false)}
          onOpenImport={() => {
            setTutorialOpen(false);
            openImport();
          }}
          onOpenSettings={() => {
            setTutorialOpen(false);
            openSettings();
          }}
        />
      )}
      {cmdOpen && (
        <CommandPaletteModal
          onClose={() => setCmdOpen(false)}
          onOpenImport={(tab) => {
            setCmdOpen(false);
            openImport(tab);
          }}
          onOpenBatchAudiobook={() => {
            setCmdOpen(false);
            setBatchOpen(true);
          }}
          onOpenSettings={() => {
            setCmdOpen(false);
            openSettings();
          }}
          onOpenStats={() => {
            setCmdOpen(false);
            openStats();
          }}
          onOpenShortcuts={() => {
            setCmdOpen(false);
            openShortcuts();
          }}
          onOpenTutorial={() => {
            setCmdOpen(false);
            openTutorial();
          }}
        />
      )}
      {batchOpen && <BatchAudiobookModal onClose={() => setBatchOpen(false)} />}
      {queueOpen && <QueueDrawer onClose={() => setQueueOpen(false)} />}
      <FloatingMiniPlayer />
    </UIContext.Provider>
    </ToastProvider>
  );
}
