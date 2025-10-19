import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Your Supabase credentials
const SUPABASE_URL = "https://qjajtkdchvapthnidtwj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqYWp0a2RjaHZhcHRobmlkdHdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyMTI4MDgsImV4cCI6MjA3Mzc4ODgwOH0.BYyhualVRAOqctt8u3flAH9PHKaAV8bedV8JeaYjf7M";

// ✅ Proxy handler
app.all("/api/proxy/*", async (req, res) => {
  const path = req.params[0]; // everything after /api/proxy/
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

    // Pass through Supabase's response
    const data = await response.text();
    res
      .status(response.status)
      .type(response.headers.get("content-type"))
      .send(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
