// Unit tests for VoxShelf local audio resampling, voice/model helpers, local TTS,
// local AI JSON/model parsing, and zero-dependency built-in NLP utilities.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

registerHooks({
  resolve(specifier, _context, nextResolve) {
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

const {
  TARGET_BITS,
  TARGET_CHANNELS,
  TARGET_SAMPLE_RATE,
  normalizeToWav24kMono,
  pcmToWav24kMono,
} = await import("../audioResample");
const {
  audioKey,
  concatWavs,
  parseWavHeader,
  pcmToWav,
  wavDurationMs,
} = await import("../audio");
const { isLocalVoiceValue, isValidVoice } = await import("../voices");
const { mapCloudVoiceToLocal, parseLocalVoiceId, parseSayVoiceLine, synthesizeLocalSpeech } = await import("../localTts");
const { parseLlmJson, parseModelId } = await import("../localAi");
const {
  analyzeDialogueNlp,
  chatWithDocNlp,
  cleanupDictationNlp,
  cleanupTextNlp,
  explainSelectionNlp,
  generateNotesFromTranscriptNlp,
  generatePodcastScriptNlp,
  generateQuizNlp,
  summarizeTextNlp,
} = await import("../voxshelfLocalNlp");

function makePcm16(
  sampleRate: number,
  durationSec: number,
  channels = 1,
  leftAmp = 10000,
  rightAmp = 6000,
): Buffer {
  const frames = Math.round(sampleRate * durationSec);
  const buf = Buffer.alloc(frames * channels * 2);
  for (let f = 0; f < frames; f++) {
    const phase = (f / sampleRate) * 440 * Math.PI * 2;
    const sign = Math.sin(phase) >= 0 ? 1 : -1;
    buf.writeInt16LE(sign * leftAmp, f * channels * 2);
    if (channels > 1) {
      buf.writeInt16LE(sign * rightAmp, (f * channels + 1) * 2);
    }
  }
  return buf;
}

function wrapWav16(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe("audioResample and concatWavs", () => {
  it("upsamples a 16kHz mono WAV to 24kHz 16-bit mono WAV", () => {
    const wav16k = wrapWav16(makePcm16(16000, 0.5, 1), 16000, 1);
    const out = normalizeToWav24kMono(wav16k);
    const info = parseWavHeader(out);
    assert.ok(info);
    assert.equal(info.sampleRate, TARGET_SAMPLE_RATE);
    assert.equal(info.channels, TARGET_CHANNELS);
    assert.equal(info.bitsPerSample, TARGET_BITS);
    const ms = wavDurationMs(out);
    assert.ok(ms >= 480 && ms <= 520, `expected ~500ms, got ${ms}ms`);
  });

  it("downsamples a 44.1kHz stereo WAV to 24kHz 16-bit mono WAV and mixes channels", () => {
    const stereoPcm = Buffer.alloc(44100 * 0.5 * 4);
    for (let f = 0; f < 22050; f++) {
      stereoPcm.writeInt16LE(16000, f * 4);
      stereoPcm.writeInt16LE(8000, f * 4 + 2);
    }
    const wav44k = wrapWav16(stereoPcm, 44100, 2);
    const out = normalizeToWav24kMono(wav44k);
    const info = parseWavHeader(out);
    assert.ok(info);
    assert.equal(info.sampleRate, 24000);
    assert.equal(info.channels, 1);
    assert.equal(info.bitsPerSample, 16);
    const ms = wavDurationMs(out);
    assert.ok(ms >= 480 && ms <= 520, `expected ~500ms, got ${ms}ms`);
    const midSample = out.readInt16LE(info.headerSize + 6000 * 2);
    assert.ok(
      Math.abs(midSample - 12000) <= 10,
      `expected mixed mono sample ~12000, got ${midSample}`,
    );
  });

  it("resamples raw PCM16 buffers without WAV headers", () => {
    const raw16k = makePcm16(16000, 0.4, 1);
    const fromNormalize = normalizeToWav24kMono(raw16k, 16000);
    const info1 = parseWavHeader(fromNormalize);
    assert.ok(info1);
    assert.equal(info1.sampleRate, 24000);
    assert.equal(info1.channels, 1);
    assert.equal(info1.bitsPerSample, 16);
    assert.ok(Math.abs(wavDurationMs(fromNormalize) - 400) <= 20);

    const raw44k = makePcm16(44100, 0.4, 1);
    const fromPcmHelper = pcmToWav24kMono(raw44k, 44100);
    const info2 = parseWavHeader(fromPcmHelper);
    assert.ok(info2);
    assert.equal(info2.sampleRate, 24000);
    assert.equal(info2.channels, 1);
    assert.equal(info2.bitsPerSample, 16);
    assert.ok(Math.abs(wavDurationMs(fromPcmHelper) - 400) <= 20);
  });

  it("concatWavs normalizes mismatched sample rates and channels to 24kHz mono", () => {
    const w16 = wrapWav16(makePcm16(16000, 0.3, 1), 16000, 1);
    const w44Stereo = wrapWav16(makePcm16(44100, 0.3, 2), 44100, 2);
    const w24 = pcmToWav(makePcm16(24000, 0.4, 1), 24000, 1, 16);

    const joined = concatWavs([w16, w44Stereo, w24]);
    const info = parseWavHeader(joined);
    assert.ok(info);
    assert.equal(info.sampleRate, 24000);
    assert.equal(info.channels, 1);
    assert.equal(info.bitsPerSample, 16);
    const ms = wavDurationMs(joined);
    assert.ok(ms >= 960 && ms <= 1040, `expected ~1000ms, got ${ms}ms`);
  });
});

describe("voices and audioKey", () => {
  it("validates Gemini, device, and local voices", () => {
    assert.equal(isValidVoice("Kore"), true);
    assert.equal(isValidVoice("Zephyr"), true);
    assert.equal(isValidVoice("device:Samantha"), true);
    assert.equal(isValidVoice("local:auto"), true);
    assert.equal(isValidVoice("local:say:Samantha"), true);
    assert.equal(isValidVoice("local:kokoro-http:af_heart"), true);

    assert.equal(isValidVoice(""), false);
    assert.equal(isValidVoice("device:"), false);
    assert.equal(isValidVoice("local:"), false);
    assert.equal(isValidVoice("UnknownVoice"), false);

    assert.equal(isLocalVoiceValue("local:auto"), true);
    assert.equal(isLocalVoiceValue("local:espeak:en-us"), true);
    assert.equal(isLocalVoiceValue("local:"), false);
    assert.equal(isLocalVoiceValue("Kore"), false);
    assert.equal(isLocalVoiceValue("device:Alex"), false);
  });

  it("computes deterministic and unique audioKey hashes", () => {
    const base = audioKey("Hello world.", "Kore", "");
    assert.equal(base.length, 64);
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(audioKey("Hello world.", "Kore", ""), base);

    assert.notEqual(audioKey("Hello world!", "Kore", ""), base);
    assert.notEqual(audioKey("Hello world.", "Puck", ""), base);
    assert.notEqual(audioKey("Hello world.", "local:say:Samantha", ""), base);
    assert.notEqual(audioKey("Hello world.", "Kore", "warm and calm"), base);
  });
});

describe("localTts", () => {
  it("parses local voice identifiers and engine aliases", () => {
    assert.deepEqual(parseLocalVoiceId("local:auto"), { engine: "auto", voiceName: "" });
    assert.deepEqual(parseLocalVoiceId("local:kokoro:af_heart"), {
      engine: "kokoro-http",
      voiceName: "af_heart",
    });
    assert.deepEqual(parseLocalVoiceId("local:kokoro-http:af_bella"), {
      engine: "kokoro-http",
      voiceName: "af_bella",
    });
    assert.deepEqual(parseLocalVoiceId("local:say:Samantha"), {
      engine: "say",
      voiceName: "Samantha",
    });
    assert.deepEqual(parseLocalVoiceId("local:piper"), {
      engine: "piper",
      voiceName: "",
    });
    assert.deepEqual(parseLocalVoiceId("local:espeak:en-us+f3"), {
      engine: "espeak",
      voiceName: "en-us+f3",
    });
    assert.deepEqual(parseLocalVoiceId("local:sapi:default"), {
      engine: "sapi",
      voiceName: "default",
    });

    assert.equal(parseLocalVoiceId("Kore"), null);
    assert.equal(parseLocalVoiceId("device:Samantha"), null);
    assert.equal(parseLocalVoiceId("local:"), null);
    assert.equal(parseLocalVoiceId(""), null);
  });

  it("parses macOS say -v '?' lines including single-space localized and numeric locales", () => {
    assert.deepEqual(
      parseSayVoiceLine("Eddy (Korean (South Korea)) ko_KR    # 안녕하세요. 제 이름은 Eddy입니다."),
      {
        name: "Eddy (Korean (South Korea))",
        locale: "ko-KR",
        sample: "안녕하세요. 제 이름은 Eddy입니다.",
      },
    );
    assert.deepEqual(
      parseSayVoiceLine("Majed               ar_001   # Hello"),
      { name: "Majed", locale: "ar-001", sample: "Hello" },
    );
    assert.deepEqual(
      parseSayVoiceLine("Samantha            en_US    # Hello! My name is Samantha."),
      { name: "Samantha", locale: "en-US", sample: "Hello! My name is Samantha." },
    );
  });

  it(
    "maps Gemini cloud voice Kore to an English macOS say voice rather than Korean",
    { skip: process.platform !== "darwin" },
    async () => {
      const mapped = await mapCloudVoiceToLocal("Kore", "say");
      assert.ok(mapped.startsWith("local:say:"), `expected local:say:* voice, got ${mapped}`);
      assert.ok(!/korean/i.test(mapped), `unexpected non-English voice mapping: ${mapped}`);
    },
  );

  it(
    "synthesizes real speech via macOS say into a valid 24kHz mono WAV",
    { skip: process.platform !== "darwin" },
    async () => {
      const out = await synthesizeLocalSpeech("Testing local voice synthesis.", "local:say", 1);
      assert.equal(out.engine, "say");
      assert.equal(out.free, true);
      assert.ok(out.voice.startsWith("local:say:"));
      assert.equal(out.wav.subarray(0, 4).toString("ascii"), "RIFF");
      assert.equal(out.wav.subarray(8, 12).toString("ascii"), "WAVE");
      const info = parseWavHeader(out.wav);
      assert.ok(info);
      assert.equal(info.sampleRate, 24000);
      assert.equal(info.channels, 1);
      assert.equal(info.bitsPerSample, 16);
      assert.ok(wavDurationMs(out.wav) > 0);
    },
  );
});

describe("localAi helpers", () => {
  it("parses builtin, ollama, local, and gemini model IDs", () => {
    assert.deepEqual(parseModelId("builtin:voxshelf-nlp"), {
      kind: "builtin",
      model: "voxshelf-nlp",
    });
    assert.deepEqual(parseModelId("ollama:llama3.2:latest"), {
      kind: "ollama",
      model: "llama3.2:latest",
    });
    assert.deepEqual(parseModelId("local:qwen2.5-7b"), {
      kind: "local",
      model: "qwen2.5-7b",
    });
    assert.deepEqual(parseModelId("gemini-3.8-flash"), {
      kind: "gemini",
      model: "gemini-3.8-flash",
    });
  });

  it("parseLlmJson handles markdown fences, prose wrappers, and trailing commas", () => {
    const fencedObj = '```json\n{"summary": "Short text", "tags": ["a", "b",],}\n```';
    assert.deepEqual(parseLlmJson<{ summary: string; tags: string[] }>(fencedObj, "object"), {
      summary: "Short text",
      tags: ["a", "b"],
    });

    const proseArray = 'Here is the list:\n```json\n[\n  {"id": 1,},\n  {"id": 2,},\n]\n```\nDone.';
    assert.deepEqual(parseLlmJson<Array<{ id: number }>>(proseArray, "array"), [
      { id: 1 },
      { id: 2 },
    ]);

    assert.throws(() => parseLlmJson("not json at all", "object"), /No JSON found/);
  });
});

describe("voxshelfLocalNlp", () => {
  const SAMPLE_ARTICLE = [
    "Photosynthesis, the biochemical process by which plants convert sunlight into chemical energy, powers nearly all life on Earth.",
    "During the light-dependent reactions inside thylakoid membranes, chlorophyll molecules absorb photons and split water molecules into oxygen, protons, and electrons.",
    "In 1948, Melvin Calvin and Andrew Benson mapped the carbon-fixation cycle inside chloroplasts.",
    "The Calvin cycle uses ATP and NADPH to fix atmospheric carbon dioxide into three-carbon sugars.",
    "Modern solar-fuel researchers study artificial photosynthesis to produce hydrogen fuel cleanly without fossil carbon emissions.",
    "Agronomists also engineer crop varieties with improved ribulose-bisphosphate carboxylase efficiency to raise grain yields under drought.",
    "Because ocean phytoplankton perform roughly half of global carbon fixation, marine photosynthesis strongly regulates Earth's climate.",
  ].join(" ");

  it("summarizes documents in short and detailed formats", () => {
    const shortSummary = summarizeTextNlp("Photosynthesis", SAMPLE_ARTICLE, "short");
    assert.ok(shortSummary.length > 20);
    assert.ok(shortSummary.split(/\s+/).length <= 170);

    const detailedSummary = summarizeTextNlp("Photosynthesis", SAMPLE_ARTICLE, "detailed");
    assert.ok(detailedSummary.includes("Key points:"));
    assert.ok(detailedSummary.includes("\n- "));
  });

  it("answers document questions with BM25 excerpts and history expansion", () => {
    const ans = chatWithDocNlp(
      "Photosynthesis",
      SAMPLE_ARTICLE,
      [],
      "Who mapped the carbon-fixation cycle in 1948?",
    );
    assert.ok(ans.includes("Melvin Calvin"));
    assert.ok(ans.includes("Supporting excerpts:"));
    assert.ok(ans.includes("> "));

    const followUp = chatWithDocNlp(
      "Photosynthesis",
      SAMPLE_ARTICLE,
      [{ role: "user", content: "Tell me about phytoplankton marine climate" }],
      "What fraction of global fixation do they perform?",
    );
    assert.ok(followUp.includes("phytoplankton"));

    const miss = chatWithDocNlp(
      "Photosynthesis",
      SAMPLE_ARTICLE,
      [],
      "What is the orbital period of Neptune?",
    );
    assert.ok(miss.includes("could not find a direct answer"));
  });

  it("explains selections with context definitions and morphology clues", () => {
    const defExplain = explainSelectionNlp("Photosynthesis", SAMPLE_ARTICLE);
    assert.ok(defExplain.includes("refers to"));
    assert.ok(defExplain.includes("biochemical process"));

    const clueExplain = explainSelectionNlp(
      "hydroelectric",
      "The hydroelectric turbine generated renewable power for the valley.",
    );
    assert.ok(clueExplain.includes("Word clue:"));
    assert.ok(clueExplain.includes("hydr-"));
  });

  it("generates a 5-question MCQ quiz and 5 flashcards", () => {
    const quiz = generateQuizNlp("Photosynthesis", SAMPLE_ARTICLE);
    assert.equal(quiz.questions.length, 5);
    assert.equal(quiz.flashcards.length, 5);
    for (const q of quiz.questions) {
      assert.ok(q.question.length > 10);
      assert.equal(q.options.length, 4);
      assert.ok(q.answerIndex >= 0 && q.answerIndex < q.options.length);
      assert.ok(q.explanation.length > 5);
    }
    for (const card of quiz.flashcards) {
      assert.ok(card.front.length > 0);
      assert.ok(card.back.length > 0);
    }
  });

  it("attributes dialogue speakers and assigns distinct voices", () => {
    const sentences = [
      { idx: 0, text: "Mist covered the stone pier." },
      { idx: 1, text: '"Did you hear the bell?" asked Alice.' },
      { idx: 2, text: 'Bob replied, "Yes, the ferry is arriving early."' },
      { idx: 3, text: '"Let us gather our packs right away."' },
    ];
    const gemRes = analyzeDialogueNlp("The Pier", sentences, "Kore", false);
    assert.equal(gemRes.enabled, true);
    assert.equal(gemRes.tags.length, 4);
    assert.equal(gemRes.tags[0].character, "Narrator");
    assert.equal(gemRes.tags[0].voice, "Kore");
    assert.equal(gemRes.tags[0].isDialogue, false);
    assert.equal(gemRes.tags[1].character, "Alice");
    assert.equal(gemRes.tags[1].isDialogue, true);
    assert.equal(gemRes.tags[2].character, "Bob");
    assert.equal(gemRes.tags[2].isDialogue, true);
    assert.equal(gemRes.tags[3].character, "Alice");
    assert.notEqual(gemRes.tags[1].voice, gemRes.tags[2].voice);

    const localRes = analyzeDialogueNlp("The Pier", sentences, "local:auto", true);
    assert.ok(localRes.characters.some((c) => c.character === "Alice" && c.voice.startsWith("local:")));
    assert.ok(localRes.characters.some((c) => c.character === "Bob" && c.voice.startsWith("local:")));

    const scopedRes = analyzeDialogueNlp("The Pier", sentences, "local:say:Samantha", true, [
      { id: "local:say:Samantha", gender: "female", lang: "en-US" },
      { id: "local:say:Karen", gender: "female", lang: "en-AU" },
      { id: "local:say:Daniel", gender: "male", lang: "en-GB" },
      { id: "local:say:Grandpa (English (US))", gender: "male", lang: "en-US" },
    ]);
    assert.equal(scopedRes.characters.find((c) => c.character === "Alice")?.voice, "local:say:Karen");
    assert.equal(scopedRes.characters.find((c) => c.character === "Bob")?.voice, "local:say:Daniel");
    assert.ok(scopedRes.characters.every((c) => !c.voice.includes("kokoro-http")));
  });

  it("generates an alternating podcast script between Alex and Sam", () => {
    const script = generatePodcastScriptNlp("Photosynthesis", SAMPLE_ARTICLE);
    assert.equal(script.title, "Podcast: Photosynthesis");
    assert.ok(script.lines.length >= 10 && script.lines.length <= 14);
    assert.equal(script.lines[0].speaker, "Alex");
    assert.equal(script.lines[0].voice, "Kore");
    assert.equal(script.lines[1].speaker, "Sam");
    assert.equal(script.lines[1].voice, "Puck");
    for (const line of script.lines) {
      assert.ok(line.text.trim().length > 0);
    }
  });

  it("generates structured notes and action items from audio transcripts", () => {
    const transcript = [
      "Welcome to the weekly engineering sync.",
      "We need to finalize the desktop release checklist by Friday.",
      "The resampling pipeline now outputs 24kHz mono WAV files consistently.",
      "Team members should verify offline speech synthesis on Linux containers.",
    ].join(" ");

    const meetingNotes = generateNotesFromTranscriptNlp(transcript, "meeting");
    assert.ok(meetingNotes.summary && meetingNotes.summary.length > 0);
    assert.ok(meetingNotes.keyPoints && meetingNotes.keyPoints.length > 0);
    assert.ok(meetingNotes.actionItems && meetingNotes.actionItems.length >= 2);
    assert.ok(meetingNotes.notes?.includes("## Summary"));
    assert.ok(meetingNotes.notes?.includes("## Key Points"));
    assert.ok(meetingNotes.notes?.includes("## Action Items"));
    assert.ok(meetingNotes.notes?.includes("## Transcript Highlights"));

    const transcriptOnly = generateNotesFromTranscriptNlp(transcript, "transcript-only");
    assert.ok(transcriptOnly.notes?.startsWith("## Transcript\n\n"));
  });

  it("cleans up OCR/PDF text and dictation transcripts", () => {
    const messyText = "The quick-\nbrown fox jumped\n42\nover “the lazy”   dog .\n\nNext para-\ngraph starts here…";
    const cleaned = cleanupTextNlp(messyText);
    assert.ok(!cleaned.includes("\n42\n"));
    assert.ok(cleaned.includes("quickbrown"));
    assert.ok(cleaned.includes('"the lazy" dog.'));
    assert.ok(cleaned.includes("\n\nNext paragraph starts here..."));

    const dictation = "um, we should basically test, uh, the local audio path. you know, it works well.";
    const cleanDict = cleanupDictationNlp(dictation);
    assert.ok(!/\b(um|uh|basically|you know)\b/i.test(cleanDict));
    assert.ok(cleanDict.startsWith("We should test"));
    assert.ok(cleanDict.includes("It works well."));
  });
});
