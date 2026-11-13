import type { AudioNoteMode, AudioTranscribeAndNoteResult, DialogueAnalysisResult } from "./types";
import { GEMINI_VOICES } from "./voices";

export interface GeneratedQuizQuestion { question: string; options: string[]; answerIndex: number; explanation: string; }
export interface GeneratedFlashcard { front: string; back: string; }
export interface GeneratedQuiz { questions: GeneratedQuizQuestion[]; flashcards: GeneratedFlashcard[]; }
export interface PodcastLineNlp { speaker: "Alex" | "Sam"; voice: "Kore" | "Puck"; text: string; }
export interface PodcastScriptNlp { title: string; lines: PodcastLineNlp[]; }

const STOPWORDS = new Set("a an the and or but if then else for to of in on at by with as is are was were be been being have has had do does did will would shall should can could may might must i you he she it we they this that these those am an the of to in is you that it he was for on are as with his they i at be this have from or one had by word but not what all were we when your can said there use each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over new sound take only little work know place year live me back give most very after thing our just name good sentence man think say great where help through much before line right too mean old any same tell boy follow came want show also around form three small set put end does another well large must big even such because turn here why ask went men read need land different home us move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world high every near add food between own below country plant last school father keep tree never start city earth eye light thought head under story saw left few while along might close something seem next hard open example begin life always those both paper together got group often run".split(/\s+/));

const ABBR: Record<string, true> = {};
for (const a of ["mr","mrs","ms","dr","st","prof","sr","jr","vs","etc","fig","no","gen","rep","sen","gov","lt","col","sgt","capt","rev","hon","pres","dept","univ","ave","blvd","rd","ln"]) ABBR[a] = true;

export function splitSentencesNlp(text: string): string[] {
  if (!text) return [];
  const DOTP = "\uE000";
  let t = text.replace(/(\d)\.(\d)/g, `$1${DOTP}$2`);
  t = t.replace(/\b([A-Za-z]+)\./g, (m, w: string) => (ABBR[w.toLowerCase()] ? `${w}${DOTP}` : m));
  t = t.replace(/\bU\.S\./g, `U${DOTP}S${DOTP}`);
  t = t.replace(/\bU\.K\./g, `U${DOTP}K${DOTP}`);
  t = t.replace(/\be\.g\./g, `e${DOTP}g${DOTP}`);
  t = t.replace(/\bi\.e\./g, `i${DOTP}e${DOTP}`);
  t = t.replace(/(?:^|\s)([A-Z])\./g, (m, c: string) => m.replace(`${c}.`, `${c}${DOTP}`));
  const parts = t.split(/(?<=[.!?…]["'”’)]?)\s+(?=[A-Z0-9"“‘(\[])/);
  return parts.map((p) => p.replaceAll(DOTP, ".").trim()).filter(Boolean);
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter((w) => w.length > 1);
}
function contentWords(text: string): string[] {
  return tokenize(text).filter((w) => !STOPWORDS.has(w));
}
function wordFreq(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}
function tfidfVectors(sentences: string[]): Array<Map<string, number>> {
  const docs = sentences.map(contentWords);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, sentences.length);
  return docs.map((d) => {
    const tf = wordFreq(d);
    const v = new Map<string, number>();
    for (const [w, c] of tf) {
      const idf = Math.log((n + 1) / ((df.get(w) ?? 0) + 1)) + 1;
      v.set(w, (c / Math.max(1, d.length)) * idf);
    }
    return v;
  });
}
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k)!; }
  for (const v of b.values()) nb += v * v;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
export function textRankScores(sentences: string[], title = ""): number[] {
  const n = sentences.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const vecs = tfidfVectors(sentences);
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) sim[i][j] = cosine(vecs[i], vecs[j]);
  const titleWords = new Set(contentWords(title));
  let scores = new Array(n).fill(1 / n);
  const d = 0.85;
  for (let iter = 0; iter < 20; iter++) {
    const next = new Array(n).fill((1 - d) / n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const denom = sim[j].reduce((a, b) => a + b, 0) || 1;
        sum += (sim[j][i] / denom) * scores[j];
      }
      next[i] += d * sum;
    }
    scores = next;
  }
  return scores.map((s, i) => {
    const lead = 1 - i / (n * 2);
    const titleBoost = sentences[i] ? contentWords(sentences[i]).filter((w) => titleWords.has(w)).length * 0.05 : 0;
    return s * lead + titleBoost + (i === 0 ? 0.02 : 0);
  });
}
function rankedIndices(sentences: string[], title: string): number[] {
  const scores = textRankScores(sentences, title);
  return sentences.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
}
function topSentences(title: string, text: string, count: number): string[] {
  const sents = splitSentencesNlp(text);
  if (sents.length <= count) return sents;
  const idx = rankedIndices(sents, title).slice(0, count).sort((a, b) => a - b);
  return idx.map((i) => sents[i]);
}
function wordsOf(text: string): string[] { return text.trim().split(/\s+/).filter(Boolean); }

export function summarizeTextNlp(title: string, text: string, length: "short" | "detailed"): string {
  const sents = splitSentencesNlp(text);
  if (sents.length === 0) return text.trim().slice(0, 600);
  if (length === "short") {
    const picked = topSentences(title, text, Math.min(5, Math.max(4, Math.min(sents.length, 5))));
    const out = picked.join(" ");
    return wordsOf(out).slice(0, 170).join(" ") || out;
  }
  const overview = topSentences(title, text, Math.min(4, sents.length)).join(" ");
  const bullets = topSentences(title, text, Math.min(7, sents.length)).slice(0, 6).map((s) => `- ${s}`);
  const body = `${overview}\n\nKey points:\n${bullets.join("\n")}`;
  return wordsOf(body).slice(0, 420).join(" ").length ? body : overview;
}

function paragraphsOf(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export function chatWithDocNlp(title: string, text: string, history: Array<{ role: string; content: string }>, question: string): string {
  const paras = paragraphsOf(text);
  const units: string[] = [];
  for (const p of paras) { const ss = splitSentencesNlp(p); if (ss.length) units.push(...ss); else units.push(p); }
  if (units.length === 0) return "The document does not contain enough text to answer that question.";
  const queryWords = new Set(contentWords(question));
  // Expand with recent history nouns (non-stopwords, length>3).
  for (const h of history.slice(-4)) for (const w of contentWords(h.content)) if (w.length > 3) queryWords.add(w);
  const qBigrams = new Set<string>();
  const qw = tokenize(question);
  for (let i = 0; i + 1 < qw.length; i++) qBigrams.add(`${qw[i]} ${qw[i + 1]}`);
  const N = units.length;
  const df = new Map<string, number>();
  const unitWords = units.map(contentWords);
  for (const d of unitWords) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = units.map((u, i) => {
    const tf = wordFreq(unitWords[i]);
    let score = 0;
    for (const w of queryWords) {
      const c = tf.get(w) ?? 0;
      if (c) score += (1 + Math.log(c)) * (Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1);
    }
    const uw = tokenize(u);
    for (let k = 0; k + 1 < uw.length; k++) if (qBigrams.has(`${uw[k]} ${uw[k + 1]}`)) score += 2;
    // BM25 length norm approx
    score = score / (1 + unitWords[i].length / 40);
    return { u, score, i };
  }).sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, 3);
  if (top.length === 0) {
    return `I could not find a direct answer to that in "${title}". Try rephrasing with key terms from the document.`;
  }
  const answer = top[0].u;
  const excerpts = top.slice(0, 3).map((s) => `> ${s.u}`);
  return `${answer}\n\nSupporting excerpts:\n${excerpts.join("\n")}`;
}

const PREFIX_HINTS: Array<[string, string]> = [["un", "not or opposite"], ["re", "again"], ["pre", "before"], ["dis", "not or apart"], ["mis", "wrongly"], ["sub", "under"], ["inter", "between"], ["trans", "across"], ["auto", "self"], ["bio", "life"], ["geo", "earth"], ["micro", "small"], ["macro", "large"], ["photo", "light"], ["therm", "heat"], ["hydr", "water"]];
const SUFFIX_HINTS: Array<[string, string]> = [["tion", "act or process"], ["sion", "act or process"], ["ness", "state or quality"], ["ment", "result or action"], ["able", "capable of"], ["ible", "capable of"], ["ful", "full of"], ["less", "without"], ["ology", "study of"], ["ism", "belief or system"], ["ist", "person who"], ["ize", "to make"], ["ise", "to make"]];

export function explainSelectionNlp(selection: string, context: string): string {
  const sel = selection.trim();
  const ctx = context || "";
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let definition: string | null = null;
  const appositive = new RegExp(`${escaped}\\s*,\\s*(?:a|an|the)\\s+([^,.;]{4,120})`, "i").exec(ctx);
  if (appositive) definition = appositive[1].trim();
  if (!definition) {
    const pred = new RegExp(`${escaped}\\s+(?:means|refers to|is defined as|is)\\s+([^.;]{4,160})`, "i").exec(ctx);
    if (pred) definition = pred[1].trim();
  }
  const lower = sel.toLowerCase();
  const hints: string[] = [];
  for (const [p, hint] of PREFIX_HINTS) if (lower.startsWith(p) && lower.length > p.length + 2) { hints.push(`prefix "${p}-" often means "${hint}"`); break; }
  for (const [s, hint] of SUFFIX_HINTS) if (lower.endsWith(s) && lower.length > s.length + 2) { hints.push(`suffix "-${s}" often signals "${hint}"`); break; }
  const ctxSents = splitSentencesNlp(ctx).filter((s) => s.toLowerCase().includes(lower)).slice(0, 2);
  const freq = ctx ? (ctx.toLowerCase().split(lower).length - 1) : 0;
  const parts: string[] = [];
  if (definition) parts.push(`In this context, "${sel}" refers to ${definition}.`);
  else if (ctxSents.length) parts.push(`In this context, "${sel}" appears in: "${ctxSents[0]}"`);
  else parts.push(`"${sel}" is used in the document${freq ? ` (${freq} mention${freq === 1 ? "" : "s"})` : ""}.`);
  if (hints.length) parts.push(`Word clue: ${hints.join("; ")}.`);
  if (ctxSents[1]) parts.push(`Another use: "${ctxSents[1]}"`);
  return parts.join(" ");
}

function capitalizedTerms(text: string): string[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)) {
    const t = m[1].trim();
    if (["The", "This", "That", "It", "In", "On", "At", "But", "And"].includes(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}
function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function generateQuizNlp(title: string, text: string): GeneratedQuiz {
  const sents = splitSentencesNlp(text).filter((s) => wordsOf(s).length >= 6);
  const pool = sents.length ? sents : splitSentencesNlp(text);
  const scores = textRankScores(pool.length ? pool : [title], title);
  const order = pool.map((_, i) => i).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const terms = capitalizedTerms(text);
  const domainTerms = [...new Set(contentWords(text).filter((w) => w.length >= 5))].slice(0, 40);
  const questions: GeneratedQuizQuestion[] = [];
  const usedAnswers = new Set<string>();
  const seedBase = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) + text.length;
  for (const idx of order) {
    if (questions.length >= 5) break;
    const sent = pool[idx];
    if (!sent) continue;
    // Prefer cloze on capitalized term / number.
    let answer: string | null = null;
    const capInSent = terms.find((t) => sent.includes(t) && !usedAnswers.has(t));
    if (capInSent) answer = capInSent;
    if (!answer) {
      const num = /\b\d[\d,]*(?:\.\d+)?%?\b/.exec(sent);
      if (num && !usedAnswers.has(num[0])) answer = num[0];
    }
    if (!answer) {
      const cw = contentWords(sent).filter((w) => w.length >= 5 && !usedAnswers.has(w));
      if (cw.length) answer = cw.sort((a, b) => b.length - a.length)[0];
    }
    if (!answer) continue;
    usedAnswers.add(answer);
    const blanked = sent.replace(answer, "_____");
    const distractPool = [...terms.filter((t) => t !== answer), ...domainTerms.filter((t) => t.toLowerCase() !== answer.toLowerCase())];
    const distractors: string[] = [];
    for (const d of deterministicShuffle(distractPool, seedBase + idx * 7)) {
      if (distractors.length >= 3) break;
      if (d && d !== answer && !distractors.includes(d)) distractors.push(d);
    }
    while (distractors.length < 3) distractors.push(`Concept ${distractors.length + 1} from ${title}`);
    const options = deterministicShuffle([answer, ...distractors.slice(0, 3)], seedBase + idx * 13);
    questions.push({
      question: `According to "${title}", which best completes this statement: "${blanked}"`,
      options,
      answerIndex: options.indexOf(answer),
      explanation: `The document states: "${sent}"`,
    });
  }
  let qi = 0;
  while (questions.length < 5) {
    const sent = pool[qi % Math.max(1, pool.length)] ?? `The document "${title}" covers its main topic.`;
    const answer = `Statement ${questions.length + 1} is supported by the text`;
    const options = deterministicShuffle([answer, "The opposite is stated in the text", "This is not mentioned in the document", "Only the title suggests this"], seedBase + qi * 31);
    questions.push({
      question: `Which statement is supported by "${title}"? (See: "${sent.slice(0, 120)}")`,
      options,
      answerIndex: options.indexOf(answer),
      explanation: `The document states: "${sent}"`,
    });
    qi++;
    if (qi > 20) break;
  }
  const flashcards: GeneratedFlashcard[] = [];
  for (const idx of order) {
    if (flashcards.length >= 5) break;
    const sent = pool[idx];
    if (!sent) continue;
    const cap = terms.find((t) => sent.includes(t));
    const front = cap ?? (contentWords(sent)[0] ? contentWords(sent)[0][0].toUpperCase() + contentWords(sent)[0].slice(1) : `Key idea ${flashcards.length + 1}`);
    if (flashcards.some((f) => f.front === front)) continue;
    flashcards.push({ front, back: sent });
  }
  let fi = 0;
  while (flashcards.length < 5) {
    flashcards.push({ front: `Key point ${flashcards.length + 1} from ${title}`, back: pool[fi % Math.max(1, pool.length)] ?? title });
    fi++;
    if (fi > 20) break;
  }
  return { questions: questions.slice(0, 5), flashcards: flashcards.slice(0, 5) };
}

const ATTRIBUTION = /\b(said|asked|replied|whispered|shouted|muttered|answered|explained|added|murmured)\b/i;
const FEMALE_LOCAL = ["local:kokoro-http:af_heart", "local:kokoro-http:af_bella", "local:kokoro-http:bf_emma", "local:say:Samantha", "local:say:Ava"];
const MALE_LOCAL = ["local:kokoro-http:am_michael", "local:kokoro-http:am_puck", "local:kokoro-http:bm_george", "local:say:Daniel", "local:say:Alex"];
const FEMALE_GEMINI = GEMINI_VOICES.filter((v) => ["Aoede","Leda","Callirrhoe","Despina","Erinome","Autonoe","Laomedeia","Vindemiatrix","Pulcherrima"].includes(v.name)).map((v) => v.name);
const MALE_GEMINI = GEMINI_VOICES.filter((v) => ["Puck","Fenrir","Charon","Orus","Iapetus","Algenib","Rasalgethi","Gacrux","Algieba","Enceladus"].includes(v.name)).map((v) => v.name);
const NEUTRAL_GEMINI = GEMINI_VOICES.filter((v) => ["Zephyr","Kore","Achernar","Schedar","Sadaltager","Sulafat"].includes(v.name)).map((v) => v.name);

function guessGender(name: string, context: string): "male" | "female" | "neutral" {
  if (/\b(Mr\.|Lord|Sir|Father|King|Prince|Brother|Uncle)\b/.test(name) || /\b(Mr\.|Lord|Sir|Father)\b/.test(context)) return "male";
  if (/\b(Ms\.|Mrs\.|Miss|Lady|Mother|Queen|Princess|Sister|Aunt)\b/.test(name) || /\b(Ms\.|Mrs\.|Lady|Mother)\b/.test(context)) return "female";
  if (/\b(he|his|him)\b/i.test(context)) return "male";
  if (/\b(she|her|hers)\b/i.test(context)) return "female";
  return "neutral";
}
function extractSpeaker(text: string): string | null {
  // "....," said Alice / Alice said, "...."
  const after = /["”]\s*,?\s*(?:[a-z]+\s+)?(?:said|asked|replied|whispered|shouted|muttered|answered|explained|added|murmured)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/.exec(text);
  if (after) return after[1].trim();
  const before = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|asked|replied|whispered|shouted|muttered|answered|explained|added|murmured)\b/.exec(text);
  if (before) return before[1].trim();
  const colon = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?):\s/.exec(text.trim());
  if (colon) return colon[1].trim();
  return null;
}
function hasDialogueQuote(text: string): boolean {
  return /["“][^"”]{2,}["”]/.test(text) || /‘[^’]{2,}’/.test(text) || /^—\s*\S/.test(text.trim()) || /^--\s*\S/.test(text.trim());
}

export interface LocalDialogueVoiceCandidate {
  id: string;
  gender?: "male" | "female" | "neutral";
  lang?: string;
}

export function analyzeDialogueNlp(
  title: string,
  sentences: Array<{ idx: number; text: string }>,
  defaultVoice: string,
  useLocalVoices = false,
  localCandidates?: LocalDialogueVoiceCandidate[],
): DialogueAnalysisResult {
  void title;
  const narratorVoice = defaultVoice || "Kore";
  const charGender = new Map<string, "male" | "female" | "neutral">();
  const order: string[] = [];
  const rawTags: Array<{ sentenceIdx: number; character: string; isDialogue: boolean }> = [];
  let lastSpeaker: string | null = null;
  let lastWasDialogue = false;
  for (const s of sentences) {
    const isDlg = hasDialogueQuote(s.text) || ATTRIBUTION.test(s.text);
    let speaker = extractSpeaker(s.text);
    if (!speaker && isDlg && lastSpeaker && lastWasDialogue) {
      // Alternation heuristic in back-and-forth exchanges stays with tracking;
      // without a new attribution, keep last speaker only if quote continues.
      speaker = null;
    }
    if (speaker) {
      if (!charGender.has(speaker)) { charGender.set(speaker, guessGender(speaker, s.text)); order.push(speaker); }
      lastSpeaker = speaker;
    }
    const character = isDlg && speaker ? speaker : isDlg && lastSpeaker && hasDialogueQuote(s.text) && !extractSpeaker(s.text) ? lastSpeaker : "Narrator";
    // If dialogue quote with no attribution and we have 2 known speakers, alternate.
    let finalChar = character;
    if (isDlg && hasDialogueQuote(s.text) && !speaker && order.length >= 2 && lastSpeaker) {
      const other = order.find((c) => c !== lastSpeaker);
      // Alternate only when previous sentence was dialogue by lastSpeaker.
      if (other && lastWasDialogue) { finalChar = other; lastSpeaker = other; }
    }
    rawTags.push({ sentenceIdx: s.idx, character: finalChar, isDialogue: isDlg && finalChar !== "Narrator" ? true : isDlg });
    lastWasDialogue = isDlg;
    if (finalChar !== "Narrator" && !charGender.has(finalChar)) charGender.set(finalChar, guessGender(finalChar, s.text));
    if (finalChar !== "Narrator" && !order.includes(finalChar)) order.push(finalChar);
  }
  const used = new Set<string>([narratorVoice]);
  const pickCandidatePool = (gender: "male" | "female" | "neutral"): string[] => {
    if (localCandidates && localCandidates.length > 0) {
      const enFirst = localCandidates.filter((c) => !c.lang || /^en(?:[-_]|$)/i.test(c.lang));
      const base = enFirst.length > 0 ? enFirst : localCandidates;
      const nonNovelty = base.filter((c) => !/^(Grandma|Grandpa|Junior|Kathy|Ralph|Superstar)\b/i.test(c.id.split(":").pop() ?? ""));
      const clean = nonNovelty.length > 0 ? nonNovelty : base;
      const matched = gender === "neutral" ? clean : clean.filter((c) => c.gender === gender);
      const list = (matched.length > 0 ? matched : clean).map((c) => c.id);
      if (list.length > 0) return list;
    }
    return useLocalVoices
      ? gender === "female" ? FEMALE_LOCAL : gender === "male" ? MALE_LOCAL : [...FEMALE_LOCAL, ...MALE_LOCAL]
      : gender === "female" ? FEMALE_GEMINI : gender === "male" ? MALE_GEMINI : NEUTRAL_GEMINI;
  };
  const voiceFor = (gender: "male" | "female" | "neutral", n: number): string => {
    const pool = pickCandidatePool(gender);
    for (let k = 0; k < pool.length; k++) { const v = pool[(n + k) % pool.length]; if (!used.has(v)) { used.add(v); return v; } }
    const fallback = pool[n % pool.length] ?? narratorVoice;
    used.add(fallback);
    return fallback;
  };
  const characters: DialogueAnalysisResult["characters"] = [{ character: "Narrator", voice: narratorVoice, gender: "neutral" }];
  const cmap = new Map<string, string>([["Narrator", narratorVoice]]);
  order.forEach((name, i) => {
    const g = charGender.get(name) ?? "neutral";
    const v = voiceFor(g, i);
    cmap.set(name, v);
    characters.push({ character: name, voice: v, gender: g });
  });
  const tags = sentences.map((s) => {
    const raw = rawTags.find((t) => t.sentenceIdx === s.idx);
    const character = raw?.character ?? "Narrator";
    if (!cmap.has(character)) {
      const g = charGender.get(character) ?? "neutral";
      const v = voiceFor(g, cmap.size);
      cmap.set(character, v);
      characters.push({ character, voice: v, gender: g });
    }
    return { sentenceIdx: s.idx, character, voice: cmap.get(character)!, isDialogue: raw ? raw.character !== "Narrator" : false };
  });
  return { characters, tags, enabled: true };
}

export function generatePodcastScriptNlp(title: string, text: string): PodcastScriptNlp {
  const highlights = topSentences(title, text, 8);
  const sents = splitSentencesNlp(text);
  const points = highlights.length ? highlights : sents.slice(0, 8);
  const lines: PodcastLineNlp[] = [];
  const push = (speaker: "Alex" | "Sam", t: string) => lines.push({ speaker, voice: speaker === "Alex" ? "Kore" : "Puck", text: t.slice(0, 950) });
  push("Alex", `Welcome back, everyone. Today we are diving into "${title}" — and there is a lot to unpack here.`);
  push("Sam", `I am Sam, and I have been looking forward to this one. Alex, where should we start?`);
  const transitions = ["That leads us neatly to the next idea.", "And here is where it gets really interesting.", "Building on that, consider this.", "Now, a detail that stood out to me.", "Which brings us to another key point.", "Let us pause on that, because the next part matters.", "And to round out the picture."];
  points.forEach((p, i) => {
    if (i === 0) push("Alex", `Let us start at the heart of it. ${p}`);
    else if (i % 2 === 0) push("Alex", `${transitions[Math.min(i - 1, transitions.length - 1)]} ${p}`);
    else push("Sam", `${transitions[Math.min(i - 1, transitions.length - 1)]} ${p}`);
    if (lines.length >= 12) return;
  });
  while (lines.length < 10) push(lines.length % 2 === 0 ? "Alex" : "Sam", points[lines.length % Math.max(1, points.length)] ?? `There is more to explore in "${title}".`);
  push("Sam", `What a journey. That really changed how I think about "${title}".`);
  push("Alex", `Thanks for listening, everyone. We will see you next time — keep reading, and keep asking questions.`);
  return { title: `Podcast: ${title}`.slice(0, 160), lines: lines.slice(0, 14) };
}

export function generateNotesFromTranscriptNlp(transcript: string, mode: AudioNoteMode): AudioTranscribeAndNoteResult {
  const clean = transcript.trim();
  const sents = splitSentencesNlp(clean);
  const firstLine = clean.split(/\n/).map((s) => s.trim()).find(Boolean) ?? "Audio Recording";
  const title = (sents[0] ? sents[0].slice(0, 80) : firstLine.slice(0, 80)) || "Audio Recording";
  const summary = summarizeTextNlp(title, clean, "short");
  const keyPoints = topSentences(title, clean, 5);
  const actionItems: string[] = [];
  for (const s of sents) {
    if (/\b(need to|must|should|will|todo|action|follow up|deadline|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week))\b/i.test(s)) {
      const imperative = s.trim();
      if (!actionItems.includes(imperative)) actionItems.push(imperative);
    }
  }
  const groups: string[] = [`## Summary\n\n${summary}`];
  if (keyPoints.length) groups.push(`## Key Points\n\n${keyPoints.map((k) => `- ${k}`).join("\n")}`);
  if (actionItems.length) groups.push(`## Action Items\n\n${actionItems.map((a) => `- ${a}`).join("\n")}`);
  groups.push(`## Transcript Highlights\n\n${topSentences(title, clean, 6).map((k) => `- ${k}`).join("\n")}`);
  if (mode === "transcript-only") groups.splice(0, groups.length, `## Transcript\n\n${clean.slice(0, 4000)}`);
  return { title, transcript: clean, summary, notes: groups.join("\n\n"), actionItems: actionItems.slice(0, 20), keyPoints };
}

export function cleanupTextNlp(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = t.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...");
  const lines = t.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*\d{1,4}\s*$/.test(line)) continue;
    kept.push(line);
  }
  t = kept.join("\n");
  // Unwrap hard line breaks inside paragraphs, keep blank-line breaks.
  t = t.replace(/([^\n])\n(?!\n)([a-z,;:)\]])/g, "$1 $2");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/ ([,.!?;:])/g, "$1");
  return t.trim();
}

export function cleanupDictationNlp(text: string): string {
  let t = cleanupTextNlp(text);
  t = t.replace(/\b(um+|uh+|er+|ah+)\b[,.]?\s*/gi, "");
  t = t.replace(/\b(you know|basically)\b[,.]?\s*/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (m) => m.toUpperCase());
  return t;
}

