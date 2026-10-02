# Docker server

The server image is published to GHCR on every `main` push and `v*` tag,
for `linux/amd64` and `linux/arm64`:

```bash
docker pull ghcr.io/techguyowen/voxshelf:latest
docker run -d --name voxshelf --restart unless-stopped \
  -p 38492:38492 \
  -e GEMINI_API_KEY=AIza… \
  -v ./data:/app/data \
  ghcr.io/voxshelf/voxshelf:latest
```

Or build locally with Compose:

```bash
export GEMINI_API_KEY=AIza…
docker compose up --build -d
```

Then open `http://<server-lan-ip>:38492` — and use that same URL in your
desktop apps under **Settings → Library sync**.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `API_KEY` | to lock the server | Shared key for the unlock screen + API/sync access (empty = open) |
| `GEMINI_API_KEY` | for TTS/AI | Server key (in-app keys override it per device) |
| `GEMINI_TTS_MODEL` / `GEMINI_TEXT_MODEL` | no | Model overrides |
| `DATA_DIR` | no | DB + cache dir (default `/app/data` in the image) |
| `PORT` | no | Default `38492` |
| `SYNC_SERVER_URL` / `SYNC_ENABLED` / `SYNC_INTERVAL_MS` | no | Optional server→server sync (see [SYNC.md](SYNC.md)) |

Health: `GET /api/health` (also the Docker `HEALTHCHECK`). `docker ps` shows
`healthy` once the server is up.

## Updating

```bash
docker compose pull   # published image, or: up --build -d to rebuild local
docker compose up -d
```

Migrations run automatically on boot. The SQLite schema is backward-added
only (new columns/tables), so downgrades stay readable.

## Backup & restore

Everything lives in the `./data` volume: `voxshelf.db` (+ `-wal`/`-shm`
while running) and `audio/` (cache, safe to exclude — it rebuilds on demand
at the cost of re-synthesis).

```bash
# Backup (stop first for a clean WAL checkpoint)
docker compose down
cp -a ./data ./data-backup-$(date +%F)
docker compose up -d

# Restore
docker compose down
rm -rf ./data && cp -a ./data-backup-YYYY-MM-DD ./data
docker compose up -d
```

For a portable backup without audio, use **Settings → Data export** in the
app (JSON, re-importable anywhere).

## Locking the server (API_KEY)

Without `API_KEY` the server is open — fine on a trusted LAN, but set a key
before exposing it further:

```bash
export API_KEY=$(openssl rand -hex 24)   # or put API_KEY=... in .env
docker compose up -d
```

With a key set, browsers see an unlock screen (stays unlocked 30 days per
device, lock icon re-locks), API clients must send
`Authorization: Bearer <key>`, and sync peers need the key in
**Settings → Library sync**. Only `/api/health` stays public.
Keep the key in `.env` (git-ignored), never in chat or screenshots.

## Exposing it safely

Even locked, treat this like a personal service (single shared key, no
per-user accounts, no rate limiting):

- Prefer LAN/VPN-only access (Tailscale, WireGuard, SSH tunnel).
- To expose it publicly, add HTTPS at a reverse proxy (Caddy, Cloudflare
  Tunnel) — the key travels in a cookie/header, so TLS matters off-LAN.
- Sync traffic is plain HTTP; use HTTPS at the proxy or a tunnel when
  leaving your LAN.

Minimal Caddy example (LAN + automatic HTTPS with your own domain):

```caddy
voxshelf.example.com {
    reverse_proxy 127.0.0.1:38492
}
```
