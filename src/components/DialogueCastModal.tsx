"use client";

import {
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Mic,
  RefreshCw,
  Sparkles,
  Users,
  Volume2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import type {
  CharacterVoiceAssignment,
  DialogueAnalysisResult,
  DocumentDetail,
} from "@/lib/types";
import { GEMINI_VOICES, VOICE_NAMES } from "@/lib/voices";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { VoicePreviewButton } from "./VoicePreviewButton";

export function DialogueCastModal({
  open,
  onClose,
  doc,
  onUpdateDoc,
}: {
  open: boolean;
  onClose: () => void;
  doc: DocumentDetail;
  onUpdateDoc: (updated: DocumentDetail) => void;
}) {
  const toast = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [savingVoice, setSavingVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dialogueActing = doc.dialogueActing;
  const isAnalyzed = Boolean(
    dialogueActing && dialogueActing.characters && dialogueActing.characters.length > 0,
  );
  const isEnabled = dialogueActing ? dialogueActing.enabled !== false : false;

  // Compute sentence count per character
  const sentenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!dialogueActing?.tags) return counts;
    for (const tag of dialogueActing.tags) {
      counts[tag.character] = (counts[tag.character] || 0) + 1;
    }
    return counts;
  }, [dialogueActing?.tags]);

  if (!open) return null;

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await api.analyzeDialogue(doc.id);
      const updated: DocumentDetail = {
        ...doc,
        dialogueActing: res.analysis,
      };
      onUpdateDoc(updated);
      toast.success(
        `Detected ${res.analysis.characters.length} characters & assigned voices!`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Dialogue detection failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleToggleEnabled() {
    if (!dialogueActing) return;
    const nextEnabled = !isEnabled;
    try {
      const res = await api.updateDialogueVoices(
        doc.id,
        dialogueActing.characters,
        nextEnabled,
      );
      const updated: DocumentDetail = {
        ...doc,
        dialogueActing: res.analysis,
      };
      onUpdateDoc(updated);
      toast.success(
        nextEnabled
          ? "Multi-voice dialogue acting enabled."
          : "Multi-voice dialogue acting disabled (using default voice).",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to toggle dialogue acting.",
      );
    }
  }

  async function handleVoiceChange(characterName: string, newVoice: string) {
    if (!dialogueActing) return;
    setSavingVoice(characterName);
    try {
      const updatedChars: CharacterVoiceAssignment[] =
        dialogueActing.characters.map((c) =>
          c.character === characterName ? { ...c, voice: newVoice } : c,
        );
      const res = await api.updateDialogueVoices(
        doc.id,
        updatedChars,
        dialogueActing.enabled !== false,
      );
      const updated: DocumentDetail = {
        ...doc,
        dialogueActing: res.analysis,
      };
      onUpdateDoc(updated);
      toast.success(`Updated ${characterName}'s voice to ${newVoice}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update character voice.",
      );
    } finally {
      setSavingVoice(null);
    }
  }

  return (
    <Modal title="🎭 Cast / Dialogue Acting" onClose={onClose} wide>
      <div className="space-y-6">
        {/* Header Description */}
        <div className="flex flex-col gap-2 rounded-xl bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-transparent p-4 sm:flex-row sm:items-center sm:justify-between dark:from-purple-950/30 dark:via-indigo-950/30">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-purple-900 dark:text-purple-200">
              <Sparkles size={16} className="text-purple-600 dark:text-purple-400" />
              Fiction & Multi-Character Voice Acting
            </h3>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Identify distinct speakers across dialogue and narration, assigning unique Gemini voices to each character.
            </p>
          </div>
          {isAnalyzed && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              title="Re-analyze dialogue and character attributions"
            >
              {analyzing ? (
                <Loader2 size={13} className="animate-spin text-purple-600" />
              ) : (
                <RefreshCw size={13} />
              )}
              {analyzing ? "Detecting…" : "Re-detect"}
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        )}

        {/* Not analyzed state */}
        {!isAnalyzed ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-purple-600 dark:bg-purple-950/70 dark:text-purple-300">
              <Users size={28} />
            </div>
            <h4 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              No Characters Detected Yet
            </h4>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              VoxShelf will analyze the {doc.sentenceCount} sentences in this document with Gemini 3.8 Flash, distinguish spoken dialogue from narration, and assign distinct AI voices to each character.
            </p>
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-600"
              >
                {analyzing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Detecting Characters & Attributing Dialogue…
                  </>
                ) : (
                  <>
                    <span role="img" aria-hidden="true">
                      🎭
                    </span>
                    Detect Characters & Assign Voices
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Analyzed state */
          <div className="space-y-5">
            {/* Toggle switch for dialogue acting */}
            <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="space-y-0.5">
                <label
                  htmlFor="multi-voice-toggle"
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  Enable Multi-Voice Dialogue Acting
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  When enabled, sentences will play using each character&apos;s assigned voice.
                </p>
              </div>
              <button
                id="multi-voice-toggle"
                role="switch"
                aria-checked={isEnabled}
                onClick={handleToggleEnabled}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isEnabled ? "bg-purple-600 dark:bg-purple-500" : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    isEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Character list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Cast & Voice Assignments ({dialogueActing?.characters.length ?? 0})
                </h4>
                <span className="text-xs text-zinc-400">
                  Default: {doc.voice}
                </span>
              </div>

              <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {dialogueActing?.characters.map((char) => {
                  const count = sentenceCounts[char.character] || 0;
                  const isNarrator = char.character.toLowerCase() === "narrator";
                  return (
                    <div
                      key={char.character}
                      className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      {/* Character Info */}
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                            isNarrator
                              ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                              : char.gender === "female"
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                : char.gender === "male"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300"
                                  : "bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300"
                          }`}
                        >
                          {isNarrator ? "📖" : char.character.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {char.character}
                            </span>
                            {char.gender && (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                {char.gender}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {count} {count === 1 ? "sentence" : "sentences"}
                            {isNarrator ? " (Narration & attribution)" : " (Dialogue)"}
                          </p>
                        </div>
                      </div>

                      {/* Voice Selection & Audition */}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 sm:w-56">
                          <select
                            value={char.voice}
                            onChange={(e) =>
                              handleVoiceChange(char.character, e.target.value)
                            }
                            disabled={savingVoice === char.character}
                            aria-label={`Voice for ${char.character}`}
                            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-900 outline-none transition focus:border-purple-500 focus:bg-white focus:ring-1 focus:ring-purple-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-purple-400 dark:focus:bg-zinc-900"
                          >
                            {GEMINI_VOICES.map((v) => (
                              <option key={v.name} value={v.name}>
                                {v.name} ({v.description})
                              </option>
                            ))}
                          </select>
                        </div>
                        <VoicePreviewButton
                          voice={char.voice}
                          className="h-8 w-8 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
