/* VoxShelf PWA service worker — on-device offline audio + asset support.
 *
 * - Cache-first for /api/audio/* from `voxshelf-offline-audio-v1`
 *   (populated by the in-app "Download to Device" flow). Served straight
 *   from the browser cache with no server connection required.
 * - Stale-while-revalidate for static assets (_next/static, fonts, icons).
 * - Network-first for navigations with a friendly offline fallback page.
 */

const AUDIO_CACHE = "voxshelf-offline-audio-v1";
const STATIC_CACHE = "voxshelf-static-v1";

self.addEventListener("install", () => {
  // Take over immediately so offline audio works without a reload.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop stale static caches from older worker versions.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (n) =>
              n !== AUDIO_CACHE &&
              n !== STATIC_CACHE &&
              // "vocalflow-" covers caches from the pre-rename releases.
              (n.startsWith("voxshelf-") || n.startsWith("vocalflow-")),
          )
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function offlinePage() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VoxShelf — Offline</title>
<style>
  body{font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;
    display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
  main{text-align:center;padding:2rem;max-width:26rem}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{color:#a1a1aa;font-size:.9rem;line-height:1.6}
  a{display:inline-block;margin-top:1rem;background:#10b981;color:#fff;
    padding:.6rem 1.25rem;border-radius:.6rem;text-decoration:none;font-weight:600}
</style></head>
<body><main>
  <div style="font-size:2.5rem">📱</div>
  <h1>You're offline</h1>
  <p>The VoxShelf server is unreachable. Books you saved with
  &ldquo;Download to Device&rdquo; are still available &mdash; go back to the
  library and open one from the &ldquo;📱 On Device&rdquo; tab.</p>
  <a href="/">Back to library</a>
</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function isStaticAsset(pathname) {
  if (pathname.startsWith("/_next/static/")) return true;
  if (
    pathname === "/manifest.json" ||
    pathname === "/favicon.svg" ||
    pathname === "/sw.js"
  )
    return true;
  return /\.(?:js|css|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf)$/.test(
    pathname,
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 1. Offline audio: strict cache-first from the device audio cache.
  if (url.pathname.startsWith("/api/audio/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(AUDIO_CACHE);
        const hit = await cache.match(req.url);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          // Opportunistically cache network audio so playback warms the
          // device cache even outside the download flow.
          if (res && res.ok) {
            try {
              await cache.put(req.url, res.clone());
            } catch {
              // Quota / opaque failures must not break playback.
            }
          }
          return res;
        } catch {
          return new Response("Audio unavailable offline.", { status: 504 });
        }
      })(),
    );
    return;
  }

  // 2. Navigations: network-first, offline fallback page when unreachable.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return offlinePage();
        }
      })(),
    );
    return;
  }

  // 3. Static assets: stale-while-revalidate.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req.url);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              cache.put(req.url, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        if (hit) return hit;
        const res = await network;
        return (
          res ?? new Response("Asset unavailable offline.", { status: 504 })
        );
      })(),
    );
  }
});
