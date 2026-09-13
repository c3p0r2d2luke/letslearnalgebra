import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCORD_API = "https://discord.com/api/v10";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseClient = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  console.log("[DISCORD-OAUTH] Received request:", req.method);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[DISCORD-OAUTH] Request body action:", body.action);
    const { action, code, username, refresh_token, redirect_uri } = body;

    if (action === "exchange_code") {
      console.log("[DISCORD-OAUTH] Processing code exchange for username:", username);
      return await exchangeDiscordCode(code, username, redirect_uri);
    } else if (action === "refresh_token") {
      console.log("[DISCORD-OAUTH] Processing token refresh for username:", username);
      return await refreshDiscordToken(refresh_token, username);
    } else if (action === "link_session") {
      console.log("[DISCORD-OAUTH] Linking Discord auth session for username:", username);
      return await linkDiscordSessionAccount(body);
    } else if (action === "get_guilds") {
      console.log("[DISCORD-OAUTH] Processing guild fetch for username:", username);
      return await getDiscordGuilds(body);
    }

    console.error("[DISCORD-OAUTH] Invalid action:", action);
    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DISCORD-OAUTH] Error:", error.message);
    console.error("[DISCORD-OAUTH] Stack:", error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

  async function linkDiscordSessionAccount(body: {
    username: string;
    discord_user_id: string;
    discord_username: string;
    discord_tag?: string;
    access_token: string;
    refresh_token?: string | null;
    token_expires_at?: string;
    scopes?: string[];
  }) {
    if (!body.username || !body.discord_user_id || !body.discord_username || !body.access_token) {
      throw new Error("Missing Discord session account fields.");
    }

    const { data: account, error } = await supabaseClient
      .from("discord_accounts")
      .upsert({
        username: body.username,
        discord_user_id: body.discord_user_id,
        discord_username: body.discord_username,
        discord_tag: body.discord_tag || body.discord_username,
        access_token: body.access_token,
        refresh_token: body.refresh_token || null,
        token_expires_at: body.token_expires_at || null,
        scopes: body.scopes?.length ? body.scopes : ["identify", "guilds"],
        last_refreshed_at: new Date().toISOString(),
      }, { onConflict: "username" })
      .select()
      .single();

    if (error) throw error;

    if (account?.id) {
      const { error: userError } = await supabaseClient
        .from("users")
        .update({ discord_account_id: account.id })
        .eq("username", body.username);
      if (userError) throw userError;
    }

    return new Response(JSON.stringify({ success: true, account }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  async function exchangeDiscordCode(code: string, username: string, redirectUriParam?: string) {
    console.log("[DISCORD-OAUTH] Starting code exchange for username:", username);
    const clientId = Deno.env.get("DISCORD_CLIENT_ID")!;
    const clientSecret = Deno.env.get("DISCORD_CLIENT_SECRET")!;
    const redirectUri = redirectUriParam || Deno.env.get("DISCORD_REDIRECT_URI") || "http://localhost:3000";

    console.log("[DISCORD-OAUTH] Code exchange - Client ID:", clientId ? clientId.substring(0, 6) + "..." : "MISSING");
    console.log("[DISCORD-OAUTH] Code exchange - Redirect URI:", redirectUri);

    const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        scope: "identify guilds",
      }),
    });

    console.log("[DISCORD-OAUTH] Token response status:", tokenResponse.status);
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("[DISCORD-OAUTH] Token exchange failed:", errorText);
      throw new Error(`Discord token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
  console.log("[DISCORD-OAUTH] Token exchange successful, access_token expiry:", tokens.expires_in, "seconds");

  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  console.log("[DISCORD-OAUTH] User info response status:", userResponse.status);
  const discordUser = await userResponse.json();
  console.log("[DISCORD-OAUTH] Discord user ID:", discordUser.id, "username:", discordUser.username);

  // Upsert Discord account
  console.log("[DISCORD-OAUTH] Upserting Discord account in database...");
  const { data: upsertedAccount, error: upsertError } = await supabaseClient
    .from("discord_accounts")
    .upsert(
      {
        username,
        discord_user_id: discordUser.id,
        discord_username: discordUser.username,
        discord_tag: discordUser.discriminator ? `${discordUser.username}#${discordUser.discriminator}` : discordUser.username,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes: tokens.scope ? tokens.scope.split(" ") : ["identify", "guilds"],
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: "username" }
    )
    .select()
    .single();

  if (upsertError) {
    console.error("[DISCORD-OAUTH] Upsert error:", upsertError);
    throw upsertError;
  }

  console.log("[DISCORD-OAUTH] Account upserted successfully");

  // Update users table
  if (upsertedAccount?.id) {
    await supabaseClient
      .from("users")
      .update({ discord_account_id: upsertedAccount.id })
      .eq("username", username);
  }

  console.log("[DISCORD-OAUTH] Code exchange complete, returning success");
  return new Response(JSON.stringify({ success: true, discord_user: discordUser }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function refreshDiscordTokenHelper(refreshToken: string, username: string) {
  const clientId = Deno.env.get("DISCORD_CLIENT_ID")!;
  const clientSecret = Deno.env.get("DISCORD_CLIENT_SECRET")!;

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("[DISCORD-OAUTH] Token refresh failed:", errorText);
    return null;
  }

  const tokens = await tokenResponse.json();
  console.log("[DISCORD-OAUTH] Token refreshed successfully");

  const { error } = await supabaseClient
    .from("discord_accounts")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || refreshToken,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("username", username);

  if (error) {
    console.error("[DISCORD-OAUTH] Update error:", error);
  }

  return tokens;
}

async function refreshDiscordToken(refreshToken: string, username: string) {
  console.log("[DISCORD-OAUTH] Refreshing token for username:", username);
  const tokens = await refreshDiscordTokenHelper(refreshToken, username);
  if (!tokens) {
    throw new Error("Failed to refresh Discord token");
  }
  return new Response(JSON.stringify({ success: true, access_token: tokens.access_token }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getDiscordGuilds(body: any) {
  console.log("[DISCORD-OAUTH] Fetching Discord guilds...");
  let { username, access_token, refresh_token } = body;

  if (username) {
    const { data: acc } = await supabaseClient
      .from("discord_accounts")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (acc) {
      access_token = acc.access_token;
      refresh_token = acc.refresh_token;
    }
  }

  if (!access_token && !refresh_token) {
    throw new Error("No Discord access token or refresh token available. Please connect Discord first.");
  }

  let guildsResponse = await fetchDiscordApiWithRetry(`${DISCORD_API}/users/@me/guilds`, access_token);

  console.log("[DISCORD-OAUTH] Guilds response status:", guildsResponse.status);

  if (guildsResponse.status === 401 && refresh_token && username) {
    console.log("[DISCORD-OAUTH] Guild fetch got 401, attempting token refresh...");
    const refreshed = await refreshDiscordTokenHelper(refresh_token, username);
    if (refreshed?.access_token) {
      access_token = refreshed.access_token;
      guildsResponse = await fetchDiscordApiWithRetry(`${DISCORD_API}/users/@me/guilds`, access_token);
      console.log("[DISCORD-OAUTH] Retry guilds response status:", guildsResponse.status);
    }
  }

  if (!guildsResponse.ok) {
    const errorText = await guildsResponse.text();
    console.error("[DISCORD-OAUTH] Guild fetch failed:", errorText);
    throw new Error("Failed to fetch Discord guilds: " + errorText);
  }

  const guilds = await guildsResponse.json();
  console.log("[DISCORD-OAUTH] Fetched", guilds.length, "guilds");

  return new Response(JSON.stringify({ guilds }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchDiscordApiWithRetry(url: string, accessToken: string, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (response.status !== 429 || attempt === attempts - 1) return response;

    const payload = await response.json().catch(() => ({}));
    const retryAfter = Number(payload.retry_after || response.headers.get("Retry-After") || 1);
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfter * 1000)));
  }
  throw new Error("Discord API retry limit reached.");
}
