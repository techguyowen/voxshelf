"use client";

import { BookOpenText, Check, Eclipse, Laptop, Moon, Sparkles, Sun } from "lucide-react";
import type { ReaderPageWidth } from "@/lib/types";
import { useTheme, type ThemeMode } from "./ThemeContext";

export type CursorColor = "yellow" | "blue" | "green" | "purple" | "pink" | "orange" | "carolina";

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

const APPEARANCE_KEY = "vs-appearance";
const LEGACY_APPEARANCE_KEY = "vf-appearance";

export function loadAppearance(): AppearancePrefs {
  try {
    const raw =
      localStorage.getItem(APPEARANCE_KEY) ?? localStorage.getItem(LEGACY_APPEARANCE_KEY);
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
  { id: "carolina", label: "Carolina Blue", swatch: "#7bafd4" },
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
  { id: "carolina", label: "Carolina", icon: <Sparkles size={15} /> },
  { id: "oled", label: "OLED Black", icon: <Eclipse size={15} /> },
  { id: "light", label: "Light", icon: <Sun size={15} /> },
];

export const PAGE_WIDTH_OPTIONS: { id: ReaderPageWidth; label: string; hint: string }[] = [
  { id: "narrow", label: "Narrow", hint: "576px" },
  { id: "comfortable", label: "Comfortable", hint: "768px" },
  { id: "wide", label: "Wide", hint: "1024px" },
];

export function pageWidthClass(width: ReaderPageWidth): string {
  switch (width) {
    case "narrow":
      return "max-w-xl";
    case "wide":
      return "max-w-5xl";
    default:
      return "max-w-3xl";
  }
}

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
  bionicReading,
  focusMask,
  onBionicReading,
  onFocusMask,
  pageWidth,
  onPageWidth,
  onOpenPronunciations,
}: {
  prefs: AppearancePrefs;
  onChange: (next: AppearancePrefs) => void;
  fontSize: number;
  lineHeight: number;
  onFontSize: (v: number) => void;
  onLineHeight: (v: number) => void;
  bionicReading: boolean;
  focusMask: boolean;
  onBionicReading: (v: boolean) => void;
  onFocusMask: (v: boolean) => void;
  pageWidth: ReaderPageWidth;
  onPageWidth: (v: ReaderPageWidth) => void;
  onOpenPronunciations?: () => void;
}) {
  const { mode, setMode } = useTheme();
  const set = (patch: Partial<AppearancePrefs>) => onChange({ ...prefs, ...patch });

  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-200 bg-white p-4 animate-fade-up sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">App Theme</p>
        <div
          className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800"
          role="group"
          aria-label="App theme"
        >
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              aria-pressed={mode === t.id}
              title={t.id === "oled" ? "Pure-black theme for OLED screens and night reading" : t.label}
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
        <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">Page Width</p>
        <div
          className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800"
          role="radiogroup"
          aria-label="Reader page width"
        >
          {PAGE_WIDTH_OPTIONS.map((w) => {
            const active = pageWidth === w.id;
            return (
              <button
                key={w.id}
                role="radio"
                aria-checked={active}
                onClick={() => onPageWidth(w.id)}
                title={`${w.label} (${w.hint})`}
                className={`rounded-md px-2 py-1.5 text-xs font-medium ${
                  active
                    ? "bg-white shadow text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {w.label}
                <span className="block text-[10px] font-normal opacity-70">{w.hint}</span>
              </button>
            );
          })}
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

      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Font</span>
        <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Reader font">
          {APPEARANCE_FONTS.map((f) => {
            const active = prefs.font === f.id;
            return (
              <button
                key={f.id}
                role="radio"
                aria-checked={active}
                onClick={() => set({ font: f.id })}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    {f.label}
                    <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">
                      {f.hint}
                    </span>
                  </span>
                  {active && <Check size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
                </span>
                <span className={`mt-0.5 block truncate text-[15px] leading-snug ${appearanceFontClass(f.id)}`}>
                  The quick brown fox jumps
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">
            Bionic Reading
            <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Bold word starts for faster fixation
            </span>
          </span>
          <Toggle on={bionicReading} onChange={onBionicReading} label="Bionic reading" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">
            Focus Mask
            <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Dim every sentence except the active one
            </span>
          </span>
          <Toggle on={focusMask} onChange={onFocusMask} label="Focus mask" />
        </div>
      </div>

      {onOpenPronunciations && (
        <div className="sm:col-span-2">
          <button
            onClick={onOpenPronunciations}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <BookOpenText size={16} />
            Pronunciation Dictionary
          </button>
        </div>
      )}

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
