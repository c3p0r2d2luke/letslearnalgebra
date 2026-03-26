export async function handler(event) {
  // 1. Read target URL
  const target = event.queryStringParameters?.url;
  if (!target) {
    return {
      statusCode: 400,
      body: "Missing ?url="
    };
  }

  // 2. Validate URL
  let url;
  try {
    url = new URL(target);
  } catch {
    return {
      statusCode: 400,
      body: "Invalid URL"
    };
  }

  // Only allow http(s)
  if (!/^https?:$/.test(url.protocol)) {
    return {
      statusCode: 400,
      body: "Only http/https URLs are supported"
    };
  }

  // 3. Fetch upstream HTML
  let res;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });
  } catch (err) {
    return {
      statusCode: 502,
      body: `Upstream fetch failed:\n${err.message}`
    };
  }

  // 4. Validate response
  if (!res.ok) {
    return {
      statusCode: res.status,
      body: `Upstream returned HTTP ${res.status}`
    };
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return {
      statusCode: 415,
      body: `Unsupported content-type: ${contentType}`
    };
  }

  // 5. Read HTML
  let html;
  try {
    html = await res.text();
  } catch {
    return {
      statusCode: 500,
      body: "Failed to read HTML body"
    };
  }

  // 6. Prepare URL rewriting
  const origin = url.origin;
  const pathBase =
    origin + url.pathname.replace(/\/[^/]*$/, "/");

  const rewriteUrl = (link) => {
    if (link.startsWith("http://") || link.startsWith("https://")) {
      return `/hello?url=${encodeURIComponent(link)}`;
    }
    if (link.startsWith("/")) {
      return `/hello?url=${encodeURIComponent(origin + link)}`;
    }
    return `/hello?url=${encodeURIComponent(pathBase + link)}`;
  };

  // 7. Rewrite HTML
  html = html
    // Rewrite href/src/action
    .replace(
      /(href|src|action)=["']([^"']+)["']/gi,
      (match, attr, link) => {
        if (
          link.startsWith("javascript:") ||
          link.startsWith("data:") ||
          link.startsWith("#")
        ) {
          return `${attr}="${link}"`;
        }
        return `${attr}="${rewriteUrl(link)}"`;
      }
    )

    // Remove CSP
    .replace(
      /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
      ""
    )

    // Remove base tags
    .replace(/<base[^>]*>/gi, "");

  // 8. Return rewritten HTML
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-powered-by": "netlify-html-hello"
    },
    body: html
  };
}