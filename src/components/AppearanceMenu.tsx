"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "./ThemeContext";

export type CursorColor = "yellow" | "blue" | "green" | "purple" | "pink" | "orange";

export type AppearanceFont =
  | "georgia"
  | "merriweather"
  | "inter"
  | "atkinson"
  | "opendyslexic"
  | "jetbrains";

export interface AppearancePrefs {
  cursorColor: CursorColor;
  highlightSentence: boolean;
  font: AppearanceFont;
  autoPlay: boolean;
  clickToListen: boolean;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  cursorColor: "yellow",
  highlightSentence: true,
  font: "atkinson",
  autoPlay: false,
  clickToListen: true,
};

const APPEARANCE_KEY = "vf-appearance";

export function loadAppearance(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearancePrefs>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export const CURSOR_COLORS: { id: CursorColor; label: string; swatch: string }[] = [
  { id: "yellow", label: "Amber", swatch: "#facc15" },
  { id: "blue", label: "Sapphire", swatch: "#38bdf8" },
  { id: "green", label: "Emerald", swatch: "#34d399" },
  { id: "purple", label: "Violet", swatch: "#a78bfa" },
  { id: "pink", label: "Rose", swatch: "#fb7185" },
  { id: "orange", label: "Coral", swatch: "#fb923c" },
];

export const APPEARANCE_FONTS: { id: AppearanceFont; label: string; hint: string }[] = [
  { id: "georgia", label: "Georgia", hint: "Serif" },
  { id: "merriweather", label: "Merriweather", hint: "Serif" },
  { id: "inter", label: "Inter", hint: "Sans" },
  { id: "atkinson", label: "Atkinson Hyperlegible", hint: "Sans" },
  { id: "opendyslexic", label: "OpenDyslexic", hint: "Dyslexia-friendly" },
  { id: "jetbrains", label: "JetBrains Mono", hint: "Mono" },
];

export function appearanceFontClass(font: AppearanceFont): string {
  switch (font) {
    case "georgia":
      return "font-ap-georgia";
    case "merriweather":
      return "font-ap-merriweather";
    case "inter":
      return "font-ap-inter";
    case "opendyslexic":
      return "font-ap-dyslexic reader-dyslexic";
    case "jetbrains":
      return "font-ap-jetbrains";
    default:
      return "font-readable";
  }
}

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: "system", label: "System", icon: <Laptop size={15} /> },
  { id: "dark", label: "Dark", icon: <Moon size={15} /> },
  { id: "light", label: "Light", icon: <Sun size={15} /> },
];

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-emerald-600 dark:bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[1.375rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function AppearanceMenu({
  prefs,
  onChange,
  fontSize,
  lineHeight,
  onFontSize,
  onLineHeight,
}: {
  prefs: AppearancePrefs;
  onChange: (next: AppearancePrefs) => void;
  fontSize: number;
  lineHeight: number;
  onFontSize: (v: number) => void;
  onLineHeight: (v: number) => void;
}) {
  const { mode, setMode } = useTheme();
  const set = (patch: Partial<AppearancePrefs>) => onChange({ ...prefs, ...patch });

  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-200 bg-white p-4 animate-fade-up sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">App Theme</p>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              aria-pressed={mode === t.id}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                mode === t.id
                  ? "bg-white shadow text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Cursor / Highlight Color
        </p>
        <div className="flex gap-1.5">
          {CURSOR_COLORS.map((c) => (
            <button
              key={c.id}
              onClick={() => set({ cursorColor: c.id })}
              title={c.label}
              aria-label={`${c.label} cursor`}
              aria-pressed={prefs.cursorColor === c.id}
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform ${
                prefs.cursorColor === c.id
                  ? "border-zinc-900 scale-110 dark:border-white"
                  : "border-transparent hover:scale-105"
              }`}
              style={{ backgroundColor: c.swatch }}
            >
              {prefs.cursorColor === c.id && <Check size={14} className="text-zinc-900" />}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Font</span>
        <select
          value={prefs.font}
          onChange={(e) => set({ font: e.target.value as AppearanceFont })}
          className="w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {APPEARANCE_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} ({f.hint})
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Highlight Sentence</span>
          <Toggle on={prefs.highlightSentence} onChange={(v) => set({ highlightSentence: v })} label="Highlight active sentence" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">
            Auto-Play Audio
            <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Play file as soon as it opens
            </span>
          </span>
          <Toggle on={prefs.autoPlay} onChange={(v) => set({ autoPlay: v })} label="Auto-play audio on open" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">
            Click to Listen
            <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Start from any sentence on tap
            </span>
          </span>
          <Toggle on={prefs.clickToListen} onChange={(v) => set({ clickToListen: v })} label="Click sentence to play" />
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Size: {fontSize}px
        </span>
        <input
          type="range"
          min={14}
          max={30}
          step={1}
          value={fontSize}
          onChange={(e) => onFontSize(Number(e.target.value))}
          className="w-full"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Line height: {lineHeight.toFixed(1)}
        </span>
        <input
          type="range"
          min={1.3}
          max={2.6}
          step={0.1}
          value={lineHeight}
          onChange={(e) => onLineHeight(Number(e.target.value))}
          className="w-full"
        />
      </label>
    </div>
  );
}
