import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { v4 as uuidv4 } from "https://deno.land/std@0.208.0/uuid/mod.ts";

const DISCORD_API = "https://discord.com/api/v10";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseClient = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  console.log("[DISCORD-IMPORT] Received request:", req.method);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const body = await req.json();
    console.log("[DISCORD-IMPORT] Request action:", body.action);
    const { action, discord_guild_id, access_token, username, sync_direction } = body;

    if (action === "import_server") {
      console.log("[DISCORD-IMPORT] Starting server import for guild:', discord_guild_id, "user:", username, "sync direction:", sync_direction);
      return await importDiscordServer(discord_guild_id, access_token, username, sync_direction);
    }

    console.error("[DISCORD-IMPORT] Invalid action:", action);
    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (error) {
    console.error("[DISCORD-IMPORT] Error:", error.message);
    console.error("[DISCORD-IMPORT] Stack:", error.stack);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function importDiscordServer(discordGuildId: string, accessToken: string, username: string, syncDirection: string) {
  try {
    console.log("[DISCORD-IMPORT] === IMPORT STARTED ===");
    console.log("[DISCORD-IMPORT] Guild ID:', discordGuildId);
    console.log("[DISCORD-IMPORT] Username:', username);
    console.log("[DISCORD-IMPORT] Sync direction:', syncDirection);
    
    // Fetch guild data from Discord
    console.log("[DISCORD-IMPORT] Fetching guild data from Discord API...");
    const guildResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log("[DISCORD-IMPORT] Guild response status:', guildResponse.status);
    if (!guildResponse.ok) {
      const errorText = await guildResponse.text();
      console.error("[DISCORD-IMPORT] Guild fetch failed:", errorText);
      throw new Error("Failed to fetch Discord guild: " + errorText);
    }

    const guild = await guildResponse.json();
    console.log("[DISCORD-IMPORT] Guild fetched:', guild.name, "members:", guild.approximate_member_count);

    // Fetch guild channels
    console.log("[DISCORD-IMPORT] Fetching channels...");
    const channelsResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const discordChannels = await channelsResponse.json();
    console.log("[DISCORD-IMPORT] Fetched', discordChannels.length, "channels");

    // Fetch guild roles
    console.log("[DISCORD-IMPORT] Fetching roles...");
    const rolesResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/roles`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const discordRoles = await rolesResponse.json();
    console.log("[DISCORD-IMPORT] Fetched', discordRoles.length, "roles");

    // Fetch guild members
    console.log("[DISCORD-IMPORT] Fetching members...");
    const membersResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/members?limit=1000`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const discordMembers = await membersResponse.json();
    console.log("[DISCORD-IMPORT] Fetched', discordMembers.length, "members");

    // Create native server
    console.log("[DISCORD-IMPORT] Creating native server in database...");
    const { data: nativeServer, error: serverError } = await supabaseClient
      .from("servers")
      .insert({
        name: guild.name,
        slug: `${guild.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        owner_username: username,
        icon_url: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
      })
      .select()
      .single();

    if (serverError) {
      console.error("[DISCORD-IMPORT] Server creation error:', serverError);
      throw serverError;
    }
    console.log("[DISCORD-IMPORT] Native server created:', nativeServer.id, "-", nativeServer.name);

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
        sync_direction: syncDirection,
        metadata: { guild_features: guild.features },
      })
      .select()
      .single();

    if (discordServerError) {
      console.error("[DISCORD-IMPORT] Discord server mapping error:', discordServerError);
      throw discordServerError;
    }
    console.log("[DISCORD-IMPORT] Discord server mapping created');

    // Import roles
    console.log("[DISCORD-IMPORT] Importing', discordRoles.length, "roles...");
    const roleMap = new Map();
    for (const discordRole of discordRoles) {
      if (discordRole.name === "@everyone") continue;

      const { data: nativeRole, error: roleError } = await supabaseClient
        .from("server_roles")
        .insert({
          server_id: nativeServer.id,
          name: discordRole.name,
          role: discordRole.name,
          color: `#${discordRole.color.toString(16).padStart(6, "0")}`,
          permissions: { discord_permissions: discordRole.permissions },
        })
        .select()
        .single();

      if (roleError) {
        console.error("[DISCORD-IMPORT] Role creation error:', roleError);
        throw roleError;
      }

      await supabaseClient
        .from("discord_roles")
        .insert({
          discord_server_id: discordServer.id,
          role_id: nativeRole.id,
          discord_role_id: discordRole.id,
          discord_role_name: discordRole.name,
          discord_color: `#${discordRole.color.toString(16).padStart(6, "0")}`,
          discord_permissions: discordRole.permissions,
        });

      roleMap.set(discordRole.id, nativeRole.id);
      console.log("[DISCORD-IMPORT] Role imported:', discordRole.name);
    }
    console.log("[DISCORD-IMPORT] All', roleMap.size, "roles imported");

    // Import channels
    console.log("[DISCORD-IMPORT] Importing', discordChannels.length, "channels...");
    const channelMap = new Map();
    for (const discordChannel of discordChannels) {
      if (discordChannel.type === 4) continue; // Skip category channels for now

      const { data: nativeChannel, error: channelError } = await supabaseClient
        .from("channels")
        .insert({
          name: discordChannel.name,
          server_id: nativeServer.id,
          channel_type: discordChannel.type === 0 ? "text" : "voice",
          sort_order: discordChannel.position || 0,
        })
        .select()
        .single();

      if (channelError) {
        console.error("[DISCORD-IMPORT] Channel creation error:', channelError);
        throw channelError;
      }

      await supabaseClient
        .from("discord_channels")
        .insert({
          discord_server_id: discordServer.id,
          channel_id: nativeChannel.id,
          discord_channel_id: discordChannel.id,
          discord_channel_name: discordChannel.name,
          channel_type: discordChannel.type === 0 ? "text" : "voice",
          metadata: { topic: discordChannel.topic, nsfw: discordChannel.nsfw },
        });

      channelMap.set(discordChannel.id, nativeChannel.id);
      console.log("[DISCORD-IMPORT] Channel imported:', discordChannel.name);
    }
    console.log("[DISCORD-IMPORT] All', channelMap.size, "channels imported");

    // Import members
    console.log("[DISCORD-IMPORT] Importing', discordMembers.length, "members...");
    for (const discordMember of discordMembers) {
      if (discordMember.user.bot) continue;

      // First, check if user exists in our system (optional - they may not be signed up yet)
      // For now, we just create server_members without requiring a chat account
      const { data: serverMember, error: memberError } = await supabaseClient
        .from("server_members")
        .insert({
          server_id: nativeServer.id,
          username: `discord-${discordMember.user.username}`, // Placeholder
          role: "member",
        })
        .select()
        .single();

      if (memberError && memberError.code !== "23505") {
        console.error("[DISCORD-IMPORT] Member creation error:', memberError);
        throw memberError;
      } // Ignore duplicate errors

      if (serverMember) {
        await supabaseClient
          .from("discord_members")
          .insert({
            discord_server_id: discordServer.id,
            member_id: serverMember.id,
            discord_user_id: discordMember.user.id,
            discord_username: discordMember.user.username,
            discord_roles: discordMember.roles,
          });
        console.log("[DISCORD-IMPORT] Member imported:', discordMember.user.username);
      }
    }
    console.log("[DISCORD-IMPORT] All members imported");

    console.log("[DISCORD-IMPORT] === IMPORT COMPLETE ===");
    return new Response(JSON.stringify({ success: true, server_id: nativeServer.id, discord_server_id: discordServer.id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DISCORD-IMPORT] === IMPORT FAILED ===");
    console.error("[DISCORD-IMPORT] Error:', error.message);
    console.error("[DISCORD-IMPORT] Stack:', error.stack);
    throw error;
  }
}
