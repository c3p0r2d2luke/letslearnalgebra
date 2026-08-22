import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCORD_API = "https://discord.com/api/v10";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseClient = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const { action, code, username, refresh_token } = await req.json();

    if (action === "exchange_code") {
      return await exchangeDiscordCode(code, username);
    } else if (action === "refresh_token") {
      return await refreshDiscordToken(refresh_token, username);
    } else if (action === "get_guilds") {
      return await getDiscordGuilds(refresh_token);
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function exchangeDiscordCode(code: string, username: string) {
  const clientId = Deno.env.get("DISCORD_CLIENT_ID")!;
  const clientSecret = Deno.env.get("DISCORD_CLIENT_SECRET")!;
  const redirectUri = Deno.env.get("DISCORD_REDIRECT_URI") || "http://localhost:3000/auth-callback";

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

  if (!tokenResponse.ok) {
    throw new Error(`Discord token exchange failed: ${await tokenResponse.text()}`);
  }

  const tokens = await tokenResponse.json();
  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  const discordUser = await userResponse.json();

  // Upsert Discord account
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

  if (upsertError) throw upsertError;

  // Update users table
  await supabaseClient
    .from("users")
    .update({ discord_account_id: (await supabaseClient
      .from("discord_accounts")
      .select("id")
      .eq("username", username)
      .single()).data?.id })
    .eq("username", username);

  return new Response(JSON.stringify({ success: true, discord_user: discordUser }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function refreshDiscordToken(refreshToken: string, username: string) {
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
    throw new Error("Failed to refresh Discord token");
  }

  const tokens = await tokenResponse.json();

  const { error } = await supabaseClient
    .from("discord_accounts")
    .update({
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("username", username);

  if (error) throw error;

  return new Response(JSON.stringify({ success: true, access_token: tokens.access_token }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function getDiscordGuilds(accessToken: string) {
  const guildsResponse = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!guildsResponse.ok) {
    throw new Error("Failed to fetch Discord guilds");
  }

  const guilds = await guildsResponse.json();

  return new Response(JSON.stringify({ guilds }), {
    headers: { "Content-Type": "application/json" },
  });
}
