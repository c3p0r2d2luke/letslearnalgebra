import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const { title, body, subscription, important, url } = await req.json();

  if (!subscription || !title) {
    return new Response(JSON.stringify({ error: "Missing subscription or title" }), { status: 400 });
  }

  const payload = {
    title,
    body,
    tag: `mention-${Date.now()}`,
    icon: "/logo.png",
    badge: "/logo.png",
    data: { url },
    vibrate: important ? [200, 100, 200, 100, 200, 100, 400] : [120, 60, 120],
    silent: false,
  };

  try {
    const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${Deno.env.get("FCM_SERVER_KEY")}`, // Set this in Supabase Secrets
      },
      body: JSON.stringify({
        to: subscription.endpoint,
        data: payload,
        // Note: FCM v1 is preferred, but legacy v0 is often easier for simple setups.
        // If using VAPID directly without FCM, use the web-push library instead.
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("FCM Error:", errorText);
      return new Response(JSON.stringify({ error: "Failed to send push", details: errorText }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Push Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});