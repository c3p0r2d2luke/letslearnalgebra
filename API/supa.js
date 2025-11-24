export default async function handler(req, res) {
  const target = "https://qjajtkdchvapthnidtwj.supabase.co" + req.url.replace("/api/supa", "");

  const response = await fetch(target, {
    method: req.method,
    headers: {
      // Do NOT expose keys to client — only use them server-side
      apiKey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.sb_publishable_7uXWpCRbMA4Zq-qiWz9Dmw__G1n8GIA}`,
      "Content-Type": req.headers["content-type"] || "application/json"
    },
    body: req.method === "GET" ? null : JSON.stringify(req.body)
  });

  const text = await response.text();
  res.status(response.status).send(text);
}
