"use client";

import {
  BookOpen,
  Camera,
  Cast,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  FileUp,
  Gauge,
  Globe,
  GraduationCap,
  Keyboard,
  LibraryBig,
  Mic,
  MoonStar,
  Newspaper,
  ClipboardPaste,
  Play,
  RefreshCcw,
  Sparkles,
  Split,
  Timer,
  Upload,
  Volume2,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";

const SEEN_KEY = "voxshelf_tutorial_seen";

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left dark:border-zinc-800 dark:bg-zinc-800/50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-zinc-600 dark:text-zinc-400">{body}</span>
      </span>
    </div>
  );
}

function Hero({
  icon,
  kicker,
  title,
  body,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-5 text-white sm:p-6 dark:from-emerald-500 dark:via-emerald-600 dark:to-teal-700 dark:text-zinc-950">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white dark:bg-zinc-950/15 dark:text-zinc-950">
          {icon}
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">{kicker}</p>
          <h3 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h3>
        </div>
      </div>
      <p className="mt-3 max-w-xl text-sm leading-relaxed opacity-90">{body}</p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </kbd>
  );
}

export function TutorialModal({
  onClose,
  onOpenImport,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenImport?: () => void;
  onOpenSettings?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SEEN_KEY) !== null;
  });

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const next = useCallback(() => setStep((s) => Math.min(5, s + 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  function toggleDontShow(checked: boolean) {
    setDontShow(checked);
    try {
      if (checked) window.localStorage.setItem(SEEN_KEY, "1");
      else window.localStorage.removeItem(SEEN_KEY);
    } catch {
      // Private browsing: the checkbox simply won't persist.
    }
  }

  const titles = [
    "Welcome",
    "Import",
    "Reader",
    "Cast",
    "Study",
    "Mastery",
  ];

  return (
    <Modal title="VoxShelf Guide & Tour" wide={true} onClose={onClose}>
      {/* Step indicators */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Tour steps">
        {titles.map((t, i) => (
          <button
            key={t}
            role="tab"
            aria-selected={step === i}
            aria-label={`Go to step ${i + 1}: ${t}`}
            onClick={() => setStep(i)}
            className={`flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
              step === i
                ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
                : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                step === i
                  ? "bg-white/25 dark:bg-zinc-950/20"
                  : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            >
              {i + 1}
            </span>
            {t}
          </button>
        ))}
      </div>

      {/* Slides */}
      <div className="min-h-72">
        {step === 0 && (
          <div className="flex flex-col gap-3">
            <Hero
              icon={<LibraryBig size={26} />}
              kicker="Step 1 of 6 · Start here"
              title="Welcome to VoxShelf"
              body="Your self-hostable audiobook studio. Turn anything you want to read into something you can hear — narrated by lifelike AI voices, anywhere, even offline."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Feature
                icon={<BookOpen size={18} />}
                title="Any text becomes an audiobook"
                body="Books, articles, docs, scans and notes — one library, one player."
              />
              <Feature
                icon={<Volume2 size={18} />}
                title="30 lifelike Gemini voices"
                body="Natural narration with per-book voice, speed and style."
              />
              <Feature
                icon={<CloudOff size={18} />}
                title="On-device offline playback"
                body="Download books to your device and listen with zero network."
              />
              <Feature
                icon={<RefreshCcw size={18} />}
                title="Two-way sync"
                body="Progress, bookmarks and devices stay in step across sessions."
              />
            </div>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="self-start rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                New here? Add your Gemini API key in Settings →
              </button>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <Hero
              icon={<Upload size={26} />}
              kicker="Step 2 of 6 · Get content in"
              title="6 Ways to Import Content"
              body="If you can read it, record it or point a camera at it — VoxShelf can narrate it. Pick whichever door fits."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Feature icon={<FileUp size={18} />} title="Files" body="PDF, EPUB, DOCX, TXT, Markdown and images." />
              <Feature icon={<Globe size={18} />} title="Web & Google Docs" body="Paste a URL or GDocs link — reader-mode extraction." />
              <Feature icon={<Mic size={18} />} title="Voice notes & live meetings" body="Record audio, get transcripts you can replay and study." />
              <Feature icon={<Newspaper size={18} />} title="RSS & newsletters" body="Subscribe to feeds and listen to every new issue." />
              <Feature icon={<Camera size={18} />} title="Camera OCR" body="Snap a page — on-device text recognition, no typing." />
              <Feature icon={<ClipboardPaste size={18} />} title="Paste text" body="Clipboard to audiobook in seconds. Zero friction." />
            </div>
            {onOpenImport && (
              <button
                onClick={onOpenImport}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.99] dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                <Upload size={16} /> Try Importing Now (I)
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <Hero
              icon={<Play size={26} />}
              kicker="Step 3 of 6 · Read & listen"
              title="Supercharged Reader & Dual Playback"
              body="A reader built for ears and eyes at once: follow along word-by-word, or lean back and let it perform."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Feature icon={<Waves size={18} />} title="Word-by-word karaoke highlighting" body="The text lights up as the voice speaks — never lose your place." />
              <Feature icon={<Split size={18} />} title="Original vs Gemini TTS switcher" body="Flip between the source recording and AI narration instantly." />
              <Feature icon={<Gauge size={18} />} title="Speed controls 0.5x–4.5x" body="Slow study crawl to full-speed review. Your pace, your call." />
              <Feature icon={<Timer size={18} />} title="Breath pauses & sleep timer" body="Natural sentence/paragraph pauses, plus a gentle fade to sleep." />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <Hero
              icon={<Cast size={26} />}
              kicker="Step 4 of 6 · Fiction comes alive"
              title="Fiction & Dialogue Voice Acting"
              body="Meet 🎭 Cast: VoxShelf detects characters in your story and gives each one their own voice — dialogue that feels performed, not read."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Feature icon={<Sparkles size={18} />} title="Automatic character detection" body="Gemini finds speakers line-by-line — no manual tagging." />
              <Feature icon={<Cast size={18} />} title="Complementary voice casting" body="Each character gets a distinct, fitting voice from the 30-voice roster." />
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
              <p className="font-semibold">How a scene sounds with 🎭 Cast on:</p>
              <p className="mt-1">
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Narrator (warm alto):</span>{" "}
                “The door creaked open.”
                <span className="font-semibold text-teal-700 dark:text-teal-300"> Mara (bright soprano):</span>{" "}
                “Who's there?”
                <span className="font-semibold text-emerald-700 dark:text-emerald-300"> Narrator:</span>{" "}
                “Only silence answered.”
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <Hero
              icon={<GraduationCap size={26} />}
              kicker="Step 5 of 6 · Learn faster"
              title="AI Study Companion & PKM Exports"
              body="Don't just finish books — keep them. Summaries, podcasts and quizzes generated from your own library, exported wherever you think."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Feature icon={<Sparkles size={18} />} title="Smart summaries" body="Chapter and whole-book recaps in seconds." />
              <Feature icon={<Mic size={18} />} title="2-host audio podcasts" body="Your document reborn as a lively two-voice discussion." />
              <Feature icon={<GraduationCap size={18} />} title="Interactive quizzes" body="Test yourself on what you just heard." />
              <Feature icon={<FileUp size={18} />} title="1-click PKM exports" body="Obsidian-ready markdown & Anki .tsv flashcards." />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-3">
            <Hero
              icon={<Keyboard size={26} />}
              kicker="Step 6 of 6 · Power user"
              title="Keyboard Shortcuts & Offline Mastery"
              body="Drive the whole app without touching the mouse — and take everything offline when you leave the network behind."
            />
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {[
                { keys: ["Space"], label: "Play / pause" },
                { keys: ["J", "K"], label: "Skip sentence back / forward" },
                { keys: ["[", "]"], label: "Slower / faster playback" },
                { keys: ["I"], label: "Open import" },
                { keys: ["?"], label: "Shortcuts cheat sheet" },
                { keys: ["📱"], label: "Download to Device for offline" },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50"
                >
                  <span className="flex gap-1">
                    {row.label.startsWith("Download") ? (
                      <span className="text-base">📱</span>
                    ) : (
                      row.keys.map((k) => <Kbd key={k}>{k}</Kbd>)
                    )}
                  </span>
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{row.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-zinc-900 p-3 text-xs text-zinc-200 dark:bg-zinc-100 dark:text-zinc-900">
              <MoonStar size={16} className="shrink-0" />
              Pro tip: pre-render audio + 📱 Download to Device before a flight, and your whole library works in airplane mode.
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-5 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => toggleDontShow(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          Don&apos;t show automatically on first visit
        </label>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={prev}
            disabled={step === 0}
            className="flex min-h-[44px] items-center gap-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {step + 1} / 6
          </span>
          {step < 5 ? (
            <button
              onClick={next}
              className="flex min-h-[44px] items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex min-h-[44px] items-center gap-1 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              Get Started
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
