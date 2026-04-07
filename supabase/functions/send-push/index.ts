/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_EMAIL = Deno.env.get("VAPID_EMAIL") || "mailto:frenchwizz@proton.me";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

webpush.setVapidDetails(
  VAPID_EMAIL,
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const { title, body, subscription, important = false, mention = false, url = "/chatwithteachers" } = await req.json();

    let subscriptions = Array.isArray(subscription) ? subscription.filter(Boolean) : subscription ? [subscription] : [];

    if (subscriptions.length === 0) {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("subscription");
      if (error) {
        throw error;
      }
      subscriptions = (data || []).map(row => row.subscription).filter(Boolean);
    }

    if (subscriptions.length === 0) {
      return new Response(JSON.stringify({ ok: true, delivered: 0 }), {
        headers: corsHeaders
      });
    }

    const payload = JSON.stringify({
      title,
      body,
      important,
      mention,
      url
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) => webpush.sendNotification(sub, payload))
    );

    const delivered = results.filter(result => result.status === "fulfilled").length;

    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: corsHeaders
    });
  } catch (error) {
    console.error("send-push error", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
