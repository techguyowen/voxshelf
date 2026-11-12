// VoxShelf core unit tests (node:test, zero extra dependencies).
//
// src/lib uses extensionless relative imports, which Node's ESM loader cannot
// resolve under --experimental-strip-types, so this suite registers a tiny
// resolve hook (retrying relative specifiers with a `.ts` suffix) and imports
// the libraries dynamically with the same specifiers TypeScript typechecks.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import type { ChapterTiming } from "../audiobookExport";
import type { DocumentDetail, Highlight, QuizResult, Sentence } from "../types";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      try {
        return nextResolve(specifier + ".ts");
      } catch {
        // Fall through to default resolution.
      }
    }
    return nextResolve(specifier);
  },
});

const { detectChapters } = await import("../toc");
const { concatWavs, pcmToWav, wavDurationMs } = await import("../audio");
const { buildMasterStudyGuideMarkdown } = await import("../studyGuide");
const { buildCueSheet, buildFfmetadata } = await import("../audiobookExport");

function makeSentence(idx: number, text: string): Sentence {
  return {
    idx,
    text,
    charStart: 0,
    charEnd: text.length,
    audioHash: null,
    audioDurationMs: null,
  };
}

function makeDoc(): DocumentDetail {
  const sentences = [
    makeSentence(0, "# The Voyage"),
    makeSentence(1, "The ship left harbor at dawn."),
    makeSentence(2, "Gulls followed the white wake."),
  ];
  return {
    id: "doc-1",
    title: "The Voyage",
    author: "A. Writer",
    sourceType: "paste",
    sourceUrl: null,
    totalChars: 100,
    wordCount: 20,
    sentenceCount: 3,
    voice: "Kore",
    speed: 1,
    folderId: null,
    tags: [],
    progressSentenceIndex: 0,
    progressCharOffset: 0,
    progressUpdatedAt: null,
    isArchived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stylePrompt: null,
    sentences,
    bookmarks: [],
    highlights: [],
    dialogueActing: null,
  };
}

describe("toc.detectChapters", () => {
  it("splits on explicit markdown headings", () => {
    const chapters = detectChapters([
      { text: "# Chapter 1: Beginnings" },
      { text: "It was a bright morning." },
      { text: "Birds sang in the trees." },
      { text: "## Chapter 2: The Middle" },
      { text: "Things got complicated." },
    ]);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, "Chapter 1: Beginnings");
    assert.equal(chapters[0].sentenceIdx, 0);
    assert.equal(chapters[0].sentenceEnd, 3);
    assert.ok(chapters[0].wordCount > 0);
    assert.equal(chapters[1].title, "Chapter 2: The Middle");
    assert.equal(chapters[1].sentenceIdx, 3);
    assert.equal(chapters[1].sentenceEnd, 5);
  });

  it("homes pre-heading content in a Start chapter", () => {
    const chapters = detectChapters([
      { text: "A cold open before any heading." },
      { text: "# First Heading" },
      { text: "Body text here." },
    ]);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, "Start");
    assert.equal(chapters[0].sentenceEnd, 1);
    assert.equal(chapters[1].title, "First Heading");
  });

  it("falls back to synthetic sections without headings", () => {
    const sentences = Array.from({ length: 65 }, (_, i) => ({
      text: `Sentence about rivers and trees number ${i + 1}.`,
    }));
    const chapters = detectChapters(sentences);
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].title, "Section 1 (Sentence 1–30)");
    assert.equal(chapters[0].sentenceIdx, 0);
    assert.equal(chapters[0].sentenceEnd, 30);
    assert.equal(chapters[1].title, "Section 2 (Sentence 31–60)");
    assert.equal(chapters[2].title, "Section 3 (Sentence 61–65)");
    assert.equal(chapters[2].sentenceIdx, 60);
    assert.equal(chapters[2].sentenceEnd, 65);
  });

  it("handles empty and single-sentence documents", () => {
    assert.deepEqual(detectChapters([]), []);
    const [only] = detectChapters([{ text: "Just one line." }]);
    assert.equal(only.title, "Section 1 (Sentence 1–1)");
    assert.equal(only.sentenceIdx, 0);
    assert.equal(only.sentenceEnd, 1);
  });
});

describe("audio wav helpers", () => {
  const SAMPLE_RATE = 24000;

  function tonePcm(seconds: number, sample = 1000): Buffer {
    const pcm = Buffer.alloc(SAMPLE_RATE * seconds * 2);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(sample, i);
    return pcm;
  }

  it("pcmToWav writes a valid RIFF/WAVE header", () => {
    const pcm = tonePcm(1);
    const wav = pcmToWav(pcm, SAMPLE_RATE);
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
    assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
    assert.equal(wav.subarray(12, 16).toString("ascii"), "fmt ");
    assert.equal(wav.readUInt32LE(16), 16);
    assert.equal(wav.readUInt16LE(20), 1); // PCM
    assert.equal(wav.readUInt16LE(22), 1); // mono
    assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(wav.subarray(36, 40).toString("ascii"), "data");
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.equal(wav.length, 44 + pcm.length);
    // Payload survives the smoothing fades away from the edges.
    assert.equal(wav.readInt16LE(44 + 12000 * 2), 1000);
  });

  it("wavDurationMs derives duration from the header", () => {
    assert.equal(wavDurationMs(pcmToWav(tonePcm(1), SAMPLE_RATE)), 1000);
    assert.equal(wavDurationMs(pcmToWav(tonePcm(2), SAMPLE_RATE)), 2000);
  });

  it("concatWavs joins payloads and sums durations", () => {
    const a = pcmToWav(tonePcm(1), SAMPLE_RATE);
    const b = pcmToWav(tonePcm(2, 2000), SAMPLE_RATE);
    const joined = concatWavs([a, b]);
    assert.equal(joined.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(joined.length, 44 + (a.length - 44) + (b.length - 44));
    assert.equal(wavDurationMs(joined), 3000);
  });

  it("concatWavs passes a single wav through and rejects empty input", () => {
    const a = pcmToWav(tonePcm(1), SAMPLE_RATE);
    assert.equal(concatWavs([a]), a);
    assert.throws(() => concatWavs([]), /Nothing to concatenate/);
  });
});

describe("studyGuide.buildMasterStudyGuideMarkdown", () => {
  const highlights: Highlight[] = [
    {
      id: "h-1",
      docId: "doc-1",
      sentenceIdx: 1,
      text: "The ship left harbor at dawn.",
      color: "yellow",
      note: "Opening line",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const quiz: QuizResult = {
    questions: [
      {
        question: "When did the ship leave?",
        options: ["At dawn", "At noon"],
        answerIndex: 0,
        explanation: "Stated in sentence two.",
      },
    ],
    flashcards: [],
  };

  const md = buildMasterStudyGuideMarkdown({
    doc: makeDoc(),
    studyNotes: { summary: "A ship sails at dawn." },
    highlights,
    bookmarks: [],
    quiz,
  });

  it("emits YAML frontmatter and a title header", () => {
    assert.ok(md.startsWith("---\n"));
    assert.ok(md.includes('title: "The Voyage"'));
    assert.ok(md.includes('author: "A. Writer"'));
    assert.ok(md.includes("tags: [voxshelf, study-guide]"));
    assert.ok(md.includes("# The Voyage — Study Guide"));
  });

  it("includes the executive summary", () => {
    assert.ok(md.includes("## Executive Summary"));
    assert.ok(md.includes("A ship sails at dawn."));
  });

  it("renders highlights with quotes and notes", () => {
    assert.ok(md.includes("## Highlights & Annotations"));
    assert.ok(md.includes("> The ship left harbor at dawn."));
    assert.ok(md.includes("**Note:** Opening line"));
  });

  it("renders the quiz and answer key", () => {
    assert.ok(md.includes("## Practice Quiz"));
    assert.ok(md.includes("### Q1. When did the ship leave?"));
    assert.ok(md.includes("1. At dawn"));
    assert.ok(md.includes("## Answer Key & Explanations"));
    assert.ok(md.includes("**Q1: A** — At dawn"));
    assert.ok(md.includes("_Stated in sentence two._"));
  });
});

describe("audiobookExport chapters", () => {
  const chapters: ChapterTiming[] = [
    {
      index: 0,
      title: "Harbor Dawn",
      sentenceIdx: 0,
      sentenceEnd: 2,
      wordCount: 12,
      startMs: 0,
      endMs: 61000,
    },
    {
      index: 1,
      title: 'Open Sea "at last"',
      sentenceIdx: 2,
      sentenceEnd: 3,
      wordCount: 6,
      startMs: 61000,
      endMs: 121500,
    },
  ];

  it("buildFfmetadata emits chapter timestamps", () => {
    const meta = buildFfmetadata(makeDoc(), chapters);
    assert.ok(meta.startsWith(";FFMETADATA1\n"));
    assert.ok(meta.includes("title=The Voyage"));
    assert.ok(meta.includes("artist=A. Writer"));
    assert.equal(meta.split("[CHAPTER]").length - 1, 2);
    assert.ok(meta.includes("TIMEBASE=1/1000"));
    assert.ok(meta.includes("START=0"));
    assert.ok(meta.includes("END=61000"));
    assert.ok(meta.includes("START=61000"));
    assert.ok(meta.includes("END=121500"));
    assert.ok(meta.includes("title=Harbor Dawn"));
    assert.ok(meta.endsWith("\n"));
  });

  it("buildCueSheet formats tracks with 75fps timestamps", () => {
    const cue = buildCueSheet(makeDoc(), "voyage.wav", chapters);
    assert.ok(cue.includes('FILE "voyage.wav" WAVE'));
    assert.ok(cue.includes('TITLE "The Voyage"'));
    assert.ok(cue.includes('PERFORMER "A. Writer"'));
    assert.ok(cue.includes("TRACK 01 AUDIO"));
    assert.ok(cue.includes("TRACK 02 AUDIO"));
    assert.ok(cue.includes("INDEX 01 00:00:00"));
    assert.ok(cue.includes("INDEX 01 01:01:00"));
    // Double quotes are unsafe in CUE strings and become apostrophes.
    assert.ok(cue.includes('TITLE "Open Sea \'at last\'"'));
    assert.ok(cue.endsWith("\n"));
  });
});
