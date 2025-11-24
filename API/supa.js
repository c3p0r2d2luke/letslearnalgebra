export default async function handler(req, res) {
  // --- CORS FIX ---
  res.setHeader("Access-Control-Allow-Origin", "*");         // allow all origins
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // -------------------

  // Build target URL
  const path = req.url.replace("/api/supa", "");
  const target = "https://qjajtkdchvapthnidtwj.supabase.co" + path;

  const response = await fetch(target, {
    method: req.method,
    headers: {
      apiKey: process.env.sb_publishable_7uXWpCRbMA4Zq-qiWz9Dmw__G1n8GIA,
      Authorization: `Bearer ${process.env.sb_publishable_7uXWpCRbMA4Zq-qiWz9Dmw__G1n8GIA}`,
      "Content-Type": req.headers["content-type"] || "application/json",
    },
    body: req.method === "GET" ? null : JSON.stringify(req.body),
  });

  const text = await response.text();
  res.status(response.status).send(text);
}
