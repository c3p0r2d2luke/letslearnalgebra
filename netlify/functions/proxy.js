// netlify/functions/proxy.js

import { decodePath, encodeUrl } from "../../prxe/uv-encode.js";

export async function handler(event) {
  const debug = event.queryStringParameters?.debug === "1";

  try {
    const target = getTarget(event);
    if (!target) {
      return respond(
        400,
        debug,
        { error: "Missing target URL", event },
        "Missing target URL"
      );
    }

    const headers = filterHeaders(event.headers, target);

    const res = await fetch(target, {
      method: event.httpMethod,
      headers,
      body: ["GET", "HEAD"].includes(event.httpMethod)
        ? undefined
        : event.body
    });

    const type = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());

    if (type.includes("text/html")) {
      let html = buf.toString("utf8");
      html = rewriteHtml(html, target);
      return respond(res.status, debug, {
        type,
        target,
        rewritten: "html"
      }, html, "text/html; charset=utf-8");
    }

    if (type.includes("text/css")) {
      let css = buf.toString("utf8");
      css = rewriteCss(css, target);
      return respond(res.status, debug, {
        type,
        target,
        rewritten: "css"
      }, css, "text/css; charset=utf-8");
    }

    if (type.includes("javascript")) {
      let js = buf.toString("utf8");
      js = rewriteJs(js, target);
      return respond(res.status, debug, {
        type,
        target,
        rewritten: "js"
      }, js, type);
    }

    // Binary
    return {
      statusCode: res.status,
      headers: { "content-type": type },
      body: buf.toString("base64"),
      isBase64Encoded: true
    };

  } catch (e) {
    return respond(
      500,
      debug,
      {
        name: e.name,
        message: e.message,
        stack: e.stack,
        path: event.path,
        query: event.queryStringParameters
      },
      "Proxy error: " + e.message
    );
  }
}

/* ================= HELPERS ================= */

function respond(status, debug, debugObj, body, contentType = "text/plain") {
  if (debug) {
    return {
      statusCode: status,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(debugObj, null, 2)
    };
  }

  return {
    statusCode: status,
    headers: { "content-type": contentType },
    body
  };
}

function getTarget(event) {
  let encoded = event.queryStringParameters?.url;
  if (!encoded) return null;

  if (!/^https?:\/\//i.test(encoded)) {
    encoded = "https://" + encoded;
  }

  // decodePath expects leading slash
  return decodePath("/" + encoded);
}

/**
 * 🚨 CRITICAL FIX
 * Invalid characters were caused by forwarding unsafe headers.
 */
function filterHeaders(headers, target) {
  const out = {};
  const url = new URL(target);

  for (const [k, v] of Object.entries(headers || {})) {
    if (!v) continue;
    if (Array.isArray(v)) continue;

    const key = k.toLowerCase();

    if (
      [
        "host",
        "connection",
        "content-length",
        "accept-encoding",
        "x-forwarded-for",
        "x-forwarded-proto",
        "x-nf-client-connection-ip"
      ].includes(key)
    ) continue;

    out[key] = String(v);
  }

  out.host = url.host;
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

/* ================= REWRITES ================= */

function rewriteHtml(html, base) {
  html = html.replace(
    /<head[^>]*>/i,
    m => `${m}<script src="/prxe/inject.js"></script>`
  );

  html = html.replace(/<base[^>]*>/gi, "");

  html = html.replace(
    /\b(href|src|action)="(.*?)"/gi,
    (m, attr, value) => {
      if (value.startsWith("/p/")) return m;
      if (/^(javascript:|#)/i.test(value)) return m;
      return `${attr}="${proxify(value, base)}"`;
    }
  );

  html = html.replace(
    /\b(href|src|action)='(.*?)'/gi,
    (m, attr, value) => {
      if (value.startsWith("/p/")) return m;
      if (/^(javascript:|#)/i.test(value)) return m;
      return `${attr}='${proxify(value, base)}'`;
    }
  );

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