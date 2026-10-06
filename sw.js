const CACHE = "burdigala-shell-v3";
const ASSETS = ["./", "./index.html", "./prospection.html", "./supabase.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"];

self.addEventListener("install", (event) => {
  // Mise en cache fichier par fichier : un fichier absent (ex. une icône) ne
  // doit plus faire échouer toute l'installation (addAll est "tout ou rien").
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((a) =>
        fetch(a, { cache: "reload" }).then((res) => { if (res.ok) return c.put(a, res); throw new Error(a + " " + res.status); })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // never intercept Supabase / CDN calls

  event.respondWith(
    fetch(req)
      .then((res) => {
        // On ne met en cache que les réponses valides (une 404/500 ne doit
        // jamais remplacer une bonne copie hors ligne).
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => {
        if (cached) return cached;
        // Repli sur index.html uniquement pour une navigation de page
        // (jamais pour une iframe — sinon l'app complète se chargeait dans
        // l'iframe Prospection —, ni pour un script, une image ou du JSON).
        if (req.mode === "navigate" && req.destination === "document") return caches.match("./index.html");
        return Response.error();
      }))
  );
});
