interface ChatConfig {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SPOTIFY_CLIENT_ID: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_REDIRECT_URI: string;
  VAPID_PUBLIC_KEY: string;
}

interface Window {
  CHAT_CONFIG: ChatConfig;
}
