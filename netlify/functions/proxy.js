export async function handler(event) {
  const target = event.queryStringParameters?.url;
  if (!target) {
    return {
      statusCode: 400,
      body: "Missing ?url="
    };
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    return { statusCode: 400, body: "Invalid URL" };
  }

  const res = await fetch(url.toString(), {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html,*/*"
    }
  });

  let html = await res.text();

  const base = url.origin;
  const pathBase = base + url.pathname.replace(/\/[^/]*$/, "/");

  const rewrite = (link) =>
    `/proxy?url=${encodeURIComponent(
      link.startsWith("http")
        ? link
        : link.startsWith("/")
        ? base + link
        : pathBase + link
    )}`;

  // Rewrite href/src/action
  html = html
    .replace(/(href|src|action)=["']([^"']+)["']/gi,
      (_, attr, link) => {
        if (
          link.startsWith("javascript:") ||
          link.startsWith("data:") ||
          link.startsWith("#")
        ) return `${attr}="${link}"`;
        return `${attr}="${rewrite(link)}"`;
      }
    )

    // Kill CSP (important)
    .replace(
      /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
      ""
    )

    // Fix base tags
    .replace(/<base[^>]*>/gi, "");

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-proxy": "netlify-html-proxy"
    },
    body: html
  };
}