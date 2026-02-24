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
        body:
          event.request.method === "GET" || event.request.method === "HEAD"
            ? undefined
            : event.request.body,
        credentials: "include"
      });

      const headers = {};
      res.headers.forEach((v, k) => {
        if (k.toLowerCase() === "set-cookie") return;
        headers[k] = v;
      });

      const contentType = res.headers.get("content-type") || "";
      let body;

      if (contentType.includes("text/html")) {
        body = await res.text();
        const targetOrigin = new URL(target).origin;

        const rewrite = u => {
          if (!u) return u;
          if (u.startsWith("blob:") || u.startsWith("data:")) return u;

          let fullUrl;
          try { fullUrl = new URL(u, target).href; } catch { return u; }

          if (fullUrl.startsWith(targetOrigin)) {
            return "/prxe/" + encodeURIComponent(fullUrl);
          }

          return u; // external assets left alone
        };

        body = body
          .replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, u) => `${attr}="${rewrite(u)}"`)
          .replace(/window\.location\s*=\s*["']([^"']+)["']/gi, (_, u) => `window.location="${rewrite(u)}"`)
          .replace(/fetch\((["'])([^"']+)\1/gi, (_, q, u) => `fetch(${q}${rewrite(u)}${q})`);
      } else if (contentType.includes("application/javascript") || contentType.includes("text/css")) {
        body = await res.text();
      } else {
        const buffer = Buffer.from(await res.arrayBuffer());
        return new Response(buffer, { status: res.status, headers });
      }

      return new Response(body, { status: res.status, headers });
    })()
  );
});