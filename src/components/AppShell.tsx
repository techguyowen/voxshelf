"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Header } from "./Header";
import { ImportModal } from "./ImportModal";
import { SettingsModal } from "./SettingsModal";

interface UIContextValue {
  openImport: () => void;
  openSettings: () => void;
  /** Bumped whenever settings are saved, so indicators refresh. */
  settingsRev: number;
  bumpSettings: () => void;
}

const UIContext = createContext<UIContextValue>({
  openImport: () => {},
  openSettings: () => {},
  settingsRev: 0,
  bumpSettings: () => {},
});

export function useUI() {
  return useContext(UIContext);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRev, setSettingsRev] = useState(0);

  const openImport = useCallback(() => setImportOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const bumpSettings = useCallback(
    () => setSettingsRev((r) => r + 1),
    [],
  );

  const value = useMemo(
    () => ({ openImport, openSettings, settingsRev, bumpSettings }),
    [openImport, openSettings, settingsRev, bumpSettings],
  );

  return (
    <UIContext.Provider value={value}>
      <Header
        onImport={openImport}
        onSettings={openSettings}
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
    </UIContext.Provider>
  );
}
