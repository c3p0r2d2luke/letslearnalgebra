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
    const { data: linkedDiscordAccount } = await supabaseClient
      .from("discord_accounts")
      .select("discord_user_id")
      .eq("username", username)
      .maybeSingle();

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
    const diagnostics = {
      bot_token_configured: Boolean(botToken),
      channels_status: null as number | null,
      roles_status: null as number | null,
      members_status: null as number | null,
      message_channels_attempted: 0,
      message_channels_succeeded: 0,
      channel_inserts_failed: 0,
      message_inserts_failed: 0,
      role_inserts_failed: 0,
      member_inserts_failed: 0,
      api_errors: [] as string[],
    };
    const fetchHeaders = botToken ? { Authorization: `Bot ${botToken}` } : { Authorization: `Bearer ${accessToken}` };

    console.log("[DISCORD-IMPORT] Fetching channels...");
    if (!botToken) {
      throw new Error("DISCORD_BOT_TOKEN is not configured in Supabase.");
    }

    const botIdentityResponse = await fetch(`${DISCORD_API}/users/@me`, { headers: fetchHeaders });
    if (!botIdentityResponse.ok) {
      const errorText = await botIdentityResponse.text();
      throw new Error(`DISCORD_BOT_TOKEN is invalid (${botIdentityResponse.status}): ${errorText}`);
    }
    const botIdentity = await botIdentityResponse.json();
    console.log("[DISCORD-IMPORT] Bot authenticated as:", botIdentity.username, botIdentity.id);

    const botGuildResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}`, { headers: fetchHeaders });
    if (!botGuildResponse.ok) {
      const errorText = await botGuildResponse.text();
      throw new Error(`Bot cannot access Discord server ${discordGuildId} (${botGuildResponse.status}): ${errorText}`);
    }
    let channelsResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/channels`, {
      headers: fetchHeaders,
    });
    if (!channelsResponse.ok && botToken) {
      channelsResponse = await fetch(`${DISCORD_API}/guilds/${discordGuildId}/channels`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    const discordChannels = channelsResponse.ok ? await channelsResponse.json() : [];
    diagnostics.channels_status = channelsResponse.status;
    if (!channelsResponse.ok) {
      diagnostics.api_errors.push(`channels ${channelsResponse.status}: ${await channelsResponse.text()}`);
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
    diagnostics.roles_status = rolesResponse.status;
    if (!rolesResponse.ok) {
      diagnostics.api_errors.push(`roles ${rolesResponse.status}: ${await rolesResponse.text()}`);
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
    diagnostics.members_status = membersResponse.status;
    if (!membersResponse.ok) {
      diagnostics.api_errors.push(`members ${membersResponse.status}: ${await membersResponse.text()}`);
      console.warn("[DISCORD-IMPORT] Members unavailable; continuing without imported members.");
    }
    console.log("[DISCORD-IMPORT] Fetched", discordMembers.length, "members");

    const discordMessagesByChannel = new Map<string, Record<string, any>[]>();
    if (botToken && Array.isArray(discordChannels)) {
      for (const discordChannel of discordChannels) {
        if (![0, 5].includes(discordChannel.type)) continue;
        diagnostics.message_channels_attempted += 1;
        const messagesResponse = await fetch(
          `${DISCORD_API}/channels/${discordChannel.id}/messages?limit=100`,
          { headers: fetchHeaders }
        );
        if (messagesResponse.ok) {
          discordMessagesByChannel.set(discordChannel.id, await messagesResponse.json());
          diagnostics.message_channels_succeeded += 1;
        } else {
          diagnostics.api_errors.push(`messages:${discordChannel.id} ${messagesResponse.status}: ${await messagesResponse.text()}`);
          console.warn("[DISCORD-IMPORT] Message history unavailable for channel:", discordChannel.name);
        }
      }
    }

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
          diagnostics.role_inserts_failed += 1;
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
    const categoryMap = new Map();
    if (Array.isArray(discordChannels)) {
      for (const discordCategory of discordChannels.filter((channel) => channel.type === 4)) {
        const { data: nativeCategory, error: categoryError } = await supabaseClient
          .from("categories")
          .insert({
            name: discordCategory.name,
            server_id: nativeServer.id,
            created_by: username,
            sort_order: discordCategory.position || 0,
          })
          .select()
          .single();
        if (!categoryError && nativeCategory) categoryMap.set(discordCategory.id, nativeCategory.id);
      }
    }
    if (Array.isArray(discordChannels)) {
      for (const discordChannel of discordChannels) {
        if (discordChannel.type === 4) continue;

        const { data: nativeChannel, error: channelError } = await supabaseClient
          .from("channels")
          .insert({
            name: discordChannel.name,
            server_id: nativeServer.id,
            channel_type: discordChannel.type === 2 ? "voice" : "text",
            sort_order: discordChannel.position || 0,
            category_id: categoryMap.get(discordChannel.parent_id) || null,
          })
          .select()
          .single();

        if (channelError) {
          diagnostics.channel_inserts_failed += 1;
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

        const importedMessages = discordMessagesByChannel.get(discordChannel.id) || [];
        for (const discordMessage of importedMessages.reverse()) {
          const embedText = (discordMessage.embeds || [])
            .map((embed: Record<string, any>) => [
              embed.author?.name,
              embed.title,
              embed.description,
              ...(embed.fields || []).map((field: Record<string, string>) => `${field.name}: ${field.value}`),
              embed.url,
              embed.image?.url,
              embed.thumbnail?.url,
              embed.footer?.text,
            ].filter(Boolean).join("\n"))
            .filter(Boolean)
            .join("\n\n");
          const messageContent = [discordMessage.content, embedText].filter(Boolean).join("\n\n").trim();
          if (!messageContent) continue;
          const discordAuthor = discordMessage.author;
          const authorUsername = `discord-${discordAuthor?.id || "unknown"}`;
          const authorDisplayName = discordAuthor?.global_name || discordAuthor?.username || authorUsername;
          const authorAvatarUrl = discordAuthor?.avatar
            ? `https://cdn.discordapp.com/avatars/${discordAuthor.id}/${discordAuthor.avatar}.png`
            : null;
          await supabaseClient.from("users").upsert({
            username: authorUsername,
            display_name: authorDisplayName,
            avatar_url: authorAvatarUrl,
          }, { onConflict: "username", ignoreDuplicates: false });
          const { data: nativeMessage, error: messageError } = await supabaseClient
            .from("messages")
            .insert({
              username: authorUsername,
              content: messageContent,
              channel_id: nativeChannel.id,
              inserted_at: discordMessage.timestamp || new Date().toISOString(),
            })
            .select("id")
            .single();
          if (messageError || !nativeMessage) {
            diagnostics.message_inserts_failed += 1;
            continue;
          }
          await supabaseClient.from("discord_message_mapping").insert({
            discord_server_id: discordServer.id,
            discord_channel_id: discordChannel.id,
            chat_message_id: nativeMessage.id,
            discord_message_id: discordMessage.id,
          });
        }
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
        const isImportingUser = linkedDiscordAccount?.discord_user_id === discordMember.user?.id;
        const displayName = discordMember.nick || discordMember.user?.global_name || discordMember.user?.username;
        const avatarUrl = discordMember.avatar
          ? `https://cdn.discordapp.com/guilds/${discordGuildId}/users/${discordMember.user.id}/avatars/${discordMember.avatar}.png`
          : discordMember.user?.avatar
          ? `https://cdn.discordapp.com/avatars/${discordMember.user.id}/${discordMember.user.avatar}.png`
          : null;

        if (isImportingUser) {
          const { data: linkedMember } = await supabaseClient.from("server_members").update({
            profile_display_name: displayName || username,
            profile_avatar_url: avatarUrl,
          }).eq("server_id", nativeServer.id).eq("username", username).select("id").maybeSingle();
          if (linkedMember) {
            await supabaseClient.from("discord_members").upsert({
              discord_server_id: discordServer.id,
              member_id: linkedMember.id,
              discord_user_id: discordMember.user.id,
              discord_username: discordMember.user.username,
              discord_roles: discordMember.roles || [],
            }, { onConflict: "member_id,discord_user_id" });
          }
          continue;
        }

        // Skip adding owner again if already added
        const memberUsername = discordMember.user?.username;
        if (memberUsername && memberUsername === username) continue;

        const placeholderUsername = `discord-${discordMember.user?.id || Date.now()}`;
        await supabaseClient.from("users").upsert({
          username: placeholderUsername,
          display_name: displayName || placeholderUsername,
          avatar_url: avatarUrl,
        }, { onConflict: "username", ignoreDuplicates: false });
        const { data: serverMember, error: memberError } = await supabaseClient
          .from("server_members")
          .insert({
            server_id: nativeServer.id,
            username: placeholderUsername,
            role: discordMember.user?.bot ? "Bot" : "member",
            profile_display_name: displayName || placeholderUsername,
            profile_avatar_url: avatarUrl,
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
          for (const discordRoleId of discordMember.roles || []) {
            const nativeRoleId = roleMap.get(discordRoleId);
            if (nativeRoleId) {
              await supabaseClient.from("server_member_roles").insert({
                server_id: nativeServer.id,
                member_id: serverMember.id,
                role_id: nativeRoleId,
              });
            } else {
              diagnostics.member_inserts_failed += 1;
            }
          }
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
          messages: [...discordMessagesByChannel.values()].flat().length,
          categories: categoryMap.size,
        },
        warnings: [
          ...(!botToken ? ["Set DISCORD_BOT_TOKEN and invite the bot to this server to import channels, roles, and members."] : []),
          ...(discordChannels.length === 0 ? ["No Discord channels were imported."] : []),
          ...(discordRoles.length === 0 ? ["No Discord roles were imported."] : []),
          ...(discordMembers.length === 0 ? ["No Discord members were imported."] : []),
          ...(discordMessagesByChannel.size === 0 ? ["No Discord message history was imported."] : []),
        ],
        diagnostics,
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
