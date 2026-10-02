# Contributing to VoxShelf

Thanks for wanting to improve VoxShelf! This guide covers how to set up a
development environment, propose changes, and get them merged.

## Code of Conduct

By participating, you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md). Be kind, assume good intent, and keep
discussions focused on the work.

## Getting started

Prerequisites: Node.js 22+ and npm.

```bash
git clone https://github.com/<you>/voxshelf.git
cd voxshelf
npm install
cp .env.example .env   # add your GEMINI_API_KEY
npm run dev            # serves on http://localhost:38492
```

On first run a `./data` directory is created holding `voxshelf.db` (SQLite)
and the `audio/` cache. Get a free Gemini API key at
<https://aistudio.google.com/apikey>.

Useful commands:

| Command            | Purpose                              |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start the dev server on port `38492` |
| `npm run typecheck`| TypeScript check (`tsc --noEmit`)    |
| `npm run build`    | Production build                     |
| `npm start`        | Serve the production build           |

## How to contribute

1. **Find or file an issue.** Check existing issues first; for bugs include the
   environment details from the bug report template.
2. **Fork and branch.** Create a branch from `main` named like
   `fix/sleep-timer-drift` or `feat/opml-import`.
3. **Keep changes focused.** One issue per pull request; avoid drive-by
   refactors in unrelated files.
4. **Verify.** `npm run typecheck` and `npm run build` must pass with zero
   errors. Manually exercise the touched UI on both desktop and a narrow
   (mobile-width) viewport.
5. **Open a PR.** Describe what changed, why, and how you tested it. Link the
   issue it closes.

## Coding conventions

- TypeScript strict; prefer small pure helpers in `src/lib/` over logic buried
  in components.
- React: client components live in `src/components/`, routes in `src/app/`.
  Keep new components memoized-friendly and avoid unnecessary re-renders in
  hot paths (the reader renders every sentence).
- Styling: Tailwind utility classes, `dark:` variants for both themes, and
  `min-h-[44px]` touch targets for mobile controls.
- Accessibility: label controls (`aria-label` where there is no visible
  label), keep keyboard shortcuts documented in
  `KeyboardShortcutsModal.tsx` and the README cheat sheet.
- Never use native `alert()`/`confirm()` for new feedback — use the
  `useToast()` hook (`src/components/Toast.tsx`).
- API routes: validate inputs, return JSON errors with appropriate status
  codes, and never leak the Gemini API key to the client.

## Project layout

```
src/
  app/            Next.js App Router: pages + API routes
  components/     Library, ImportModal, ReaderView, PlayerBar, AIDrawer, …
  hooks/          usePlayer (sentence-chained playback engine)
  lib/            db, settings, gemini, tts, audio cache, documents,
                  extract/ (pdf, docx, epub, text, url, ocr), voices, text
data/             voxshelf.db + audio/ cache (created at runtime, git-ignored)
Dockerfile        multi-stage production image (standalone output)
docker-compose.yml  app + persistent ./data volume
```

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. Instead,
contact the maintainers privately so a fix can be prepared before disclosure.
