import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const KLIPY_API_KEY = Deno.env.get("KLIPY_API_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const { url, query } = await req.json();

  if (!url && !query) {
    return jsonResponse({ error: "Missing URL or query" }, 400);
  }

  try {
    if (query) {
      if (!KLIPY_API_KEY) {
        return jsonResponse({ error: "KLIPY_API_KEY is not configured" }, 503);
      }
      const searchUrl = `https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_API_KEY)}/gifs/search?q=${encodeURIComponent(query)}&page=1&per_page=24&content_filter=high&format_filter=gif,webp`;
      const res = await fetch(searchUrl);
      if (!res.ok) throw new Error(`Klipy API failed (${res.status})`);
      const data = await res.json();
      return jsonResponse(data.data?.data || data.data || data.results || []);
    }

    if (url) {
      if (/\.(gif|webp|mp4)(?:$|[?#])/i.test(url)) {
        return jsonResponse({ url });
      }
      
      // Fallback: Try Microlink to find the media
      const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}`;
      const res = await fetch(microlinkUrl);
      const data = await res.json();
      
      const mediaUrl = data.data?.image?.url || data.data?.video?.url;
      if (mediaUrl) {
        return jsonResponse({ url: mediaUrl });
      }
    }

    return jsonResponse({ url: null });

  } catch (error) {
    console.error("GIF Resolve Error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});