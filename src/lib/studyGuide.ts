import type { Bookmark, DocumentDetail, Highlight, QuizResult } from "./types";
import { detectChapters } from "./toc";

export interface StudyNotesInput {
  summary?: string;
  keyPoints?: string[];
  actionItems?: string[];
  notes?: string;
}

const COLOR_DOT: Record<string, string> = {
  yellow: "🟡",
  blue: "🔵",
  green: "🟢",
  purple: "🟣",
  pink: "🩷",
};

function yamlQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]+/g, " ")}"`;
}

function quoteLines(text: string): string[] {
  return text.split("\n").map((l) => `> ${l}`);
}

export function buildMasterStudyGuideMarkdown(input: {
  doc: DocumentDetail;
  studyNotes?: StudyNotesInput | null;
  highlights: Highlight[];
  bookmarks: Bookmark[];
  quiz?: QuizResult | null;
}): string {
  const { doc, highlights, bookmarks, quiz } = input;
  const studyNotes = input.studyNotes ?? null;
  const legacy = doc as DocumentDetail & {
    aiSummary?: string | null;
    aiNotes?: string | null;
  };
  const total = doc.sentenceCount || doc.sentences.length || 1;
  const lines: string[] = [
    "---",
    `title: ${yamlQuoted(doc.title)}`,
    `author: ${yamlQuoted(doc.author ?? "")}`,
    `source: ${yamlQuoted(doc.sourceUrl ?? doc.sourceType)}`,
    `words: ${doc.wordCount}`,
    `sentences: ${total}`,
    `exported_at: ${yamlQuoted(new Date().toISOString())}`,
    "tags: [voxshelf, study-guide]",
    "---",
    "",
    `# ${doc.title} — Study Guide`,
    "",
    `*Author: ${doc.author ?? "Unknown"} · ${doc.wordCount} words · ${total} sentences · Source: ${doc.sourceUrl ?? doc.sourceType}*`,
    "",
  ];

  const summary = studyNotes?.summary?.trim() || legacy.aiSummary?.trim();
  if (summary) {
    lines.push("## Executive Summary", "", summary, "");
  }

  if (studyNotes?.keyPoints?.length) {
    lines.push("## Key Takeaways", "");
    for (const p of studyNotes.keyPoints) lines.push(`- ${p}`);
    lines.push("");
  }

  if (studyNotes?.actionItems?.length) {
    lines.push("## Action Items", "");
    for (const a of studyNotes.actionItems) lines.push(`- [ ] ${a}`);
    lines.push("");
  }

  const notes = studyNotes?.notes?.trim() || legacy.aiNotes?.trim();
  if (notes) {
    lines.push("## Structured Notes", "", notes, "");
  }

  const chapters = detectChapters(doc.sentences);
  if (chapters.length) {
    lines.push("## Table of Contents", "");
    chapters.forEach((c, i) => {
      lines.push(
        `${i + 1}. ${c.title} *(sentences ${c.sentenceIdx + 1}–${c.sentenceEnd}, ${c.wordCount} words)*`,
      );
    });
    lines.push("");
  }

  const sortedH = [...highlights].sort((a, b) => a.sentenceIdx - b.sentenceIdx);
  if (sortedH.length) {
    lines.push("## Highlights & Annotations", "");
    sortedH.forEach((h, i) => {
      const dot = COLOR_DOT[h.color] ?? "⬜";
      lines.push(`### ${dot} ${i + 1}. Sentence ${h.sentenceIdx + 1} of ${total}`, "");
      lines.push(...quoteLines(h.text), "");
      const context = [
        doc.sentences[h.sentenceIdx - 1]?.text,
        doc.sentences[h.sentenceIdx + 1]?.text,
      ]
        .filter(Boolean)
        .join(" ");
      if (context) lines.push("**Context:**", "", `> *${context}*`, "");
      if (h.note) lines.push(`**Note:** ${h.note}`, "");
    });
  }

  if (bookmarks.length) {
    const sortedB = [...bookmarks].sort((a, b) => a.sentenceIdx - b.sentenceIdx);
    lines.push("## Bookmarks", "");
    for (const b of sortedB) {
      const quote =
        b.sentencePreview ?? doc.sentences[b.sentenceIdx]?.text ?? "";
      lines.push(`### 🔖 Sentence ${b.sentenceIdx + 1} of ${total}`, "");
      if (quote) lines.push(...quoteLines(quote), "");
      if (b.note) lines.push(`**Note:** ${b.note}`, "");
    }
  }

  if (quiz?.flashcards?.length) {
    lines.push("## Flashcards", "", "| Concept | Explanation |", "| --- | --- |");
    for (const f of quiz.flashcards) {
      const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/[\n\r]+/g, " ");
      lines.push(`| ${cell(f.front)} | ${cell(f.back)} |`);
    }
    lines.push("");
  }

  if (quiz?.questions?.length) {
    const letters = ["A", "B", "C", "D", "E", "F"];
    lines.push("## Practice Quiz", "");
    quiz.questions.forEach((q, i) => {
      lines.push(`### Q${i + 1}. ${q.question}`, "");
      q.options.forEach((o, j) => {
        lines.push(`${j + 1}. ${o}`);
      });
      lines.push("");
    });
    lines.push("## Answer Key & Explanations", "");
    quiz.questions.forEach((q, i) => {
      const letter = letters[q.answerIndex] ?? String(q.answerIndex + 1);
      lines.push(`**Q${i + 1}: ${letter}** — ${q.options[q.answerIndex] ?? ""}`);
      if (q.explanation) lines.push(`_${q.explanation}_`);
      lines.push("");
    });
  }

  return lines.join("\n");
}
