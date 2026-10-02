# Library sync

Every VoxShelf node (desktop app, Docker server, `npm run dev`) keeps a full
local SQLite library and works offline. Sync optionally keeps two nodes in
agreement with each other: typically a desktop app syncing with your Docker
server, but any node can sync with any other node's URL.

## Setup

In the app: **Settings → Library sync** → enter the server URL
(e.g. `http://192.168.1.10:38492`) → **Save sync settings**. The first cycle
runs immediately, then automatically about once a minute. **Sync now** forces
a cycle on demand.

Leave the URL empty for standalone mode (everything stays on one device).

Server-side defaults via environment (used when the Settings field is empty):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SYNC_SERVER_URL` | _(empty)_ | Peer base URL |
| `SYNC_ENABLED` | on when a URL is set | `1` / `0` force on/off |
| `SYNC_INTERVAL_MS` | `60000` | Background cycle, 15s–1h |
| `SYNC_MODE` | `full` | `full` or `selective` |
| `SYNC_API_KEY` | _(empty)_ | Peer key for locked servers |

## Selective sync

Full sync (the default) mirrors the whole library both ways. Selective
mode turns the server into an archive: the device pulls only the documents
and folders you pick, while anything created locally still uploads.

- **Settings → Library sync → Selected only**, then **Browse server
  library…** to download documents or whole folders (searchable, shows
  what's already on the device).
- Picked documents stay in sync (edits, progress, annotations); anything
  else on the server is ignored until downloaded.
- **Remove from device** deletes locally only — the server keeps its copy.
  Note the library's normal **Delete** still deletes everywhere via
  tombstones, in both modes.
- Switching back to **Full library** backfills everything missed on the
  next cycle (idempotent, may take a while on huge libraries).
- Settings and pronunciation rules always sync fully in both modes.

Protocol notes: `GET /api/sync/library` serves the lightweight catalog,
`POST /api/sync/fetch` returns full rows for explicit ids, and the worker
filters pulls to the pick (`sync.mode` + `sync.selection` in the
device-local `_sync_meta`). Push is always unfiltered; per-direction
watermarks merge at the end of each cycle so interleaved edits on both
sides are never skipped.

## What syncs, what stays local

| Synced | Stays on each device |
| --- | --- |
| Documents + sentences, reading progress | Audio cache (rebuilt from the deterministic content hash) |
| Bookmarks, highlights, folders | Episode/podcast audio (scripts sync; audio does not) |
| Podcast episodes (script + metadata) | Gemini API key |
| Pronunciation dictionary | Sync config + cursors |
| Settings (voice, speed, models) | Per-device prerender progress |
| Reading sessions / stats | |

Deletes propagate as tombstones: deleting a document on one side deletes it
on the other at the next cycle (including its sentences, bookmarks,
highlights, podcasts, and sessions).

## Conflict rules (last-write-wins)

There is no merge UI. When both sides changed the same row, the newest
timestamp wins and the cycle reports a `conflicts` count:

- Documents compare `max(updated_at, progress_updated_at)`, so a listening
  session on one device moves progress on the other — but two people actively
  listening to the same document on two devices will flap to whoever played
  last.
- An edit newer than a delete wins: the row resurrects on the device that
  deleted it. An older edit does not resurrect a deleted row.
- Two devices adding the same pronunciation word under different ids resolve
  deterministically by `(updated_at, id)` — both sides converge on one rule.
- Reading sessions are append-only and never conflict.

Timestamps come from device clocks. The status panel warns when clocks differ
by 5+ minutes — enable automatic time on both devices.

## Protocol (for contributors)

- `POST /api/sync/push` `{ v, changes, tombstones }` — idempotent
  last-write-wins merge into the receiver. Re-sending is a no-op.
- `POST /api/sync/pull` `{ v, cursors, tables? }` — rows newer than the
  caller's per-table cursors, paged (20 documents / 500 other rows per page).
- `GET /api/sync/status`, `POST /api/sync/config`, `POST /api/sync/now` —
  local worker control. Cursors advance only after a full successful
  push-then-pull cycle, so a failed cycle safely retries from scratch.
- Versioned (`v: 1`); mismatched versions fail loudly instead of corrupting.

Sync runs in two phases so parents always land before children: folders →
documents → settings → pronunciations, then bookmarks → highlights →
podcasts → sessions. Tombstones travel with every phase.

A device-local `_sync_meta` table holds the server URL and cursors; it is
never synced. Tombstones are never pruned automatically (they are ~100 bytes
each), so a device that returns after months offline still converges.

## Limitations

- Locked servers need their API key in the sync settings; sync traffic
  is plain HTTP either way, so prefer trusted networks (LAN / VPN / SSH
  tunnel) or HTTPS at a proxy. See [SERVER.md](SERVER.md).
- No end-to-end encryption and no multi-writer merge for document text
  (documents are immutable after import except for metadata/progress, so this
  rarely bites).
- Very large libraries transfer documents as full text + sentences per
  change; the 2M-character document cap bounds each row.

## Starting over

To re-pull everything from the server: stop the app, delete its local data
directory ([locations](DESKTOP.md#data-locations)), and restart. Empty cursors
pull the full library on the next cycle.
