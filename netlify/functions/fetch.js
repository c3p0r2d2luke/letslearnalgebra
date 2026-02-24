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

  return {
    statusCode: res.status,
    headers,
    body: await res.arrayBuffer()
  };
}