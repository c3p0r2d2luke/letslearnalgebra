import fetch from "node-fetch";

const SUPABASE_URL = "https://qjajtkdchvapthnidtwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqYWp0a2RjaHZhcHRobmlkdHdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyMTI4MDgsImV4cCI6MjA3Mzc4ODgwOH0.BYyhualVRAOqctt8u3flAH9PHKaAV8bedV8JeaYjf7M";

export default async function handler(req, res) {
  const { method } = req;
  const path = req.query.path?.join("/") || ""; // captures /proxy/... paths
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

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
