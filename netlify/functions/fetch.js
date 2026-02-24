export async function handler(event) {
  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, body: "Missing url" };
  }

  const res = await fetch(url, {
    method: event.httpMethod,
    headers: event.headers,
    body:
      event.httpMethod === "GET" || event.httpMethod === "HEAD"
        ? undefined
        : event.body,
    redirect: "manual"
  });

  // Convert response to base64
  const buffer = Buffer.from(await res.arrayBuffer());

  const headers = {};
  res.headers.forEach((value, key) => {
    // Netlify disallows multiple set-cookie headers anyway
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });

  return {
    statusCode: res.status,
    headers,
    body: buffer.toString("base64"),
    isBase64Encoded: true
  };
}