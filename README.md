# VocalFlow — Listen to Anything

VocalFlow is a **self-hostable, mobile-first text-to-speech app** (a Speechify
alternative) powered by **Gemini speech generation**. Import PDFs, EPUBs, Word
docs, web articles, Google Docs, photos of pages, or pasted text — then listen
with karaoke-style sentence highlighting, lock-screen controls, and an AI
reading assistant.

## Features

- **30 Gemini voices** (Zephyr, Puck, Charon, Kore, Fenrir, … Sulafat) with
  adjustable style prompts (“warm bedtime-story voice”) and 0.5×–4.5× speed.
- **Karaoke reader**: glowing sentence highlight, word-level tracking, smooth
  auto-scroll, click-any-sentence to jump.
- **Reading ruler / focus-line mode** that dims surrounding text.
- **Dyslexia-friendly typography**: OpenDyslexic-first font stack with
  Atkinson Hyperlegible fallback, plus Sans/Serif/Mono, adjustable size and
  line height.
- **Mobile background playback**: MediaSession API with lock-screen metadata,
  play/pause/prev/next and ±15s seek — keeps playing with the screen off.
- **Sleep timer**, 15s skip, full-document WAV download.
- **Import from anywhere**: PDF, EPUB, DOCX, TXT, MD, images (OCR), camera
  scan, Google Docs links, web articles (Readability), quick paste.
- **OCR two ways**: on-device Tesseract.js or Gemini Vision, with AI cleanup
  for scan artifacts.
- **AI assistant drawer**: one-click document summary (short/detailed) and a
  vocabulary explainer for any selected text.
- **Persistent library**: SQLite storage for documents, sentences, reading
  progress, bookmarks, settings and the audio-cache index; grid/list views,
  search, tags, archive, per-document export.
- **Disk audio cache**: every sentence is synthesized once and reused forever
  (content-hashed by text + voice + style).
- **Dark / light mode**, self-hostable with Docker.

## Screenshots (what you’ll see)

1. **Library** — header with the VocalFlow mark, green “API ready” pill, theme
   toggle, settings gear and Import button; document cards with source badges
   (PDF, EPUB, Article, Scan…), word counts, tag chips, emerald progress bars
   and Resume/Export/Archive/Delete actions; search, sort, tag filters and
   grid/list toggle above.
2. **Import modal** — five tabs (Upload, Scan/OCR, Google Docs, Web Article,
   Paste Text); drag-and-drop file zone; camera capture with engine picker;
   extraction preview with editable title and Save-to-library CTA.
3. **Karaoke reader** — the active sentence glows amber with the current word
   highlighted, neighbors dimmed in ruler mode; font panel (Sans/Serif/Mono/
   Dyslexia-friendly, size, line height); floating bottom player with transport
   controls, speed slider, 30-voice selector, style prompt, sleep timer and
   audio download; AI assistant drawer with Summary / Explain / Bookmarks tabs.

## Quick start (local)

Prerequisites: Node.js 20+ (22+ recommended).

```bash
git clone <this-repo> && cd vocalflow
npm install
cp .env.example .env   # then add your GEMINI_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser. On first run
a `./data` directory is created holding `vocalflow.db` (SQLite) and the
`audio/` cache.

Get a free Gemini API key at <https://aistudio.google.com/apikey> and either
set `GEMINI_API_KEY` in `.env` or paste it into **Settings** in the app (the
in-app key overrides the environment variable).

Production build:

```bash
npm run build
npm start
```

## Quick start (Docker)

```bash
export GEMINI_API_KEY=AIza…   # or create a .env file with it
docker compose up --build -d
```

Then open [http://localhost:3000](http://localhost:3000). Library data and the
audio cache persist in the local `./data` volume. To update:

```bash
docker compose up --build -d
```

## Configuration

| Variable             | Default                          | Description                                    |
| -------------------- | -------------------------------- | ---------------------------------------------- |
| `GEMINI_API_KEY`     | —                                | Gemini API key (can also be set in-app)        |
| `GEMINI_TTS_MODEL`   | `gemini-3.1-flash-tts-preview`   | Speech synthesis model (overridable in-app)    |
| `GEMINI_TEXT_MODEL`  | `gemini-2.5-flash`               | Summary/explain/OCR/vision model (in-app too)  |
| `DATA_DIR`           | `./data` (`/app/data` in Docker) | SQLite db + audio cache location               |
| `DB_PATH`            | `$DATA_DIR/vocalflow.db`         | SQLite file path                               |
| `PORT`               | `3000`                           | HTTP port                                      |

Model names are configurable because Google iterates on preview model IDs —
if a default stops resolving, point it at the current preview model in
Settings without redeploying.

## How it works

- **Import** (`/api/extract`, `/api/ocr`): files/URLs are converted to clean
  text (pdf-parse, mammoth, EPUB spine parsing, Readability, Tesseract /
  Gemini Vision), optionally AI-cleaned, then stored with per-sentence offsets.
- **Speech** (`/api/tts`): each sentence is hashed with its voice + style
  prompt; cache hits stream instantly from `/api/audio/[hash]`, misses are
  synthesized with Gemini TTS (long sentences are chunked and stitched into
  one WAV) and stored in SQLite + on disk.
- **Playback**: the client chains per-sentence audio through one element,
  prefetches upcoming sentences, maps elapsed time to word highlights, and
  publishes metadata + transport handlers to the OS via MediaSession.
- **AI** (`/api/ai/*`): summaries use map-reduce so full books work; the
  explainer uses surrounding sentences as context.

### API overview

| Route                              | Method(s)       | Purpose                                  |
| ---------------------------------- | --------------- | ---------------------------------------- |
| `/api/tts`                         | POST            | Synthesize text → cached audio URL       |
| `/api/audio/[hash]`                | GET             | Stream a cached WAV (immutable)          |
| `/api/extract`                     | POST (multipart)| File/URL → extracted text               |
| `/api/ocr`                         | POST (multipart)| Image → OCR text (AI or on-device)      |
| `/api/ai/summary`                  | POST            | Document summary                         |
| `/api/ai/explain`                  | POST            | Explain selected text                    |
| `/api/ai/cleanup`                  | POST            | Fix OCR/extraction artifacts             |
| `/api/documents`                   | GET / POST      | Library list / create                    |
| `/api/documents/[id]`              | GET/PATCH/DELETE| Detail (sentences+bookmarks) / update    |
| `/api/documents/[id]/audio`        | GET             | Whole document as one WAV (download)     |
| `/api/documents/[id]/bookmarks`    | GET / POST      | Bookmarks                                |
| `/api/voices`                      | GET             | All 30 voices + default                  |
| `/api/settings`                    | GET / PUT       | Public settings (key never exposed)      |
| `/api/cache`                       | GET / DELETE    | Audio-cache stats / clear                |
| `/api/data/export`, `/api/data/import` | GET / POST  | Full library backup / restore (JSON)     |

### Project layout

```
src/
  app/            Next.js App Router: pages + API routes
  components/     Library, ImportModal, ReaderView, PlayerBar, AIDrawer, …
  hooks/          usePlayer (sentence-chained playback engine)
  lib/            db, settings, gemini, tts, audio cache, documents,
                  extract/ (pdf, docx, epub, text, url, ocr), voices, text
data/             vocalflow.db + audio/ cache (created at runtime, git-ignored)
Dockerfile        multi-stage production image (standalone output)
docker-compose.yml  app + persistent ./data volume
```

### Database schema

SQLite (`better-sqlite3`, with automatic fallback to Node’s built-in
`node:sqlite`):

- **documents** — title, author, source, full text, counts, voice/style/speed,
  tags, reading progress, archive flag, timestamps.
- **sentences** — `(doc_id, idx)` text + char offsets + linked audio hash.
- **audio_cache** — content-hash → voice/style, file path, bytes, duration,
  usage stats (LRU-friendly).
- **bookmarks** — sentence anchors + notes.
- **settings** — API key, defaults, model overrides.

## Notes & limits

- TTS, AI summary/explain/cleanup and Vision OCR require a Gemini API key;
  on-device Tesseract OCR, the library, and cached-audio playback work without
  one.
- First on-device OCR run downloads Tesseract language data (~12 MB) and is
  slower; results improve dramatically with the AI engine.
- Google Docs import needs “Anyone with the link can view” sharing.
- Browsers require a user tap before audio starts; after that, background and
  lock-screen playback work via MediaSession.
