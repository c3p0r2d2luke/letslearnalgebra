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
    const { action, message_id, channel_id, server_id, webhook_url } = await req.json();

    if (action === "sync_to_discord") {
      return await syncMessageToDiscord(message_id, channel_id, webhook_url);
    } else if (action === "sync_from_discord") {
      return await syncMessagesFromDiscord(server_id);
    } else if (action === "receive_from_discord") {
      return await receiveDiscordMessage(req);
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
      .select("discord_channel_id, discord_server_id, discord_servers(sync_direction, discord_guild_id, discord_guild_name)")
      .eq("channel_id", channelId)
      .single();

    if (channelError) throw new Error("Channel is not synced to Discord");
    if (discordChannel.discord_servers?.sync_direction === "incoming_only") {
      throw new Error("This Discord server is configured for incoming-only sync");
    }

    // Send to Discord via webhook or bot token
    let sendUrl = webhookUrl;
    let headers: any = { "Content-Type": "application/json" };

    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    if (!webhookUrl && botToken) {
      sendUrl = `${DISCORD_API}/channels/${discordChannel.discord_channel_id}/messages`;
      headers["Authorization"] = `Bot ${botToken}`;
    }
    if (!sendUrl) throw new Error("No Discord webhook or bot token is configured");

    const payload = {
      content: message.content,
      username: message.users?.username || "Unknown",
      avatar_url: message.users?.avatar_url || null,
    };

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

}

async function syncMessagesFromDiscord(serverId: string) {
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

    const { data: channels, error: channelsError } = await supabaseClient
      .from("discord_channels")
      .select("channel_id, discord_channel_id")
      .eq("discord_server_id", discordServer.id)
      .eq("channel_type", "text");
    if (channelsError) throw channelsError;

    let imported = 0;
    for (const channel of channels || []) {
      const response = await fetch(
        `${DISCORD_API}/channels/${channel.discord_channel_id}/messages?limit=100`,
        { headers: { Authorization: `Bot ${botToken}` } },
      );
      if (!response.ok) {
        console.warn("[DISCORD-SYNC] Cannot read channel", channel.discord_channel_id, response.status);
        continue;
      }
      const messages = await response.json();
      for (const discordMessage of [...messages].reverse()) {
        const { data: existing } = await supabaseClient
          .from("discord_message_mapping")
          .select("id")
          .eq("discord_server_id", discordServer.id)
          .eq("discord_message_id", discordMessage.id)
          .maybeSingle();
        if (existing || !discordMessage.content?.trim()) continue;

        const discordUser = discordMessage.author;
        const username = `discord-${discordUser.id}`;
        const avatarUrl = discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : null;
        await supabaseClient.from("users").upsert({
          username,
          display_name: discordUser.global_name || discordUser.username || username,
          avatar_url: avatarUrl,
        }, { onConflict: "username" });

        const { data: nativeMessage, error: messageError } = await supabaseClient
          .from("messages")
          .insert({
            username,
            content: discordMessage.content,
            channel_id: channel.channel_id,
            inserted_at: discordMessage.timestamp || new Date().toISOString(),
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
              message_id: lastMessage.id,
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
