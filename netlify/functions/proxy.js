// netlify/functions/proxy.js

export async function handler(event) {
  try {
    const url = event.queryStringParameters.url;
    if (!url) {
      return { statusCode: 400, body: "Missing ?url=" };
    }

    const res = await fetch(url);
    let html = await res.text();

    // Basic rewrite: convert all absolute/relative links to proxy links
    html = html.replace(/href="([^"]+)"/g, (m, link) => {
      const newURL = new URL(link, url).href;
      return `href="/proxy?url=${encodeURIComponent(newURL)}"`;
    });

    html = html.replace(/src="([^"]+)"/g, (m, link) => {
      const newURL = new URL(link, url).href;
      return `src="/proxy?url=${encodeURIComponent(newURL)}"`;
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: html
    };

  } catch (err) {
    return { statusCode: 500, body: "Proxy error: " + err.message };
  }
}
