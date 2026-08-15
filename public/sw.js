/* eslint-disable no-restricted-globals */
/**
 * Tria's service worker.
 *
 * The app already kept mail, tasks and threads on screen without a network
 * (lib/mailCache, lib/appCache, lib/outbox) — but only once its JavaScript
 * was running. A cold start still went to the network for the document and
 * the bundles, so opening the app on a dead connection got the browser's
 * offline page instead of Tria. This caches the shell so a cold start paints
 * the real app, and makes every warm start instant rather than revalidated.
 *
 * What is NOT cached, deliberately:
 *  - everything under /api. Mail, credentials and AI replies are either
 *    sensitive or must be fresh, and the app has its own considered caches
 *    for the data worth keeping. A stale mailbox served from here would also
 *    be indistinguishable from a live one.
 *  - cross-origin requests, which we neither control nor need.
 */

const VERSION = "tria-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// The document itself. Hashed bundles are picked up at runtime on first use
// rather than listed here, so this never goes stale against a new build.
const SHELL_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // one bad URL must not fail the whole install
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Let a new build take over without the user hunting for a reload. */
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

const isAsset = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Build output is content-hashed, so a hit is always correct and there is
  // no reason to revalidate it.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigations: network first so a deploy is picked up immediately, falling
  // back to the cached shell when the network is gone or too slow to matter.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match("/", { ignoreSearch: true })
            .then(
              (hit) =>
                hit ||
                new Response("Offline, and no cached copy of Tria yet.", {
                  status: 503,
                  headers: { "Content-Type": "text/plain" },
                })
            )
        )
    );
  }
});
