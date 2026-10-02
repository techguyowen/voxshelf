// Table-of-contents chapter detection shared by TOCDrawer and ReaderView.

import { countWords } from "./readingTime";

export interface Chapter {
  /** 0-based chapter number. */
  index: number;
  /** Display title (markdown markers stripped). */
  title: string;
  /** Sentence index where the chapter starts (inclusive). */
  sentenceIdx: number;
  /** Sentence index where the chapter ends (exclusive). */
  sentenceEnd: number;
  /** Total words spanned by the chapter. */
  wordCount: number;
}

/** Fallback section size when a document has no explicit headings. */
export const TOC_FALLBACK_SECTION_SIZE = 30;

const MARKDOWN_HEADING = /^#{1,6}\s+\S/;
const CHAPTER_MARK = /^(chapter|section|part)\s+\d+/i;
// Roman-numeral markers ("II. The Middle", "IV The End"). Single bare "I " is
// excluded so first-person prose ("I went…") never becomes a chapter.
const ROMAN_MARK = /^(?:[IVXLCDM]{2,}\.?|[IVXLCDM]\.)\s+\S/;
// Short all-caps lines ("THE DARK FOREST", "EPILOGUE — 1999").
const ALLCAPS_LINE = /^[A-Z][A-Z0-9\s:—–\-'’"“”.!?&,()]{3,40}$/;

/** Short uppercase line ending with a colon ("PROLOGUE:", "DAY ONE:"). */
function isColonHeading(t: string): boolean {
  if (!t.endsWith(":")) return false;
  if (t.length < 4 || t.length > 60) return false;
  if (t !== t.toUpperCase()) return false;
  if (!/[A-Z]/.test(t)) return false;
  return true;
}

export function isHeadingText(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (MARKDOWN_HEADING.test(t)) return true;
  if (CHAPTER_MARK.test(t)) return true;
  if (ROMAN_MARK.test(t)) return true;
  if (ALLCAPS_LINE.test(t)) return true;
  if (isColonHeading(t)) return true;
  return false;
}

function cleanTitle(raw: string): string {
  return raw.trim().replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ");
}

/**
 * Scan sentences for chapter/heading markers. When no explicit headings are
 * found, long documents still get structured chapters: synthetic sections
 * every ~30 sentences ("Section 1 (Sentence 1–30)", …).
 */
export function detectChapters(
  sentences: ReadonlyArray<{ text: string }>,
): Chapter[] {
  if (sentences.length === 0) return [];

  const heads: number[] = [];
  sentences.forEach((s, i) => {
    if (isHeadingText(s.text)) heads.push(i);
  });

  if (heads.length === 0) {
    if (sentences.length === 1) {
      return [
        {
          index: 0,
          title: "Section 1 (Sentence 1–1)",
          sentenceIdx: 0,
          sentenceEnd: 1,
          wordCount: countWords(sentences[0].text),
        },
      ];
    }
    const out: Chapter[] = [];
    const total = Math.ceil(sentences.length / TOC_FALLBACK_SECTION_SIZE);
    for (let k = 0; k < total; k += 1) {
      const start = k * TOC_FALLBACK_SECTION_SIZE;
      const end = Math.min(sentences.length, start + TOC_FALLBACK_SECTION_SIZE);
      let words = 0;
      for (let i = start; i < end; i += 1) words += countWords(sentences[i].text);
      out.push({
        index: k,
        title: `Section ${k + 1} (Sentence ${start + 1}–${end})`,
        sentenceIdx: start,
        sentenceEnd: end,
        wordCount: words,
      });
    }
    return out;
  }

  // Content before the first heading still needs a home in the drawer.
  const starts = heads[0] > 0 ? [0, ...heads] : heads;
  return starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : sentences.length;
    let words = 0;
    for (let i = start; i < end; i += 1) words += countWords(sentences[i].text);
    return {
      index: k,
      title: start === 0 && heads[0] > 0 ? "Start" : cleanTitle(sentences[start].text),
      sentenceIdx: start,
      sentenceEnd: end,
      wordCount: words,
    };
  });
}

/** Read-progress status of one chapter relative to the playback cursor. */
export function chapterStatus(
  chapter: Chapter,
  currentIdx: number,
): "done" | "current" | "upcoming" {
  if (currentIdx >= chapter.sentenceEnd) return "done";
  if (currentIdx >= chapter.sentenceIdx) return "current";
  return "upcoming";
}
