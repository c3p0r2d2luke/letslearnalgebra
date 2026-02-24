export async function handler(event, context) {
  try {
    if (!event.body) {
      return { statusCode: 400, body: "No JSON body" };
    }

    const data = JSON.parse(event.body);
    const { pageURL } = data;

    if (!pageURL) {
      return { statusCode: 400, body: "Missing pageURL" };
    }

    const res = await fetch(pageURL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    let html = await res.text();

    // Base URL for resolving relative links
    const base = pageURL.replace(/\/[^\/]*$/, "");

    // Rewrite all <a href> links to go back through the proxy
    html = html.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, (match, href) => {
      let absolute;

      if (href.startsWith("http")) {
        absolute = href;
      } else if (href.startsWith("/")) {
        const origin = pageURL.match(/^https?:\/\/[^\/]+/)[0];
        absolute = origin + href;
      } else {
        absolute = base + "/" + href;
      }

      return match.replace(
        href,
        `https://letslearnalgebra.netlify.app/proxy?url=${encodeURIComponent(absolute)}`
      );
    });

    // Inject script to notify parent window of navigation
    const inject = `
      <script>
        try {
          window.parent.postMessage({ proxiedURL: "${pageURL}" }, "*");
        } catch (e) {}
      </script>
    `;

    html = html.replace("</body>", inject + "</body>");

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/html"
      },
      body: html
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: "Proxy error: " + err.message
    };
  }
}
