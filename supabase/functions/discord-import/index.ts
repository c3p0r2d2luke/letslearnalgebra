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
  console.log("[DISCORD-IMPORT] Received request:", req.method);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[DISCORD-IMPORT] Request action:", body.action);
    const { action, discord_guild_id, discord_guild, access_token, username, sync_direction } = body;

    if (action === "import_server") {
      console.log("[DISCORD-IMPORT] Starting server import for guild:", discord_guild_id, "user:", username, "sync direction:", sync_direction);
      return await importDiscordServer(discord_guild_id, access_token, username, sync_direction, discord_guild);
    }

    console.error("[DISCORD-IMPORT] Invalid action:", action);
    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DISCORD-IMPORT] Error:", error.message);
    console.error("[DISCORD-IMPORT] Stack:", error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function importDiscordServer(
  discordGuildId: string,
  accessTokenInput: string,
  username: string,
  syncDirection: string,
  guildInput?: Record<string, any>,
) {
  try {
    console.log("[DISCORD-IMPORT] === IMPORT STARTED ===");
    console.log("[DISCORD-IMPORT] Guild ID:", discordGuildId);
    console.log("[DISCORD-IMPORT] Username:", username);
    console.log("[DISCORD-IMPORT] Sync direction:", syncDirection);

    let accessToken = accessTokenInput;

    // Look up user's discord account to ensure we have the latest tokens
    if (username) {
      const { data: acc } = await supabaseClient
        .from("discord_accounts")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (acc?.access_token) {
        accessToken = acc.access_token;
      }
    }

    if (!accessToken) {
      throw new Error("No Discord access token found. Please connect your Discord account.");
    }

    let guild = guildInput && guildInput.id === discordGuildId ? guildInput : null;
    if (!guild) {
      const guildsResponse = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!guildsResponse.ok) {
        const errorText = await guildsResponse.text();
        throw new Error("Failed to fetch Discord server list: " + errorText);
      }
      const guilds = await guildsResponse.json();
      guild = guilds.find((item: Record<string, any>) => item.id === discordGuildId);
    }
    if (!guild) {
      throw new Error("Selected Discord server was not found in the connected Discord account.");
    }
    console.log("[DISCORD-IMPORT] Guild fetched:", guild.name);

    // Fetch channels using User Token (or Bot Token fallback if bot token exists)
    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    const fetchHeaders = botToken ? { Authorization: `Bot ${botToken}` } : { Authorization: `Bearer ${accessToken}` };

    console.log("[DISCORD-IMPORT] Fetching channels...");
    let channelsResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/channels`, {
      headers: fetchHeaders,
    });
    if (!channelsResponse.ok && botToken) {
      channelsResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/channels`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    const discordChannels = channelsResponse.ok ? await channelsResponse.json() : [];
    if (!channelsResponse.ok) {
      console.warn("[DISCORD-IMPORT] Channels unavailable; importing a default channel.");
    }
    console.log("[DISCORD-IMPORT] Fetched", discordChannels.length, "channels");

    // Fetch roles
    console.log("[DISCORD-IMPORT] Fetching roles...");
    let rolesResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/roles`, {
      headers: fetchHeaders,
    });
    if (!rolesResponse.ok && botToken) {
      rolesResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/roles`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    const discordRoles = rolesResponse.ok ? await rolesResponse.json() : [];
    if (!rolesResponse.ok) {
      console.warn("[DISCORD-IMPORT] Roles unavailable; continuing without imported roles.");
    }
    console.log("[DISCORD-IMPORT] Fetched", discordRoles.length, "roles");

    // Fetch members
    console.log("[DISCORD-IMPORT] Fetching members...");
    let membersResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/members?limit=1000`, {
      headers: fetchHeaders,
    });
    if (!membersResponse.ok && botToken) {
      membersResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/members?limit=1000`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    const discordMembers = membersResponse.ok ? await membersResponse.json() : [];
    if (!membersResponse.ok) {
      console.warn("[DISCORD-IMPORT] Members unavailable; continuing without imported members.");
    }
    console.log("[DISCORD-IMPORT] Fetched", discordMembers.length, "members");

    // Create native server in database
    console.log("[DISCORD-IMPORT] Creating native server in database...");
    const slugBase = guild.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const { data: nativeServer, error: serverError } = await supabaseClient
      .from("servers")
      .insert({
        name: guild.name,
        slug: `${slugBase || "discord"}-${Date.now()}`,
        owner_username: username,
        icon_url: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
      })
      .select()
      .single();

    if (serverError) {
      console.error("[DISCORD-IMPORT] Server creation error:", serverError);
      throw serverError;
    }
    console.log("[DISCORD-IMPORT] Native server created:", nativeServer.id, "-", nativeServer.name);

    // CRITICAL: Insert importing user into server_members so the server appears in their server list!
    const { error: ownerMemberError } = await supabaseClient
      .from("server_members")
      .insert({
        server_id: nativeServer.id,
        username: username,
        role: "owner",
      });

    if (ownerMemberError) {
      console.warn("[DISCORD-IMPORT] Owner member insertion warning:", ownerMemberError);
    } else {
      console.log("[DISCORD-IMPORT] Owner added to server_members");
    }

    // Create discord_servers mapping
    console.log("[DISCORD-IMPORT] Creating Discord server mapping...");
    const { data: discordServer, error: discordServerError } = await supabaseClient
      .from("discord_servers")
      .insert({
        server_id: nativeServer.id,
        discord_guild_id: guild.id,
        discord_guild_name: guild.name,
        discord_owner_id: guild.owner_id,
        discord_icon_url: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
        sync_direction: syncDirection || "bidirectional",
        metadata: { guild_features: guild.features || [] },
      })
      .select()
      .single();

    if (discordServerError) {
      console.error("[DISCORD-IMPORT] Discord server mapping error:", discordServerError);
      throw discordServerError;
    }
    console.log("[DISCORD-IMPORT] Discord server mapping created");

    // Import roles
    console.log("[DISCORD-IMPORT] Importing roles...");
    const roleMap = new Map();
    if (Array.isArray(discordRoles)) {
      for (const discordRole of discordRoles) {
        if (discordRole.name === "@everyone") continue;

        const { data: nativeRole, error: roleError } = await supabaseClient
          .from("server_roles")
          .insert({
            server_id: nativeServer.id,
            name: discordRole.name,
            role: discordRole.name,
            color: `#${(discordRole.color || 0).toString(16).padStart(6, "0")}`,
            permissions: { discord_permissions: discordRole.permissions },
          })
          .select()
          .single();

        if (roleError) {
          console.warn("[DISCORD-IMPORT] Role creation error:", roleError);
          continue;
        }

        await supabaseClient
          .from("discord_roles")
          .insert({
            discord_server_id: discordServer.id,
            role_id: nativeRole.id,
            discord_role_id: discordRole.id,
            discord_role_name: discordRole.name,
            discord_color: `#${(discordRole.color || 0).toString(16).padStart(6, "0")}`,
            discord_permissions: discordRole.permissions,
          });

        roleMap.set(discordRole.id, nativeRole.id);
      }
    }

    // Import channels
    console.log("[DISCORD-IMPORT] Importing channels...");
    const channelMap = new Map();
    if (Array.isArray(discordChannels)) {
      for (const discordChannel of discordChannels) {
        if (discordChannel.type === 4) continue; // Skip category channels for now

        const { data: nativeChannel, error: channelError } = await supabaseClient
          .from("channels")
          .insert({
            name: discordChannel.name,
            server_id: nativeServer.id,
            channel_type: discordChannel.type === 2 ? "voice" : "text",
            sort_order: discordChannel.position || 0,
          })
          .select()
          .single();

        if (channelError) {
          console.warn("[DISCORD-IMPORT] Channel creation error:", channelError);
          continue;
        }

        await supabaseClient
          .from("discord_channels")
          .insert({
            discord_server_id: discordServer.id,
            channel_id: nativeChannel.id,
            discord_channel_id: discordChannel.id,
            discord_channel_name: discordChannel.name,
            channel_type: discordChannel.type === 2 ? "voice" : "text",
            metadata: { topic: discordChannel.topic, nsfw: discordChannel.nsfw },
          });

        channelMap.set(discordChannel.id, nativeChannel.id);
      }
    }

    // Create a default general text channel if no text channel was imported
    if (channelMap.size === 0) {
      console.log("[DISCORD-IMPORT] Creating default general channel...");
      const { data: defaultChannel } = await supabaseClient
        .from("channels")
        .insert({
          name: "general",
          server_id: nativeServer.id,
          channel_type: "text",
          sort_order: 0,
        })
        .select()
        .single();
      if (defaultChannel) {
        channelMap.set("general", defaultChannel.id);
      }
    }

    // Import members
    console.log("[DISCORD-IMPORT] Importing members...");
    if (Array.isArray(discordMembers)) {
      for (const discordMember of discordMembers) {
        if (discordMember.user?.bot) continue;

        // Skip adding owner again if already added
        const memberUsername = discordMember.user?.username;
        if (memberUsername && memberUsername === username) continue;

        const placeholderUsername = `discord-${discordMember.user?.id || Date.now()}`;
        const { data: serverMember, error: memberError } = await supabaseClient
          .from("server_members")
          .insert({
            server_id: nativeServer.id,
            username: placeholderUsername,
            role: "member",
          })
          .select()
          .single();

        if (serverMember) {
          await supabaseClient
            .from("discord_members")
            .insert({
              discord_server_id: discordServer.id,
              member_id: serverMember.id,
              discord_user_id: discordMember.user.id,
              discord_username: discordMember.user.username,
              discord_roles: discordMember.roles || [],
            });
        }
      }
    }

    console.log("[DISCORD-IMPORT] === IMPORT COMPLETE ===");
    return new Response(
      JSON.stringify({
        success: true,
        server_id: nativeServer.id,
        discord_server_id: discordServer.id,
        imported: {
          channels: channelMap.size,
          roles: roleMap.size,
          members: discordMembers.length,
        },
        warnings: [
          ...(!botToken ? ["Set DISCORD_BOT_TOKEN and invite the bot to this server to import channels, roles, and members."] : []),
          ...(discordChannels.length === 0 ? ["No Discord channels were imported."] : []),
          ...(discordRoles.length === 0 ? ["No Discord roles were imported."] : []),
          ...(discordMembers.length === 0 ? ["No Discord members were imported."] : []),
        ],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[DISCORD-IMPORT] === IMPORT FAILED ===");
    console.error("[DISCORD-IMPORT] Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
