"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";
export type ThemeMode = "system" | "light" | "dark";

function resolveSystem(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

const ThemeContext = createContext<{
  theme: Theme;
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}>({
  theme: "dark",
  mode: "system",
  toggle: () => {},
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function loadMode(): ThemeMode {
  try {
    const stored = localStorage.getItem("vf-theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setModeState(loadMode());
  }, []);

  useEffect(() => {
    const apply = () => {
      setTheme(mode === "system" ? resolveSystem() : mode);
    };
    apply();
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("vf-theme", mode);
    } catch {
      // private mode etc.
    }
  }, [theme, mode]);

  const toggle = useCallback(() => {
    setModeState((m) => {
      if (m === "system") return resolveSystem() === "dark" ? "light" : "dark";
      return m === "dark" ? "light" : "dark";
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  return (
    <ThemeContext.Provider value={{ theme, mode, toggle, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
