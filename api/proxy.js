import fetch from "node-fetch";

export default async function handler(req, res) {
  const SUPABASE_URL = "https://qjajtkdchvapthnidtwj.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"; // Use your anon/public key

  const path = req.query.path || "rest/v1/messages"; // default endpoint
  const method = req.method;
  const body = method !== "GET" ? JSON.stringify(req.body) : undefined;

  try {
    const response = await fetch(`${SUPABASE_URL}/${path}`, {
      method,
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
