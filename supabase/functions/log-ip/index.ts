import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const authorization = req.headers.get("authorization");
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase URL or publishable key configuration");
    return jsonResponse({ error: "IP logging is not configured" }, 500);
  }
  if (!authorization) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  try {
    const body = await req.json();
    if (!body || typeof body.username !== "string" || !body.username.trim()) {
      return jsonResponse({ error: "Missing username" }, 400);
    }

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: authorization },
    });
    if (!userResponse.ok) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    const authUser = await userResponse.json();
    if (typeof authUser.id !== "string") {
      return jsonResponse({ error: "Could not identify authenticated user" }, 401);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";
    const usersUrl = new URL("/rest/v1/users", supabaseUrl);
    usersUrl.searchParams.set("auth_id", `eq.${authUser.id}`);
    usersUrl.searchParams.set("username", `eq.${body.username.trim()}`);

    const updateResponse = await fetch(usersUrl, {
      method: "PATCH",
      headers: {
        apikey: supabaseKey,
        Authorization: authorization,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ ip }),
    });

    if (!updateResponse.ok) {
      console.error("IP database update failed:", await updateResponse.text());
      return jsonResponse({ error: "Failed to update IP" }, 500);
    }

    return jsonResponse({ success: true, ip });
  } catch (error) {
    console.error("IP log request failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected IP log error" }, 500);
  }
});
