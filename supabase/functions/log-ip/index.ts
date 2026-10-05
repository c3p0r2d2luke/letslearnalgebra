import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { username } = await req.json();
  if (!username) return new Response("Missing username", { status: 400 });

  try {
    // Get IP from request headers (Supabase Edge Functions run on Cloudflare/Cloudflare Workers usually)
    // Or fetch from a public API if headers are stripped
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
               req.headers.get("cf-connecting-ip") || 
               "unknown";

    // Update Supabase DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY"); // Or Service Role Key for admin actions

    const res = await fetch(`${supabaseUrl}/rest/v1/users`, {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ username, ip })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("DB Update Failed:", err);
      return new Response(JSON.stringify({ error: "Failed to update IP" }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, ip }), { status: 200 });
  } catch (error) {
    console.error("IP Log Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});