"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect } from "react";

interface ShortcutGroup {
  name: string;
  items: Array<{ keys: string[]; description: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: "Playback & Navigation",
    items: [
      { keys: ["Space"], description: "Play / Pause playback" },
      { keys: ["←"], description: "Previous sentence" },
      { keys: ["→"], description: "Next sentence" },
      { keys: ["Shift", "←"], description: "Skip backward 15 seconds" },
      { keys: ["Shift", "→"], description: "Skip forward 15 seconds" },
      { keys: ["↑"], description: "Increase speed (+0.1×)" },
      { keys: ["↓"], description: "Decrease speed (-0.1×)" },
    ],
  },
  {
    name: "Reading & Study Tools",
    items: [
      { keys: ["R"], description: "Toggle Reading Ruler (Focus Line Mode)" },
      { keys: ["B"], description: "Bookmark current sentence" },
      { keys: ["A"], description: "Open AI Assistant Drawer (Ask AI, Quiz, Summary)" },
      { keys: ["P"], description: "Generate or open AI Multi-Voice Podcast" },
      { keys: ["?"], description: "Toggle keyboard shortcuts help" },
      { keys: ["Esc"], description: "Close modals and drawers" },
    ],
  },
];

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-xs animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl animate-scale-in dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <Keyboard size={19} />
            </div>
            <div>
              <h2 id="shortcuts-title" className="text-base font-semibold">
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Speed through reading with simple hotkeys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close shortcuts modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 max-h-[70vh] space-y-6 overflow-y-auto pr-1">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.name} className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {group.name}
              </h3>
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/80 bg-zinc-50/50 dark:divide-zinc-800/80 dark:border-zinc-800 dark:bg-zinc-950/40">
                {group.items.map((item) => (
                  <div
                    key={item.description}
                    className="flex items-center justify-between px-3.5 py-2 text-sm"
                  >
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {item.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-[24px] rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-center text-xs font-semibold text-zinc-800 shadow-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-zinc-200 pt-3 text-center text-xs text-zinc-400 dark:border-zinc-800">
          Press <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">?</kbd> anytime to open this guide
        </div>
      </div>
    </div>
  );
}
