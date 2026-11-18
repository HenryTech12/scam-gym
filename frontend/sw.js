// Service worker: caches the app shell so drills work offline.
// At install: the shell plus English (the fallback for any missing string).
// The page then asks for its current language ("cache-lang"); any other language
// is cached on first use by the fetch handler. API calls are never cached.

const CACHE = "scam-gym-v2";
const LANGS = ["en", "es", "fr"];
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/dom.js",
  "js/i18n.js",
  "js/engine.js",
  "js/matcher.js",
  "js/voice.js",
  "js/debrief.js",
  "js/study.js",
  "js/api.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];
const langFiles = (lang) => [`i18n/${lang}.json`, `data/scenarios.${lang}.json`, `data/study_items.${lang}.json`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...SHELL, ...langFiles("en")]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const lang = event.data && event.data.type === "cache-lang" ? event.data.lang : null;
  if (!LANGS.includes(lang)) return;
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(langFiles(lang))).catch(() => {}));
});

// Stale-while-revalidate for same-origin GETs; network only for /api.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === "navigate" ? "index.html" : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
