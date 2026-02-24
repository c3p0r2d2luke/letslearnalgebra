self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith("/prxe/")) return;

  const target = decodeURIComponent(url.pathname.slice(6));
  if (!target.startsWith("http")) return;

  event.respondWith(
    fetch(`/api/fetch?url=${encodeURIComponent(target)}`, {
      method: event.request.method,
      headers: event.request.headers,
      body:
        event.request.method === "GET" ||
        event.request.method === "HEAD"
          ? undefined
          : event.request.body,
      credentials: "include"
    })
  );
});