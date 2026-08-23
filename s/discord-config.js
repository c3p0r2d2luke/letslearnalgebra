// ======================== DISCORD CONFIGURATION ========================

// Discord API Configuration
// TODO: Set these values with your Discord app credentials
const DISCORD_CONFIG = {
  CLIENT_ID: "1490802687111991420", // Update this in Discord Developer Portal
  REDIRECT_URI: `${window.location.origin}${window.location.pathname}`,
  SCOPES: ["identify", "guilds", "channels.read", "messages.read"],
  AUTH_URL: "https://discord.com/api/oauth2/authorize",
};

// Validate configuration
function validateDiscordConfig() {
  if (DISCORD_CONFIG.CLIENT_ID === "1490802687111991420") {
    console.warn("⚠️ Discord Client ID not configured. Discord integration will not work.");
    console.warn("📝 Please update DISCORD_CONFIG.CLIENT_ID in s/discord-config.js with your Discord app ID.");
    return false;
  }
  return true;
}

// Export for use in other files
if (typeof window !== "undefined") {
  window.DISCORD_CONFIG = DISCORD_CONFIG;
  window.validateDiscordConfig = validateDiscordConfig;
}
