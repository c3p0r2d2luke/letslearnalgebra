import https from "https";

export async function handler(event) {
  try {
    let url = event.queryStringParameters?.url;
    if (!url) return { statusCode: 400, body: "Missing url" };

    if (url.startsWith("/prxe/")) url = url.slice(6);
    url = decodeURIComponent(url);

    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    // Minimal headers
    const fetchHeaders = {};
    if (event.headers["user-agent"]) fetchHeaders["user-agent"] = event.headers["user-agent"];
    if (event.headers.accept) fetchHeaders.accept = event.headers.accept;

    const agent = new https.Agent({ rejectUnauthorized: false });

    const res = await fetch(url, {
      method: event.httpMethod,
      headers: fetchHeaders,
      body: ["GET","HEAD"].includes(event.httpMethod) ? undefined : event.body,
      redirect: "manual",
      agent
    });

    const headers = {};
    res.headers.forEach((v,k)=>{ if(k.toLowerCase()!=="set-cookie") headers[k]=v; });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/html") || contentType.includes("application/javascript") || contentType.includes("text/css")) {
      const body = await res.text();
      return { statusCode: res.status, headers, body };
    } else {
      const buffer = Buffer.from(await res.arrayBuffer());
      return { statusCode: res.status, headers, body: buffer.toString("base64"), isBase64Encoded:true };
    }

  } catch (err) {
    console.error("Fetch failed:", err);
    return { statusCode: 500, body: "Fetch failed: " + err.message };
  }
}