import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TENOR_API_KEY = Deno.env.get("TENOR_API_KEY") || "LIVDSRZULELA";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { url, query } = await req.json();

  if (!url && !query) {
    return new Response("Missing URL or query", { status: 400 });
  }

  try {
    // 1. If it's a search query
    if (query) {
      const searchUrl = `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&limit=24&media_filter=minimal&contentfilter=high`;
      const res = await fetch(searchUrl);
      if (!res.ok) throw new Error("Tenor API failed");
      const data = await res.json();
      return new Response(JSON.stringify(data.results), { headers: { "Content-Type": "application/json" } });
    }

    // 2. If it's a URL resolution (Giphy/Tenor page)
    if (url) {
      // Simple heuristic: if it's a Tenor view page
      if (url.includes("tenor.com/view")) {
        // In a real scenario, you might scrape or use a specific API endpoint
        // For now, we return the URL if it looks like a direct media link
        if (/\.(gif|webp|mp4)/i.test(url)) {
          return new Response(JSON.stringify({ url }), { headers: { "Content-Type": "application/json" } });
        }
      }
      
      // Fallback: Try Microlink to find the media
      const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}`;
      const res = await fetch(microlinkUrl);
      const data = await res.json();
      
      const mediaUrl = data.data?.image?.url || data.data?.video?.url;
      if (mediaUrl) {
        return new Response(JSON.stringify({ url: mediaUrl }), { headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ url: null }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error("GIF Resolve Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});