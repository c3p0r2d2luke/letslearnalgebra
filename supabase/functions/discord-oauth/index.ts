import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCORD_API = "https://discord.com/api/v10";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseClient = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  console.log("[DISCORD-OAUTH] Received request:", req.method);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const body = await req.json();
    console.log("[DISCORD-OAUTH] Request body action:", body.action);
    const { action, code, username, refresh_token } = body;

    if (action === "exchange_code") {
      console.log("[DISCORD-OAUTH] Processing code exchange for username:", username);
      return await exchangeDiscordCode(code, username);
    } else if (action === "refresh_token") {
      console.log("[DISCORD-OAUTH] Processing token refresh for username:", username);
      return await refreshDiscordToken(refresh_token, username);
    } else if (action === "get_guilds") {
      console.log("[DISCORD-OAUTH] Processing guild fetch");
      return await getDiscordGuilds(refresh_token);
    }

    console.error("[DISCORD-OAUTH] Invalid action:", action);
    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (error) {
    console.error("[DISCORD-OAUTH] Error:", error.message);
    console.error("[DISCORD-OAUTH] Stack:", error.stack);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function exchangeDiscordCode(code: string, username: string) {
  console.log("[DISCORD-OAUTH] Starting code exchange for username:", username);
  const clientId = Deno.env.get("DISCORD_CLIENT_ID")!;
  const clientSecret = Deno.env.get("DISCORD_CLIENT_SECRET")!;
  const redirectUri = Deno.env.get("DISCORD_REDIRECT_URI") || "http://localhost:3000/auth-callback";

  console.log("[DISCORD-OAUTH] Code exchange - Client ID:", clientId.substring(0, 6) + "...");
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
      scope: "identify guilds channels.read messages.read",
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
  const { error: upsertError } = await supabaseClient
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
        scopes: tokens.scope.split(" "),
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: "username" }
    );

  if (upsertError) {
    console.error("[DISCORD-OAUTH] Upsert error:", upsertError);
    throw upsertError;
  }

  console.log("[DISCORD-OAUTH] Account upserted successfully");

  // Update users table
  await supabaseClient
    .from("users")
    .update({ discord_account_id: (await supabaseClient
      .from("discord_accounts")
      .select("id")
      .eq("username", username)
      .single()).data?.id })
    .eq("username", username);

  console.log("[DISCORD-OAUTH] Code exchange complete, returning success");
  return new Response(JSON.stringify({ success: true, discord_user: discordUser }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function refreshDiscordToken(refreshToken: string, username: string) {
  console.log("[DISCORD-OAUTH] Refreshing token for username:", username);
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

  console.log("[DISCORD-OAUTH] Refresh token response status:", tokenResponse.status);
  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("[DISCORD-OAUTH] Token refresh failed:", errorText);
    throw new Error("Failed to refresh Discord token: " + errorText);
  }

  const tokens = await tokenResponse.json();
  console.log("[DISCORD-OAUTH] Token refreshed successfully");

  const { error } = await supabaseClient
    .from("discord_accounts")
    .update({
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("username", username);

  if (error) {
    console.error("[DISCORD-OAUTH] Update error:", error);
    throw error;
  }

  console.log("[DISCORD-OAUTH] Token refresh complete");
  return new Response(JSON.stringify({ success: true, access_token: tokens.access_token }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function getDiscordGuilds(accessToken: string) {
  console.log("[DISCORD-OAUTH] Fetching Discord guilds...");
  const guildsResponse = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  console.log("[DISCORD-OAUTH] Guilds response status:", guildsResponse.status);
  if (!guildsResponse.ok) {
    const errorText = await guildsResponse.text();
    console.error("[DISCORD-OAUTH] Guild fetch failed:", errorText);
    throw new Error("Failed to fetch Discord guilds: " + errorText);
  }

  const guilds = await guildsResponse.json();
  console.log("[DISCORD-OAUTH] Fetched", guilds.length, "guilds");

  return new Response(JSON.stringify({ guilds }), {
    headers: { "Content-Type": "application/json" },
  });
}
