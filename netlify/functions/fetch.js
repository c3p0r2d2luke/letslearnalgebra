export async function handler(event) {
  let url = event.queryStringParameters?.url;
  if (!url) return { statusCode: 400, body: "Missing url" };

  // Remove leading /prxe/ if present
  if (url.startsWith("/prxe/")) url = url.slice(6);

  // Add https if missing
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

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

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/css")
  ) {
    const body = await res.text();
    return { statusCode: res.status, headers, body };
  } else {
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: res.status,
      headers,
      body: buffer.toString("base64"),
      isBase64Encoded: true
    };
  }
}