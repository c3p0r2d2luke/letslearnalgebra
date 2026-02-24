self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith("/prxe/")) return;

  const target = decodeURIComponent(url.pathname.slice(6));
  if (!target.startsWith("http")) return;

  event.respondWith(
    (async () => {
      // Fetch through your Netlify function
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(target)}`, {
        method: event.request.method,
        headers: event.request.headers,
        body:
          event.request.method === "GET" || event.request.method === "HEAD"
            ? undefined
            : event.request.body,
        credentials: "include"
      });

      // Clone headers
      const headers = {};
      res.headers.forEach((v, k) => {
        if (k.toLowerCase() === "set-cookie") return;
        headers[k] = v;
      });

      const contentType = res.headers.get("content-type") || "";
      let body;

      if (contentType.includes("text/html")) {
        // Get HTML text
        body = await res.text();

        // Rewrite all links, forms, scripts, JS redirects
        const rewrite = (u) => {
          if (!u) return u;
          if (u.startsWith("http") || u.startsWith("data:") || u.startsWith("blob:")) {
            return "/prxe/" + encodeURIComponent(u);
          }
          // Root-relative
          if (u.startsWith("/")) {
            const base = new URL(target).origin;
            return "/prxe/" + encodeURIComponent(base + u);
          }
          // Relative
          return "/prxe/" + encodeURIComponent(new URL(u, target).href);
        };

        // Rewrite href, src, action
        body = body
          .replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, u) => `${attr}="${rewrite(u)}"`)
          .replace(/window\.location\s*=\s*["']([^"']+)["']/gi, (_, u) => `window.location="${rewrite(u)}"`)
          .replace(/fetch\((["'])([^"']+)\1/gi, (_, q, u) => `fetch(${q}${rewrite(u)}${q})`);
      } else {
        // Not HTML? Return as-is
        const buffer = Buffer.from(await res.arrayBuffer());
        body = buffer.toString("base64");
        return new Response(body, {
          status: res.status,
          headers,
          isBase64Encoded: true
        });
      }

      return new Response(body, {
        status: res.status,
        headers
      });
    })()
  );
});