// ======================== DISCORD CONFIGURATION ========================

// Discord API Configuration
// TODO: Set these values with your Discord app credentials
const DISCORD_CONFIG = {
  CLIENT_ID: "1490802687111991420", // Update this in Discord Developer Portal
  REDIRECT_URI: `${window.location.origin}${window.location.pathname}`,
  SCOPES: ["identify", "guilds"],
  API_URL: "https://discord.com/api/v10",
  AUTH_URL: "https://discord.com/api/oauth2/authorize",
};

// Export for use in other files
if (typeof window !== "undefined") {
  window.DISCORD_CONFIG = DISCORD_CONFIG;
}
