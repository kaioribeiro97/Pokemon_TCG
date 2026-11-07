const CACHE = "tcg-v2"; // troque (tcg-v2...) para forçar atualização do app
const SHELL = ["./", "index.html", "script.js", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim())));
// Arquivos do próprio site: rede primeiro (sempre atualizado), cache só se estiver offline.
// Recursos externos (imagens, fontes): cache primeiro e atualiza em segundo plano.
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url), h = u.hostname;
  if (r.method !== "GET" || h.endsWith("googleapis.com") || h.includes("firestore") || h.includes("identitytoolkit")) return;
  const mesmoSite = u.origin === location.origin;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(r);
    const net = fetch(r).then(res => { if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; }).catch(() => hit);
    return mesmoSite ? net.then(res => res || hit) : (hit || net);
  }));
});