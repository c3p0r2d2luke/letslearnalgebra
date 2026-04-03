/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_EMAIL = "mailto:frenchwizz@proton.me";

webpush.setVapidDetails(
  VAPID_EMAIL,
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { title, body, subscription, mention, important, serverId, channelId, serverName, channelName, serverSlug } = await req.json();

  const payload = JSON.stringify({
    title,
    body,
    mention,
    important,
    serverId,
    channelId,
    serverName,
    channelName,
    serverSlug
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Push failed:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});