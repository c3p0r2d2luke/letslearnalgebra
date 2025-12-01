export const config = {
  runtime: "edge", // optional: faster, low-latency serverless function
};

export default async function handler(req) {
  // --- CORS headers ---
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  try {
    const { path } = req.nextUrl.query; // Vercel Edge: use nextUrl.query
    if (!path) return new Response("Missing path", { status: 400, headers });

    // Build Supabase URL
    const supaPath = "/" + path.join("/");
    const supaUrl = new URL(
      `https://qjajtkdchvapthnidtwj.supabase.co${supaPath}`,
    );
    // Forward original query parameters
    for (const [key, value] of Object.entries(req.nextUrl.searchParams)) {
      supaUrl.searchParams.append(key, value);
    }

    // Parse body for non-GET
    let body = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await req.json();
      } catch {
        body = null;
      }
    }

    const response = await fetch(supaUrl.toString(), {
      method: req.method,
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        "Content-Type": req.headers.get("content-type") || "application/json",
      },
      body: body ? JSON.stringify(body) : null,
    });

    const text = await response.text();
    return new Response(text, { status: response.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers,
    });
  }
}
