export async function handler(event) {
  const url = event.queryStringParameters?.url;
  if (!url) return { statusCode: 400, body: "Missing url" };

  const res = await fetch(url, {
    method: event.httpMethod,
    headers: event.headers,
    body:
      event.httpMethod === "GET" || event.httpMethod === "HEAD"
        ? undefined
        : event.body,
    redirect: "manual"
  });

  const headers = {};
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return;
    headers[k] = v;
  });

  const contentType = res.headers.get("content-type") || "";

  // Return HTML, JS, CSS as text
  if (contentType.includes("text/html") ||
      contentType.includes("application/javascript") ||
      contentType.includes("text/css")) {
    const body = await res.text();
    return {
      statusCode: res.status,
      headers,
      body
    };
  } else {
    // Everything else: binary
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: res.status,
      headers,
      body: buffer.toString("base64"),
      isBase64Encoded: true
    };
  }
}