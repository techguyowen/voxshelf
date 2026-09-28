"use client";

import {
  Bookmark as BookmarkIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type {
  Bookmark,
  ChatMessage,
  DocumentDetail,
  Highlight,
  PodcastEpisode,
  QuizResult,
} from "@/lib/types";
import { formatDuration } from "@/lib/text";

type DrawerTab = "summary" | "explain" | "chat" | "quiz" | "cards" | "podcast" | "bookmarks" | "highlights";

const HIGHLIGHT_BADGE: Record<string, string> = {
  yellow: "bg-yellow-300 dark:bg-yellow-500",
  blue: "bg-sky-400 dark:bg-sky-500",
  green: "bg-emerald-400 dark:bg-emerald-500",
  purple: "bg-violet-400 dark:bg-violet-500",
  pink: "bg-rose-400 dark:bg-rose-500",
};

export interface TextSelection {
  text: string;
  context: string;
}

const SUGGESTED_QUESTIONS = [
  "What is the key takeaway?",
  "Explain this in simple terms",
  "List main arguments",
];

export function AIDrawer({
  open,
  onClose,
  doc,
  currentIdx,
  selection,
  bookmarks,
  onJump,
  onAddBookmark,
  onDeleteBookmark,
  highlights,
  onDeleteHighlight,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  doc: DocumentDetail;
  currentIdx: number;
  selection: TextSelection | null;
  bookmarks: Bookmark[];
  onJump: (idx: number) => void;
  onAddBookmark: (note: string) => void;
  onDeleteBookmark: (id: string) => void;
  highlights: Highlight[];
  onDeleteHighlight: (id: string) => void;
  initialTab?: DrawerTab;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab || "summary");
  const [summary, setSummary] = useState("");
  const [summaryLen, setSummaryLen] = useState<"short" | "detailed">("short");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [explainBusy, setExplainBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [listeningIdx, setListeningIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Quiz / flashcards state
  const [quiz, setQuiz] = useState<QuizResult | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [cardIdx, setCardIdx] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);

  // Podcast state
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [podcastBusy, setPodcastBusy] = useState(false);
  const [podcastLoaded, setPodcastLoaded] = useState(false);
  const [saveTranscript, setSaveTranscript] = useState(false);
  const [activeEpisode, setActiveEpisode] = useState<PodcastEpisode | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setSummary("");
    setExplanation("");
    setError(null);
    setMessages([]);
    setQuiz(null);
    setAnswers({});
    setCardIdx(0);
    setCardFlipped(false);
    setEpisodes([]);
    setPodcastLoaded(false);
    setActiveEpisode(null);
    audioRef.current?.pause();
    setListeningIdx(null);
  }, [doc.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, tab]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // When the user selects new text while the drawer is open, switch to Explain.
  useEffect(() => {
    if (open && selection) setTab("explain");
  }, [open, selection]);

  // Lazy-load saved podcast episodes when the tab opens.
  useEffect(() => {
    if (tab !== "podcast" || podcastLoaded) return;
    api
      .listPodcasts(doc.id)
      .then((out) => {
        setEpisodes(out.podcasts);
        setPodcastLoaded(true);
      })
      .catch(() => {
        // Non-fatal; user can still generate.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, doc.id]);

  async function generateSummary() {
    setSummaryBusy(true);
    setError(null);
    try {
      const out = await api.summarize({
        documentId: doc.id,
        length: summaryLen,
      });
      setSummary(out.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summary failed.");
    } finally {
      setSummaryBusy(false);
    }
  }

  async function explain() {
    if (!selection) return;
    setExplainBusy(true);
    setError(null);
    try {
      const out = await api.explain(selection.text, selection.context);
      setExplanation(out.explanation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Explanation failed.");
    } finally {
      setExplainBusy(false);
    }
  }

  async function sendChat(question?: string) {
    const q = (question ?? chatInput).trim();
    if (!q || chatBusy) return;
    setChatInput("");
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setChatBusy(true);
    try {
      const out = await api.chat({
        documentId: doc.id,
        messages: next.slice(0, -1),
        userQuestion: q,
      });
      setMessages([...next, { role: "assistant", content: out.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally {
      setChatBusy(false);
    }
  }

  async function listenTo(text: string, idx: number) {
    try {
      if (listeningIdx === idx && audioRef.current) {
        audioRef.current.pause();
        setListeningIdx(null);
        return;
      }
      audioRef.current?.pause();
      setListeningIdx(idx);
      setError(null);
      const res = await api.tts({ text: text.slice(0, 4000) });
      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.src = res.url;
      audio.onended = () => setListeningIdx(null);
      audio.onerror = () => {
        setListeningIdx(null);
        setError("Could not play that answer aloud.");
      };
      await audio.play();
    } catch (e) {
      setListeningIdx(null);
      setError(e instanceof Error ? e.message : "Listen failed.");
    }
  }

  async function generateQuiz() {
    setQuizBusy(true);
    setError(null);
    setAnswers({});
    setCardIdx(0);
    setCardFlipped(false);
    try {
      const out = await api.quiz({ documentId: doc.id });
      setQuiz(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quiz generation failed.");
    } finally {
      setQuizBusy(false);
    }
  }

  async function generatePodcast() {
    setPodcastBusy(true);
    setError(null);
    try {
      const episode = await api.podcast({ documentId: doc.id, saveAsDocument: saveTranscript });
      setEpisodes((list) => [episode, ...list]);
      setActiveEpisode(episode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Podcast generation failed.");
    } finally {
      setPodcastBusy(false);
    }
  }

  const score = quiz
    ? quiz.questions.reduce(
        (n, q, i) => n + (answers[i] === q.answerIndex ? 1 : 0),
        0,
      )
    : 0;
  const answered = Object.keys(answers).length;

  if (!open) return null;

  const tabs: { id: DrawerTab; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "explain", label: "Explain" },
    { id: "chat", label: "Chat" },
    { id: "quiz", label: "Quiz" },
    { id: "cards", label: "Cards" },
    { id: "podcast", label: "Podcast" },
    { id: "bookmarks", label: `Saved (${bookmarks.length})` },
    { id: "highlights", label: `Highlights (${highlights.length})` },
  ];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="AI assistant">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl animate-fade-up dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Sparkles size={17} className="text-emerald-600 dark:text-emerald-400" />
            AI Assistant
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Close assistant"
          >
            <X size={19} />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === t.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          {tab === "summary" && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                One-click summary of “{doc.title}”.
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={summaryLen}
                  onChange={(e) => setSummaryLen(e.target.value as "short" | "detailed")}
                  className="rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="short">Short</option>
                  <option value="detailed">Detailed</option>
                </select>
                <button
                  onClick={() => void generateSummary()}
                  disabled={summaryBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                >
                  {summaryBusy && <Loader2 size={15} className="animate-spin" />}
                  {summary ? "Regenerate" : "Summarize"}
                </button>
              </div>
              {summaryBusy && !summary ? (
                <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
                  <Loader2 className="animate-spin" size={16} /> Reading document…
                </div>
              ) : summary ? (
                <div className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-sm leading-relaxed dark:bg-zinc-800/60">
                  {summary}
                </div>
              ) : null}
            </div>
          )}

          {tab === "explain" && (
            <div className="space-y-3">
              {selection ? (
                <>
                  <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      Selected
                    </p>
                    <p className="mt-1 text-sm font-medium">“{selection.text}”</p>
                  </div>
                  <button
                    onClick={() => void explain()}
                    disabled={explainBusy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {explainBusy && <Loader2 size={15} className="animate-spin" />}
                    Explain this
                  </button>
                  {explanation && (
                    <div className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-sm leading-relaxed dark:bg-zinc-800/60">
                      {explanation}
                    </div>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Select any word or phrase in the reader, then come back here
                  for an instant explanation.
                </p>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {messages.length === 0 ? (
                <div className="space-y-3 py-4">
                  <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                    Ask anything about “{doc.title}”. Answers stay grounded in
                    the document.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => void sendChat(q)}
                        disabled={chatBusy}
                        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-emerald-400"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-xl p-3 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "ml-8 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "mr-4 bg-zinc-50 dark:bg-zinc-800/60"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.role === "assistant" && (
                        <button
                          onClick={() => void listenTo(m.content, i)}
                          className="mt-2 flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          {listeningIdx === i ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Volume2 size={13} />
                          )}
                          {listeningIdx === i ? "Playing…" : "🔊 Listen"}
                        </button>
                      )}
                    </div>
                  ))}
                  {chatBusy && (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <Loader2 className="animate-spin" size={15} /> Thinking…
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) void sendChat();
                  }}
                  placeholder="Ask about this document…"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label="Ask a question"
                />
                <button
                  onClick={() => void sendChat()}
                  disabled={chatBusy || !chatInput.trim()}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  aria-label="Send question"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          )}

          {tab === "quiz" && (
            <div className="space-y-3">
              {!quiz ? (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Test yourself with 5 AI-generated questions about “{doc.title}”.
                  </p>
                  <button
                    onClick={() => void generateQuiz()}
                    disabled={quizBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {quizBusy && <Loader2 size={15} className="animate-spin" />}
                    {quizBusy ? "Writing questions…" : "Generate quiz"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">
                      Score: {score}/{quiz.questions.length}
                      <span className="ml-2 font-normal text-zinc-500">
                        ({answered} answered)
                      </span>
                    </p>
                    <button
                      onClick={() => void generateQuiz()}
                      disabled={quizBusy}
                      className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <RotateCcw size={13} /> New quiz
                    </button>
                  </div>
                  {quiz.questions.map((q, qi) => {
                    const picked = answers[qi];
                    const done = picked !== undefined;
                    return (
                      <div
                        key={qi}
                        className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                      >
                        <p className="text-sm font-semibold">
                          {qi + 1}. {q.question}
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {q.options.map((opt, oi) => {
                            const isAnswer = oi === q.answerIndex;
                            const isPicked = picked === oi;
                            return (
                              <button
                                key={oi}
                                disabled={done}
                                onClick={() =>
                                  setAnswers((a) => ({ ...a, [qi]: oi }))
                                }
                                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-default ${
                                  done && isAnswer
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                                    : done && isPicked
                                      ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
                                      : "border-zinc-200 hover:border-emerald-400 dark:border-zinc-800"
                                }`}
                              >
                                {done && isAnswer ? (
                                  <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                                ) : done && isPicked ? (
                                  <XCircle size={15} className="shrink-0 text-red-500" />
                                ) : (
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-xs dark:border-zinc-700">
                                    {String.fromCharCode(65 + oi)}
                                  </span>
                                )}
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                        {done && q.explanation && (
                          <p className="mt-2 rounded-lg bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                            {picked === q.answerIndex ? "Correct! " : "Not quite. "}
                            {q.explanation}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {tab === "cards" && (
            <div className="space-y-3">
              {!quiz ? (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Generate flashcards for active recall on “{doc.title}”.
                  </p>
                  <button
                    onClick={() => void generateQuiz()}
                    disabled={quizBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                  >
                    {quizBusy && <Loader2 size={15} className="animate-spin" />}
                    {quizBusy ? "Making cards…" : "Generate flashcards"}
                  </button>
                </div>
              ) : quiz.flashcards.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">
                  No flashcards were generated. Try again.
                </p>
              ) : (
                <>
                  <button
                    onClick={() => setCardFlipped((f) => !f)}
                    className="flex min-h-[12rem] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-zinc-200 bg-zinc-50 p-6 text-center transition-colors hover:border-emerald-400 dark:border-zinc-800 dark:bg-zinc-800/40"
                    aria-label={cardFlipped ? "Show concept" : "Reveal explanation"}
                  >
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      {cardFlipped ? "Explanation" : "Concept"} · {cardIdx + 1}/
                      {quiz.flashcards.length}
                    </span>
                    <span className="text-base font-semibold leading-relaxed">
                      {cardFlipped
                        ? quiz.flashcards[cardIdx].back
                        : quiz.flashcards[cardIdx].front}
                    </span>
                    <span className="mt-2 text-xs text-zinc-400">
                      Tap to flip
                    </span>
                  </button>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => {
                        setCardIdx((i) => (i - 1 + quiz.flashcards.length) % quiz.flashcards.length);
                        setCardFlipped(false);
                      }}
                      className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      aria-label="Previous card"
                    >
                      <ChevronLeft size={15} /> Prev
                    </button>
                    <button
                      onClick={() => void generateQuiz()}
                      disabled={quizBusy}
                      className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <RotateCcw size={13} /> New set
                    </button>
                    <button
                      onClick={() => {
                        setCardIdx((i) => (i + 1) % quiz.flashcards.length);
                        setCardFlipped(false);
                      }}
                      className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      aria-label="Next card"
                    >
                      Next <ChevronRight size={15} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "podcast" && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Turn “{doc.title}” into a 2-host AI podcast (Alex & Sam).
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={saveTranscript}
                  onChange={(e) => setSaveTranscript(e.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
                Also save transcript as a new document
              </label>
              <button
                onClick={() => void generatePodcast()}
                disabled={podcastBusy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
              >
                {podcastBusy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Mic size={15} />
                )}
                {podcastBusy
                  ? "Generating podcast… (this takes a while)"
                  : "🎙️ Generate AI Podcast"}
              </button>

              {activeEpisode?.audioUrl && (
                <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <p className="text-sm font-semibold">{activeEpisode.title}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {activeEpisode.lines.length} lines ·{" "}
                    {formatDuration(activeEpisode.durationMs)}
                  </p>
                  <audio
                    key={activeEpisode.id}
                    controls
                    src={activeEpisode.audioUrl}
                    className="w-full"
                  />
                  <div className="max-h-56 space-y-2 overflow-y-auto pt-1">
                    {activeEpisode.lines.map((l, i) => (
                      <p key={i} className="text-xs leading-relaxed">
                        <span
                          className={`font-semibold ${l.speaker === "Alex" ? "text-emerald-700 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400"}`}
                        >
                          {l.speaker}:
                        </span>{" "}
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {l.text}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {episodes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Episodes for this document
                  </p>
                  {episodes.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => setActiveEpisode(ep)}
                      className={`block w-full rounded-xl border p-3 text-left ${
                        activeEpisode?.id === ep.id
                          ? "border-emerald-500"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <p className="text-sm font-semibold">{ep.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {ep.lines.length} lines · {formatDuration(ep.durationMs)} ·{" "}
                        {new Date(ep.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "highlights" && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Highlights &amp; notes for “{doc.title}”. Select text in the
                reader to add one.
              </p>
              {highlights.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No highlights yet. Select any passage in the reader and pick
                  a color.
                </p>
              ) : (
                <ul className="space-y-2">
                  {highlights.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <button
                        onClick={() => onJump(h.sentenceIdx)}
                        className="block w-full text-left"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <span
                            className={`inline-block h-3 w-3 rounded-full ${HIGHLIGHT_BADGE[h.color] || HIGHLIGHT_BADGE.yellow}`}
                            aria-hidden="true"
                          />
                          Sentence {h.sentenceIdx + 1}
                        </span>
                        <span className="mt-1 flex items-start gap-1.5 text-sm">
                          <Highlighter size={14} className="mt-0.5 shrink-0 text-zinc-400" />
                          <span className="line-clamp-3">“{h.text}”</span>
                        </span>
                        {h.note && (
                          <span className="mt-1.5 block rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            {h.note}
                          </span>
                        )}
                      </button>
                      <div className="mt-1.5 flex justify-end">
                        <button
                          onClick={() => onDeleteHighlight(h.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "bookmarks" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={`Note for sentence ${currentIdx + 1} (optional)`}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  onClick={() => {
                    onAddBookmark(note);
                    setNote("");
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <BookmarkIcon size={14} /> Add
                </button>
              </div>
              {bookmarks.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No bookmarks yet. Bookmark the sentence you’re on to find it
                  again later.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bookmarks.map((b) => (
                    <li
                      key={b.id}
                      className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <button
                        onClick={() => onJump(b.sentenceIdx)}
                        className="block w-full text-left"
                      >
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Sentence {b.sentenceIdx + 1}
                        </p>
                        {b.note && (
                          <p className="mt-0.5 text-sm font-medium">{b.note}</p>
                        )}
                        {b.sentencePreview && (
                          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                            {b.sentencePreview}
                          </p>
                        )}
                      </button>
                      <div className="mt-1.5 flex justify-end">
                        <button
                          onClick={() => onDeleteBookmark(b.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
