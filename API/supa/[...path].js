export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // CORS preflight shortcut
  }
  // --------------------

  // Extract the dynamic path
  const { path } = req.query;

  // Build Supabase path
  const supaPath = "/" + path.join("/");

  // Keep query params
  const query = req.url.split("?")[1];
  const supaUrl =
    "https://YOURPROJECT.supabase.co" +
    supaPath +
    (query ? "?" + query : "");

  // Forward the request
  const response = await fetch(supaUrl, {
    method: req.method,
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY, // safe
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      "Content-Type": req.headers["content-type"] || "application/json",
    },
    body: req.method === "GET" ? null : JSON.stringify(req.body),
  });

  const text = await response.text();
  res.status(response.status).send(text);
}
