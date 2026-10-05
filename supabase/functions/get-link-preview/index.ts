import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url).searchParams.get("url");
  if (!url) return new Response("Missing URL", { status: 400 });

  try {
    // Use a server-side API key for Microlink if you have one, otherwise public
    const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}`;
    
    const res = await fetch(microlinkUrl, {
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Preview service unavailable" }), { status: 503 });
    }

    const data = await res.json();
    
    if (!data.data) {
      return new Response(JSON.stringify({ error: "No preview data found" }), { status: 404 });
    }

    return new Response(JSON.stringify(data), { 
      headers: { "Content-Type": "application/json" },
      status: 200 
    });
  } catch (error) {
    console.error("Preview Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});