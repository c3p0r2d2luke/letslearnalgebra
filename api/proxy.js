// api/proxy.js (Vercel)
import fetch from "node-fetch";

export default async function handler(req, res) {
  const SUPABASE_URL = "https://qjajtkdchvapthnidtwj.supabase.co";
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  const path = req.query.path || "rest/v1/messages";
  const method = req.method;
  const body = method !== "GET" ? JSON.stringify(req.body) : undefined;

  try {
    const response = await fetch(`${SUPABASE_URL}/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    });

    const data = await response.text();
    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
