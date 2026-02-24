self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith("/prxe/")) return;

  const target = decodeURIComponent(url.pathname.slice(6));
  if (!target.startsWith("http")) return;

  event.respondWith(
    (async () => {
      const res = await fetch(`/.netlify/functions/fetch?url=${encodeURIComponent(target)}`, {
        method: event.request.method,
        headers: event.request.headers,
        body: ["GET","HEAD"].includes(event.request.method) ? undefined : event.request.body,
        credentials: "include"
      });

      const headers = {};
      res.headers.forEach((v,k) => { if (k.toLowerCase() !== "set-cookie") headers[k]=v; });
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/html")) {
        let body = await res.text();
        const targetOrigin = new URL(target).origin;

        const rewrite = u => {
          if (!u) return u;
          if (u.startsWith("blob:") || u.startsWith("data:")) return u;
          let fullUrl;
          try { fullUrl = new URL(u, target).href; } catch { return u; }
          if (fullUrl.startsWith(targetOrigin)) return "/prxe/" + encodeURIComponent(fullUrl);
          return u;
        };

        body = body
          .replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, u) => `${attr}="${rewrite(u)}"`)
          .replace(/window\.location\s*=\s*["']([^"']+)["']/gi, (_, u) => `window.location="${rewrite(u)}"`)
          .replace(/fetch\((["'])([^"']+)\1/gi, (_, q, u) => `fetch(${q}${rewrite(u)}${q})`);

        return new Response(body, { status: res.status, headers });
      } else {
        const buffer = Buffer.from(await res.arrayBuffer());
        return new Response(buffer, { status: res.status, headers });
      }
    })()
  );
});