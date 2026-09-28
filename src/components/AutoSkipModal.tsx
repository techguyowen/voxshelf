"use client";

import {
  Braces,
  Captions,
  FileText,
  Footprints,
  FunctionSquare,
  Heading1,
  Link2,
  Parentheses,
  Quote,
  Table2,
} from "lucide-react";
import type { AutoSkipMode, AutoSkipOptions } from "@/lib/autoSkip";
import { Modal } from "./Modal";

type SkipKey = Exclude<keyof AutoSkipOptions, "enabled" | "mode">;

const RULES: { key: SkipKey; icon: React.ReactNode; title: string; desc: string }[] = [
  { key: "skipHeaders", icon: <Heading1 size={17} />, title: "Headers", desc: "Titles, author lines, chapter headings" },
  { key: "skipFooters", icon: <Footprints size={17} />, title: "Footers", desc: "Page numbers and running footers" },
  { key: "skipFootnotes", icon: <FileText size={17} />, title: "Footnotes", desc: "Numbered notes and [1] markers" },
  { key: "skipTables", icon: <Table2 size={17} />, title: "Tables", desc: "Grids, pipes and data rows" },
  { key: "skipFormulas", icon: <FunctionSquare size={17} />, title: "Formulas", desc: "Math and LaTeX expressions" },
  { key: "skipCitations", icon: <Quote size={17} />, title: "Citations", desc: "(Author, 1995) references" },
  { key: "skipUrls", icon: <Link2 size={17} />, title: "URLs", desc: "Web links and addresses" },
  { key: "skipParentheses", icon: <Parentheses size={17} />, title: "Parentheses", desc: "Content inside (…)" },
  { key: "skipBrackets", icon: <Captions size={17} />, title: "Brackets", desc: "Content inside […], except footnotes" },
  { key: "skipBraces", icon: <Braces size={17} />, title: "Braces", desc: "Content inside {…}" },
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

export function AutoSkipModal({
  open,
  onClose,
  options,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  options: AutoSkipOptions;
  onChange: (next: AutoSkipOptions) => void;
}) {
  if (!open) return null;
  const set = (patch: Partial<AutoSkipOptions>) => onChange({ ...options, ...patch });

  return (
    <Modal title="Auto-Skip Content" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/60">
          <div>
            <p className="text-sm font-semibold">Auto-skip</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Boilerplate is omitted from audio and skipped during playback
            </p>
          </div>
          <Toggle on={options.enabled} onChange={(v) => set({ enabled: v })} label="Enable auto-skip" />
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Auto Skip Mode
          </span>
          <select
            value={options.mode}
            onChange={(e) => set({ mode: e.target.value as AutoSkipMode })}
            className="w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="ai">AI Enhanced</option>
            <option value="rules">Rule Based</option>
          </select>
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
            {options.mode === "ai"
              ? "Stricter detection with extra heuristics for messy scans."
              : "Conservative patterns only — skips less."}
          </span>
        </label>

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {RULES.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {r.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{r.desc}</span>
              </span>
              <Toggle
                on={options[r.key]}
                onChange={(v) => set({ [r.key]: v })}
                label={`Skip ${r.title.toLowerCase()}`}
              />
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
