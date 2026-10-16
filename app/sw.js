// Service worker: lets the site be installed and open fast. The site's own files come from the
// network when there is one (so updates show up at once) and from the cache when offline.
// Calls to the server (Supabase) are never cached.

const CACHE = "screendeal-v2";
const FILES = [
  "./", "index.html", "app.css", "app.js", "api.js", "ui.js", "shared.js", "children.js", "location.js", "approvals.js",
  "activities.js", "rules.js", "history.js", "account.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
