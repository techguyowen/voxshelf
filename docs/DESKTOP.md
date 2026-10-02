# Desktop apps (macOS, Windows, Linux)

Native installers ship from every [GitHub release](https://github.com/techguyowen/voxshelf/releases):

| OS | File | Notes |
| --- | --- | --- |
| macOS (Apple Silicon) | `VoxShelf-*-arm64.dmg` | Also a `-mac.zip` |
| macOS (Intel) | `VoxShelf-*.dmg` (no `arm64` in the name) | |
| Windows 10+ | `VoxShelf Setup *.exe` | NSIS installer, x64 |
| Linux | `VoxShelf-*.AppImage` | x64, no install needed |

Each app embeds the full VoxShelf server + SQLite database: it works
offline out of the box and optionally syncs with a server (see
[SYNC.md](SYNC.md)).

## First run

Builds are unsigned, so expect one extra step:

- **macOS:** right-click the app → **Open** → **Open** (once). Or:
  `xattr -cr /Applications/VoxShelf.app`.
- **Windows:** SmartScreen may warn — **More info → Run anyway**.
- **Linux:** `chmod +x VoxShelf-*.AppImage` then run it.

On first launch, open **Settings** and add your Gemini API key
([free](https://aistudio.google.com/apikey)). To sync with a home server,
add its URL under **Settings → Library sync**.

## Data locations

| OS | Library (SQLite + audio cache) |
| --- | --- |
| macOS | `~/Library/Application Support/VoxShelf/voxshelf-data/` |
| Windows | `%APPDATA%\VoxShelf\voxshelf-data\` |
| Linux | `~/.config/VoxShelf/voxshelf-data/` |

Back up that folder to back up everything (or use **Settings → Data
export / import** for a portable JSON backup without audio). The **Help →
Open data folder** menu jumps straight there.

## Development

```bash
npm install
npm run dev            # terminal 1: Next.js on :38492
npm run desktop:dev    # terminal 2: Electron window (expects the dev server)
```

Set `ELECTRON_START_URL` to point the window at another server.

## Building installers

```bash
npm run desktop:build                # current OS
node scripts/electron-build.mjs --mac --x64 --arm64
node scripts/electron-build.mjs --win
node scripts/electron-build.mjs --linux
```

This runs `next build`, stages the standalone server, and calls
electron-builder. Installers land in `dist/` (git-ignored). CI builds all
three platforms on every `main` push and attaches them to `v*` releases.

## Notes & troubleshooting

- Desktop apps use the built-in `node:sqlite` driver (same schema and
  migrations as Docker's `better-sqlite3`); `/api/health` reports the engine.
- The app serves only on `127.0.0.1` and picks a free port if `38492` is
  busy — a second copy can run alongside the first.
- Startup problems? Check `desktop-startup.log` next to your data folder
  (Help → Open data folder, one level up).
- Local links stay in the window; external links open in your browser.
- Auto-update is not implemented yet — download new releases manually.
