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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, message_id, channel_id, server_id, webhook_url } = body;

    if (action === "sync_content_to_discord") {
      return await syncContentToDiscord(
        body.channel_id,
        body.content,
        body.username,
        body.reply_to_discord_message_id,
      );
    } else if (action === "sync_to_discord") {
      return await syncMessageToDiscord(message_id, channel_id, webhook_url);
    } else if (action === "sync_from_discord") {
      return await syncMessagesFromDiscord(server_id, channel_id);
    } else if (action === "edit" || action === "delete") {
      return await syncEditedOrDeletedMessage(
        action,
        message_id,
        body.content,
        body.discord_message_id,
        body.discord_channel_id,
        body.webhook_id,
        body.webhook_token,
      );
    } else if (action === "manage_role") {
      return await manageDiscordRole(body);
    } else if (action === "receive_from_discord") {
      return await receiveDiscordMessage(req);
    }

    async function syncEditedOrDeletedMessage(
      action: string,
      messageId: string,
      content?: string,
      discordMessageId?: string,
      discordChannelId?: string,
      webhookId?: string,
      webhookToken?: string,
    ) {
      const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
      if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured");
      let mapping = discordMessageId && discordChannelId
        ? { discord_message_id: discordMessageId, discord_channel_id: discordChannelId }
        : null;
      if (!mapping) {
        const { data, error } = await supabaseClient
          .from("discord_message_mapping")
          .select("discord_message_id, discord_channel_id")
          .eq("chat_message_id", messageId)
          .maybeSingle();
        if (error) throw error;
        mapping = data;
      }
      if (!mapping) throw new Error(`No Discord mapping found for LLA message ${messageId}`);
      let mutationUrl = `${DISCORD_API}/channels/${mapping.discord_channel_id}/messages/${mapping.discord_message_id}`;
      if (webhookId && webhookToken) {
        mutationUrl = `${DISCORD_API}/webhooks/${webhookId}/${webhookToken}/messages/${mapping.discord_message_id}`;
      }
      const response = await fetch(mutationUrl, {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
        ...(action === "edit" ? { body: JSON.stringify({ content: content || "" }) } : {}),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Discord ${action} failed: ${await response.text()}`);
      }
      if (action === "delete") {
        await supabaseClient.from("discord_message_mapping").delete().eq("chat_message_id", messageId);
      }
      return jsonResponse({ success: true, missing: response.status === 404, discord_message_id: mapping.discord_message_id });
    }

    async function manageDiscordRole(body: Record<string, any>) {
      const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
      if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured");
      const { data: server } = await supabaseClient
        .from("discord_servers")
        .select("id, discord_guild_id")
        .eq("server_id", body.server_id)
        .single();
      if (!server) throw new Error("Discord server mapping not found");
      const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };
      let discordRoleId = body.discord_role_id;
      if (body.operation === "delete" || body.operation === "update") {
        if (!discordRoleId && body.role_id) {
          const { data: mapping } = await supabaseClient
            .from("discord_roles").select("discord_role_id").eq("role_id", body.role_id).maybeSingle();
          discordRoleId = mapping?.discord_role_id;
        }
        if (!discordRoleId) throw new Error("Discord role mapping not found");
      }
      const url = `${DISCORD_API}/guilds/${server.discord_guild_id}/roles${discordRoleId ? `/${discordRoleId}` : ""}`;
      const payload = {
        name: body.name,
        color: parseInt(String(body.color || "#5865f2").replace("#", ""), 16),
        hoist: false,
        mentionable: true,
      };
      const response = await fetch(url, {
        method: body.operation === "create" ? "POST" : body.operation === "delete" ? "DELETE" : "PATCH",
        headers,
        ...(body.operation === "delete" ? {} : { body: JSON.stringify(payload) }),
      });
      if (!response.ok) throw new Error(`Discord role operation failed: ${await response.text()}`);
      const role = body.operation === "delete" ? null : await response.json();
      if (body.operation === "create" && role) {
        await supabaseClient.from("discord_roles").insert({
          discord_server_id: server.id,
          role_id: body.role_id,
          discord_role_id: role.id,
          discord_role_name: role.name,
          discord_color: `#${Number(role.color || 0).toString(16).padStart(6, "0")}`,
          discord_permissions: role.permissions,
        });
      } else if (body.operation === "update") {
        await supabaseClient.from("discord_roles").update({
          discord_role_name: role.name,
          discord_color: `#${Number(role.color || 0).toString(16).padStart(6, "0")}`,
        }).eq("role_id", body.role_id);
      } else if (body.operation === "delete") {
        await supabaseClient.from("discord_roles").delete().eq("role_id", body.role_id);
      }
      return jsonResponse({ success: true, discord_role_id: role?.id || discordRoleId });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function syncContentToDiscord(
  channelId: string,
  content: string,
  username: string,
  replyToDiscordMessageId?: string,
) {
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!botToken || !content?.trim()) throw new Error("Discord sync is not configured");
  const { data: discordChannel, error } = await supabaseClient
    .from("discord_channels")
    .select("discord_channel_id, discord_channel_name, discord_server_id, discord_servers(sync_direction, server_id, discord_guild_id)")
    .eq("channel_id", channelId)
    .single();
  if (error) throw error;
  if (discordChannel.discord_servers?.sync_direction === "incoming_only") {
    throw new Error("This Discord server is configured for incoming-only sync");
  }
  const { data: members } = await supabaseClient
    .from("discord_members")
    .select("discord_user_id, discord_username, member_id, server_members(username, profile_display_name)")
    .eq("discord_server_id", discordChannel.discord_server_id);
  const { data: account } = await supabaseClient
    .from("discord_accounts")
    .select("discord_user_id")
    .eq("username", username)
    .maybeSingle();
  const { data: discordMember } = account?.discord_user_id
    ? await supabaseClient
      .from("discord_members")
      .select("member_id")
      .eq("discord_server_id", discordChannel.discord_server_id)
      .eq("discord_user_id", account.discord_user_id)
      .maybeSingle()
    : { data: null };
  let { data: senderMember } = discordMember?.member_id
    ? await supabaseClient
      .from("server_members")
      .select("profile_display_name, profile_avatar_url")
      .eq("id", discordMember.member_id)
      .maybeSingle()
    : { data: null };
  if (!senderMember) {
    const fallback = await supabaseClient
      .from("server_members")
      .select("profile_display_name, profile_avatar_url")
      .eq("server_id", discordChannel.discord_servers?.server_id)
      .eq("username", username)
      .maybeSingle();
    senderMember = fallback.data;
  }
  const mentions: string[] = [];
  let discordContent = content;
  for (const member of members || []) {
    const names = [member.discord_username, member.server_members?.profile_display_name, member.server_members?.username]
      .filter(Boolean).map((name) => String(name).replace(/^discord-/, ""));
    for (const name of names) {
      const pattern = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      if (pattern.test(discordContent)) {
        discordContent = discordContent.replace(pattern, `<@${member.discord_user_id}>`);
        mentions.push(member.discord_user_id);
        break;
      }
    }
  }
  let discordChannelId = discordChannel.discord_channel_id;
  let webhook;
  try {
    webhook = await getOrCreateSyncWebhook(discordChannelId, botToken);
  } catch (webhookError) {
    if (!String(webhookError.message).includes("Unknown Channel")) throw webhookError;
    const guildId = discordChannel.discord_servers?.discord_guild_id;
    const guildChannelsResponse = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!guildChannelsResponse.ok) throw new Error(`Unable to refresh Discord channels: ${await guildChannelsResponse.text()}`);
    const guildChannels = await guildChannelsResponse.json();
    const replacement = guildChannels.find((candidate: Record<string, unknown>) =>
      candidate.name === discordChannel.discord_channel_name && [0, 5].includes(candidate.type as number)
    );
    if (!replacement) throw webhookError;
    discordChannelId = replacement.id;
    await supabaseClient.from("discord_channels")
      .update({ discord_channel_id: discordChannelId })
      .eq("channel_id", channelId);
    webhook = await getOrCreateSyncWebhook(discordChannelId, botToken);
  }
  const response = await fetch(webhook.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: discordContent,
      username: senderMember?.profile_display_name || username || "Unknown",
      avatar_url: senderMember?.profile_avatar_url || undefined,
      allowed_mentions: { users: [...new Set(mentions)] },
      ...(replyToDiscordMessageId ? {
        message_reference: {
          message_id: replyToDiscordMessageId,
          fail_if_not_exists: false,
        },
      } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Discord API error: ${await response.text()}`);
  const discordMessage = await response.json();
  return jsonResponse({
    success: true,
    discord_message_id: discordMessage.id,
    discord_channel_id: discordChannelId,
    webhook_id: webhook.id,
    webhook_token: webhook.token,
  });
}

async function getOrCreateSyncWebhook(channelId: string, botToken: string) {
  const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };
  const listResponse = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, { headers });
  if (!listResponse.ok) throw new Error(`Unable to inspect Discord webhooks: ${await listResponse.text()}`);
  const webhooks = await listResponse.json();
  let webhook = webhooks.find((item: Record<string, unknown>) => item.name === "LLA Chat Sync");
  if (!webhook) {
    const createResponse = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
      method: "POST", headers, body: JSON.stringify({ name: "LLA Chat Sync" }),
    });
    if (!createResponse.ok) throw new Error(`Unable to create Discord webhook: ${await createResponse.text()}`);
    webhook = await createResponse.json();
  }
  if (!webhook.token) throw new Error("Discord sync webhook has no token");
  return {
    url: `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}?wait=true`,
    id: webhook.id,
    token: webhook.token,
  };
}

async function syncMessageToDiscord(messageId: string, channelId: string, webhookUrl?: string) {
  try {
    // Fetch message from DB
    const { data: message, error: messageError } = await supabaseClient
      .from("messages")
      .select("*, users(*)")
      .eq("id", messageId)
      .single();

    if (messageError) throw messageError;

    // Fetch Discord channel mapping
    const { data: discordChannel, error: channelError } = await supabaseClient
      .from("discord_channels")
      .select("discord_channel_id, discord_server_id, discord_servers(sync_direction, discord_guild_id, discord_guild_name, server_id)")
      .eq("channel_id", channelId)
      .single();

    if (channelError) throw new Error("Channel is not synced to Discord");
    if (discordChannel.discord_servers?.sync_direction === "incoming_only") {
      throw new Error("This Discord server is configured for incoming-only sync");
    }

    const { data: discordAccount } = await supabaseClient
      .from("discord_accounts")
      .select("discord_username, discord_user_id, access_token")
      .eq("username", message.username)
      .maybeSingle();
    const { data: serverMember } = await supabaseClient
      .from("server_members")
      .select("profile_display_name, profile_avatar_url")
      .eq("server_id", discordChannel.discord_servers.server_id)
      .eq("username", message.username)
      .maybeSingle();
    let discordAvatarUrl: string | undefined;
    if (discordAccount?.access_token) {
      const profileResponse = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${discordAccount.access_token}` },
      });
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        if (profile.avatar) {
          discordAvatarUrl = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;
        }
      }
    }
    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    let sendUrl = webhookUrl;
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    let payload: Record<string, unknown> = { content: message.content };
    let replyReference: Record<string, unknown> | undefined;
    if (message.reply_to) {
      const { data: replyMapping } = await supabaseClient
        .from("discord_message_mapping")
        .select("discord_message_id")
        .eq("chat_message_id", message.reply_to)
        .maybeSingle();
      if (replyMapping?.discord_message_id) {
        replyReference = {
          message_id: replyMapping.discord_message_id,
          fail_if_not_exists: false,
        };
      }
    }
    if (!webhookUrl && botToken) {
      const webhook = await getOrCreateSyncWebhook(discordChannel.discord_channel_id, botToken);
      sendUrl = webhook.url;
      payload = {
        content: message.content,
        username: serverMember?.profile_display_name || discordAccount?.discord_username || message.users?.username || "Unknown",
        avatar_url: serverMember?.profile_avatar_url || discordAvatarUrl,
        allowed_mentions: { parse: [] },
        ...(replyReference ? { message_reference: replyReference } : {}),
      };
    }
    if (!sendUrl) throw new Error("No Discord webhook or bot token is configured");

    const discordResponse = await fetch(sendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!discordResponse.ok) {
      const errorBody = await discordResponse.text();
      throw new Error(
        `Discord API error for guild ${discordChannel.discord_servers?.discord_guild_id || "unknown"}, ` +
        `channel ${discordChannel.discord_channel_id}: ${errorBody}`,
      );
    }

    const discordMessage = await discordResponse.json();

    // Store mapping
    await supabaseClient
      .from("discord_message_mapping")
      .insert({
        chat_message_id: parseInt(messageId),
        discord_message_id: discordMessage.id,
        discord_server_id: discordChannel.discord_server_id,
        discord_channel_id: discordChannel.discord_channel_id,
      });

    return new Response(JSON.stringify({ success: true, discord_message_id: discordMessage.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    throw error;
  }

  async function getOrCreateSyncWebhook(channelId: string, botToken: string) {
    const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };
    const listResponse = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, { headers });
    if (!listResponse.ok) throw new Error(`Unable to inspect Discord webhooks: ${await listResponse.text()}`);
    const webhooks = await listResponse.json();
    let webhook = webhooks.find((item: Record<string, unknown>) => item.name === "LLA Chat Sync");
    if (!webhook) {
      const createResponse = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "LLA Chat Sync" }),
      });
      if (!createResponse.ok) throw new Error(`Unable to create Discord webhook: ${await createResponse.text()}`);
      webhook = await createResponse.json();
    }
    if (!webhook.token) throw new Error("Discord sync webhook has no token");
    return { url: `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}?wait=true` };
  }

}

async function syncMessagesFromDiscord(serverId: string, requestedChannelId?: string) {
    if (!serverId) throw new Error("server_id is required");
    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured");

    const { data: discordServer, error: serverError } = await supabaseClient
      .from("discord_servers")
      .select("id, sync_direction")
      .eq("server_id", serverId)
      .single();
    if (serverError) throw serverError;
    if (discordServer.sync_direction === "outgoing_only") {
      return jsonResponse({ success: true, imported: 0 });
    }

    let channelsQuery = supabaseClient
      .from("discord_channels")
      .select("channel_id, discord_channel_id")
      .eq("discord_server_id", discordServer.id)
      .eq("channel_type", "text");
    if (requestedChannelId) channelsQuery = channelsQuery.eq("channel_id", requestedChannelId);
    const { data: channels, error: channelsError } = await channelsQuery;
    if (channelsError) throw channelsError;

    let imported = 0;
    const llaWebhookIds = new Set<string>();
    let llaBotUserId: string | null = null;
    const botIdentityResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (botIdentityResponse.ok) {
      const botIdentity = await botIdentityResponse.json();
      llaBotUserId = botIdentity.id || null;
    }
    for (const channel of channels || []) {
      const channelMessages: Record<string, any>[] = [];
      let before: string | null = null;
      const maxPages = requestedChannelId ? 1 : 10;
      for (let page = 0; page < maxPages; page += 1) {
        const query = new URLSearchParams({ limit: "100" });
        if (before) query.set("before", before);
        const response = await fetch(
          `${DISCORD_API}/channels/${channel.discord_channel_id}/messages?${query.toString()}`,
          { headers: { Authorization: `Bot ${botToken}` } },
        );
        if (!response.ok) {
          console.warn("[DISCORD-SYNC] Cannot read channel", channel.discord_channel_id, response.status);
          break;
        }
        const pageMessages = await response.json();
        if (!Array.isArray(pageMessages) || pageMessages.length === 0) break;
        channelMessages.push(...pageMessages);
        if (pageMessages.length < 100) break;
        before = pageMessages[pageMessages.length - 1]?.id || null;
        if (!before) break;
      }
      for (const discordMessage of [...channelMessages].reverse()) {
        const discordUser = discordMessage.author;
        if (llaBotUserId && discordUser?.id === llaBotUserId) continue;
        await ensureDiscordMember(discordServer.id, serverId, discordUser);
        if (discordMessage.webhook_id && llaWebhookIds.has(discordMessage.webhook_id)) continue;
        if (discordMessage.webhook_id) {
          const webhookResponse = await fetch(
            `${DISCORD_API}/channels/${channel.discord_channel_id}/webhooks`,
            { headers: { Authorization: `Bot ${botToken}` } },
          );
          if (webhookResponse.ok) {
            const webhooks = await webhookResponse.json();
            webhooks
              .filter((webhook: Record<string, string>) => webhook.name === "LLA Chat Sync")
              .forEach((webhook: Record<string, string>) => llaWebhookIds.add(webhook.id));
          }
          if (llaWebhookIds.has(discordMessage.webhook_id)) continue;
        }
        const { data: existing } = await supabaseClient
          .from("discord_message_mapping")
          .select("id")
          .eq("discord_server_id", discordServer.id)
          .eq("discord_message_id", discordMessage.id)
          .maybeSingle();
        if (existing) continue;
        const embeds = (discordMessage.embeds || []).filter((embed: Record<string, any>) =>
          embed.title || embed.description || embed.fields?.length || embed.url || embed.image?.url || embed.thumbnail?.url
        );
        const messageContent = [
          discordMessage.content,
          embeds.length ? `\n[LLA_EMBEDS]${JSON.stringify(embeds)}` : "",
        ].filter(Boolean).join("\n\n").trim();
        if (!messageContent) continue;

        const username = `discord-${discordUser.id}`;
        const { data: sameMessage } = await supabaseClient
          .from("messages")
          .select("id")
          .eq("channel_id", channel.channel_id)
          .eq("username", username)
          .eq("inserted_at", discordMessage.timestamp)
          .eq("content", messageContent)
          .maybeSingle();
        if (sameMessage) {
          await supabaseClient.from("discord_message_mapping").upsert({
            discord_server_id: discordServer.id,
            discord_channel_id: channel.discord_channel_id,
            chat_message_id: sameMessage.id,
            discord_message_id: discordMessage.id,
          }, { onConflict: "chat_message_id,discord_message_id" });
          continue;
        }
        const avatarUrl = discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : null;
        const displayName = discordUser.global_name || discordUser.username || username;
        await supabaseClient.from("users").upsert({
          username,
          display_name: displayName,
          avatar_url: avatarUrl,
        }, { onConflict: "username" });
        const { data: member } = await supabaseClient
          .from("discord_members")
          .select("member_id, discord_roles")
          .eq("discord_server_id", discordServer.id)
          .eq("discord_user_id", discordUser.id)
          .maybeSingle();
        if (!member) {
          const { data: existingMember } = await supabaseClient
            .from("server_members")
            .select("id")
            .eq("server_id", serverId)
            .eq("username", username)
            .maybeSingle();
          const { data: newMember } = existingMember
            ? await supabaseClient.from("server_members").update({
              profile_display_name: displayName,
              profile_avatar_url: avatarUrl,
              role: discordUser.bot ? "Bot" : "member",
            }).eq("id", existingMember.id).select("id").maybeSingle()
            : await supabaseClient
            .from("server_members")
            .insert({
              server_id: serverId,
              username,
              role: discordUser.bot ? "Bot" : "member",
              profile_display_name: displayName,
              profile_avatar_url: avatarUrl,
            })
            .select("id")
            .maybeSingle();
          if (newMember) {
            await supabaseClient.from("discord_members").upsert({
              discord_server_id: discordServer.id,
              member_id: newMember.id,
              discord_user_id: discordUser.id,
              discord_username: discordUser.username,
              discord_roles: [],
            }, { onConflict: "member_id,discord_user_id" });
          }
        }

        async function ensureDiscordMember(discordServerId: string, nativeServerId: string, discordUser: Record<string, any>) {
          if (!discordUser?.id) return;
          const username = `discord-${discordUser.id}`;
          const displayName = discordUser.global_name || discordUser.username || username;
          const avatarUrl = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null;
          await supabaseClient.from("users").upsert({
            username,
            display_name: displayName,
            avatar_url: avatarUrl,
          }, { onConflict: "username" });
          const { data: existingMember } = await supabaseClient
            .from("server_members")
            .select("id")
            .eq("server_id", nativeServerId)
            .eq("username", username)
            .maybeSingle();
          const memberResult = existingMember
            ? await supabaseClient.from("server_members").update({
              profile_display_name: displayName,
              profile_avatar_url: avatarUrl,
              role: discordUser.bot ? "Bot" : "member",
            }).eq("id", existingMember.id).select("id").maybeSingle()
            : await supabaseClient.from("server_members").insert({
              server_id: nativeServerId,
              username,
              role: discordUser.bot ? "Bot" : "member",
              profile_display_name: displayName,
              profile_avatar_url: avatarUrl,
            }).select("id").maybeSingle();
          if (memberResult.data) {
            await supabaseClient.from("discord_members").upsert({
              discord_server_id: discordServerId,
              member_id: memberResult.data.id,
              discord_user_id: discordUser.id,
              discord_username: discordUser.username || username,
              discord_roles: discordUser.roles || [],
            }, { onConflict: "member_id,discord_user_id" });
          }
        }
        let replyTo: number | null = null;
        const referencedDiscordId = discordMessage.referenced_message?.id || discordMessage.message_reference?.message_id;
        if (referencedDiscordId) {
          const { data: referencedMapping } = await supabaseClient
            .from("discord_message_mapping")
            .select("chat_message_id")
            .eq("discord_server_id", discordServer.id)
            .eq("discord_message_id", referencedDiscordId)
            .maybeSingle();
          replyTo = referencedMapping?.chat_message_id || null;
        }

        const { data: nativeMessage, error: messageError } = await supabaseClient
          .from("messages")
          .insert({
            username,
            content: messageContent,
            channel_id: channel.channel_id,
            inserted_at: discordMessage.timestamp || new Date().toISOString(),
            reply_to: replyTo,
          })
          .select("id")
          .single();
        if (messageError) {
          console.error("[DISCORD-SYNC] Message insert failed:", messageError);
          continue;
        }
        await supabaseClient.from("discord_message_mapping").insert({
          discord_server_id: discordServer.id,
          discord_channel_id: channel.discord_channel_id,
          chat_message_id: nativeMessage.id,
          discord_message_id: discordMessage.id,
        });
        imported += 1;
      }
    }
    return jsonResponse({ success: true, imported });
  }

  function jsonResponse(payload: Record<string, unknown>) {
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
async function receiveDiscordMessage(req: Request) {
  try {
    const payload = await req.json();

    // Verify Discord webhook signature (optional but recommended)
    // For now, we'll skip this for simplicity

    if (payload.type === 1) {
      // PING event
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (payload.type === 0) {
      // MESSAGE_CREATE event
      const { guild_id, channel_id, author, content, id } = payload.data;

      // Find corresponding Discord server and channel
      const { data: discordServer, error: serverError } = await supabaseClient
        .from("discord_servers")
        .select("id, server_id")
        .eq("discord_guild_id", guild_id)
        .single();

      if (serverError) return new Response("Server not synced", { status: 404 });

      const { data: discordChannel, error: channelError } = await supabaseClient
        .from("discord_channels")
        .select("channel_id")
        .eq("discord_channel_id", channel_id)
        .eq("discord_server_id", discordServer.id)
        .single();

      if (channelError) return new Response("Channel not synced", { status: 404 });

      // Create or get user
      const { data: user, error: userError } = await supabaseClient
        .from("users")
        .select("username")
        .eq("username", `discord-${author.username}`)
        .single();

      let username = user?.username;
      if (!user) {
        // Create placeholder user
        const { data: newUser, error: createError } = await supabaseClient
          .from("users")
          .insert({ username: `discord-${author.username}` })
          .select()
          .single();

        if (!createError) username = newUser.username;
      }

      // Insert message
      const { error: insertError } = await supabaseClient
        .from("messages")
        .insert({
          username: username || "discord-unknown",
          content,
          channel_id: discordChannel.channel_id,
        });

      if (!insertError) {
        // Store mapping
        const { data: lastMessage } = await supabaseClient
          .from("messages")
          .select("id")
          .eq("username", username)
          .eq("content", content)
          .order("inserted_at", { ascending: false })
          .limit(1)
          .single();

        if (lastMessage) {
          await supabaseClient
            .from("discord_message_mapping")
            .insert({
              chat_message_id: lastMessage.id,
              discord_message_id: id,
              discord_server_id: discordServer.id,
              discord_channel_id: channel_id,
            });
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
