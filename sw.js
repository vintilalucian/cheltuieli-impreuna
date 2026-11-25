const BUILD_ID = "2026-11-25.35"; // bump on every release (release script/test replaces this)
const CACHE_NAME = "buget-familie-" + BUILD_ID;
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./icons/icon.svg", "./css/styles.css",
  "./js/defaults.js", "./js/ledger.js", "./js/importer.js", "./js/store.js", "./js/sheets-api.js",
  "./js/transaction-save.js", "./js/inline-category.js", "./js/recurrences-ui.js", "./js/review-banner.js", "./js/insights.js", "./js/charts.js", "./js/excel.js", "./js/app.js"
];

// Install: fill the NEW cache straight from the network (cache:"reload" bypasses the browser HTTP cache),
// so a release can never copy old HTTP-cached files into the new cache. All-or-nothing: if any file fails, install fails
// and the previous version keeps running.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache-busting query (?v=BUILD_ID) so the CDN cannot hand back stale bytes from an earlier build; stored under the plain URL.
      Promise.all(ASSETS.map(async (u) => {
        const bust = u + (u.includes("?") ? "&" : "?") + "v=" + BUILD_ID;
        const res = await fetch(bust, { cache: "reload" });
        if (!res.ok) throw new Error("asset " + u + " HTTP " + res.status);
        await cache.put(new Request(u), res);
      }))
    )
  );
  // No skipWaiting here: the new version waits until the user taps "Actualizează" (no reload under pending edits).
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("buget-familie-") && k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: same-origin GET served from the versioned cache (one consistent set per release); network only as fallback.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // never touch Apps Script calls
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
    )
  );
});

// Closed-app reminder. The relay sends an empty push, so the text is fixed and carries no financial data.
self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("Cheltuieli Împreună", {
    body: "Ai scadențe recurente de verificat.", tag: "rr-due", icon: "./icons/icon.svg", badge: "./icons/icon.svg", data: { url: "./?view=recurrences" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./?view=recurrences", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && "navigate" in c) return c.navigate(target).then((x) => x && x.focus()); }
    return self.clients.openWindow(target);
  }));
});
