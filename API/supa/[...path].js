export default async function handler(req, res) {
  // --- CORS headers ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // --- Build Supabase URL dynamically ---
  const { path } = req.query;
  const supaPath = "/" + path.join("/"); 
  const query = req.url.split("?")[1];
  const supaUrl =
    "https://qjajtkdchvapthnidtwj.supabase.co" +
    supaPath +
    (query ? "?" + query : "");

  // --- Forward the request ---
  const response = await fetch(supaUrl, {
    method: req.method,
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      "Content-Type": req.headers["content-type"] || "application/json",
    },
    body: req.method === "GET" ? null : JSON.stringify(req.body),
  });

  const text = await response.text();
  res.status(response.status).send(text);
}
