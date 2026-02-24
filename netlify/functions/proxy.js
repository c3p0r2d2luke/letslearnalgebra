// netlify/functions/proxy.js

import { decodePath, encodeUrl } from "../../prxe/uv-encode.js";

export async function handler(event) {
  try {
    const target = getTarget(event);
    if (!target) {
      return { statusCode: 400, body: "Missing target URL" };
    }

    const res = await fetch(target, {
      method: event.httpMethod,
      headers: filterHeaders(event.headers, target),
      body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body
    });

    const type = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());

    if (type.includes("text/html")) {
      let html = buf.toString("utf8");
      html = rewriteHtml(html, target);
      return {
        statusCode: res.status,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: html
      };
    }

    if (type.includes("text/css")) {
      let css = buf.toString("utf8");
      css = rewriteCss(css, target);
      return {
        statusCode: res.status,
        headers: { "content-type": "text/css; charset=utf-8" },
        body: css
      };
    }

    if (type.includes("javascript")) {
      let js = buf.toString("utf8");
      js = rewriteJs(js, target);
      return {
        statusCode: res.status,
        headers: { "content-type": type },
        body: js
      };
    }

    return {
      statusCode: res.status,
      headers: { "content-type": type },
      body: buf.toString("base64"),
      isBase64Encoded: true
    };

  } catch (e) {
    return { statusCode: 500, body: "Proxy error: " + e.message };
  }
}

function getTarget(event) {
  // rawPath preserves the original URL
  const raw = event.rawPath || event.path;

  // remove "/p/"
  const encoded = raw.replace(/^\/p\//, "");
  if (!encoded) return null;

  return decodePath("/" + encoded);
}

function filterHeaders(headers, target) {
  const out = {};
  const url = new URL(target);
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    if (["host", "x-forwarded-host", "x-forwarded-proto"].includes(key)) continue;
    out[key] = v;
  }
  out["host"] = url.host;
  return out;
}

function proxify(url, base) {
  try {
    const abs = new URL(url, base).href;
    return encodeUrl(abs);
  } catch {
    return url;
  }
}

function rewriteHtml(html, base) {
  // FIX #1 — inject correct path AND inject early
  html = html.replace(
    /<head[^>]*>/i,
    match => `${match}<script src="/prxe/inject.js"></script>`
  );

  // Remove <base> tags
  html = html.replace(/<base[^>]*>/gi, "");

  // FIX #2 — skip already-proxied URLs
  html = html.replace(
    /\b(href|src|action)="(.*?)"/gi,
    (m, attr, value) => {
      if (value.startsWith("/p/")) return m;
      if (/^javascript:/i.test(value) || value.startsWith("#")) return m;
      return `${attr}="${proxify(value, base)}"`;
    }
  );

  html = html.replace(
    /\b(href|src|action)='(.*?)'/gi,
    (m, attr, value) => {
      if (value.startsWith("/p/")) return m;
      if (/^javascript:/i.test(value) || value.startsWith("#")) return m;
      return `${attr}='${proxify(value, base)}'`;
    }
  );

  // CSS url(...)
  html = html.replace(/url\((['"]?)(.+?)\1\)/gi, (m, q, v) => {
    if (v.startsWith("data:") || v.startsWith("/p/")) return m;
    return `url("${proxify(v, base)}")`;
  });

  return html;
}

function rewriteCss(css, base) {
  return css.replace(/url\((['"]?)(.+?)\1\)/gi, (m, q, v) => {
    if (v.startsWith("data:") || v.startsWith("/p/")) return m;
    return `url("${proxify(v, base)}")`;
  });
}

function rewriteJs(js, base) {
  return js.replace(
    /(["'`])((https?:)?\/\/[^"'`]+)\1/g,
    (m, q, v) => `${q}${proxify(v, base)}${q}`
  );
}
