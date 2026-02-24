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

  // Copy headers except set-cookie
  const headers = {};
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return;
    headers[k] = v;
  });

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
    // Return HTML/JS as text
    const body = await res.text();
    return {
      statusCode: res.status,
      headers,
      body
    };
  } else {
    // Return everything else as base64
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: res.status,
      headers,
      body: buffer.toString("base64"),
      isBase64Encoded: true
    };
  }
}