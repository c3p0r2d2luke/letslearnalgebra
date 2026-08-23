# Discord Integration Setup Guide

This guide will help you set up Discord integration for the LetsLearnAlgebra chat application.

## Features Implemented

✅ **Phase 1: Discord OAuth & Account Linking**
- Connect Discord accounts to chat profiles
- OAuth2 authentication flow
- Secure token storage and refresh

✅ **Phase 2: Discord Server Import**
- Import Discord servers with full metadata
- Sync roles, channels, members, and server icons
- Bidirectional sync support (incoming_only, outgoing_only, bidirectional)

✅ **Phase 3: Message Sync**
- Sync messages between chat and Discord
- Webhook-based message delivery
- Automatic message mapping

✅ **Phase 4: Discord Bots & Slash Commands**
- Register slash commands in chat servers
- Discord-like command autocomplete
- Built-in commands (help, ping, echo)
- Custom command support

✅ **Phase 5: UI Enhancements**
- Discord badges on synced channels
- Profile Discord connection UI
- Import server dialog with Discord guilds list

---

## Prerequisites

1. **Discord Developer Account**
   - Go to https://discord.com/developers/applications
   - Create a new application

2. **Bot Setup**
   - Go to "Bot" section of your application
   - Click "Add Bot"
   - Copy the bot token (keep this secret!)
   - Under "OAuth2" → "URL Generator", select:
     - Scopes: `identify`, `guilds`, `channels.read`, `messages.read`
     - Permissions: `Send Messages`, `Read Message History`, `Manage Webhooks`

3. **OAuth2 Configuration**
   - Go to "OAuth2" → "General"
   - Add Redirect URIs:
     - Development: `http://localhost:3000` (or your local URL)
     - Production: `https://yourdomain.com`

---

## Configuration

### 1. Update Discord Config

Edit `s/discord-config.js`:

```javascript
const DISCORD_CONFIG = {
  CLIENT_ID: "1490802687111991420", // Get from OAuth2 → General
  REDIRECT_URI: `${window.location.origin}${window.location.pathname}`,
  SCOPES: ["identify", "guilds", "channels.read", "messages.read"],
  AUTH_URL: "https://discord.com/api/oauth2/authorize",
};
```

### 2. Set Environment Variables (Supabase)

In your Supabase project, set these environment variables:

```
DISCORD_CLIENT_ID = "your_client_id"
DISCORD_CLIENT_SECRET = "your_client_secret"
DISCORD_REDIRECT_URI = "https://yourdomain.com"
DISCORD_BOT_TOKEN = "your_bot_token"
```

### 3. Database Setup

Run the Discord migration SQL to create necessary tables:

```bash
# The migration file is available at:
# /tmp/discord_migrations.sql
```

---

## Usage

### For Users

1. **Connect Discord Account**
   - Click on your profile avatar
   - In the profile modal, click "🔗 Connect Discord Account"
   - Authorize the application on Discord
   - Your Discord username will appear in the profile

2. **Import Discord Server**
   - Click "Add a Server" in the sidebar
   - Click "📥 Import Discord Server"
   - Select a Discord server you own or manage
   - Choose sync direction (bidirectional, incoming-only, or outgoing-only)
   - Click "✅ Import Selected Server"

3. **Use Slash Commands**
   - Type `/` in message input to see available commands
   - Autocomplete will show matching commands
   - Press Tab to cycle through commands
   - Available built-in commands:
     - `/help` - List all available commands
     - `/ping` - Test bot connectivity
     - `/echo <message>` - Echo back a message

4. **Message Sync**
   - Messages sent in synced channels automatically appear in Discord
   - Discord messages automatically sync back to the chat
   - Synced channels show a 💬 badge next to their name

### For Developers

#### Adding Bots to Servers

```javascript
// Register a bot (e.g., Dyno)
const response = await fetch(`${supabaseUrl}/functions/v1/server-bots`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "install_bot",
    server_id: currentServerId,
    bot_name: "Dyno",
    bot_type: "dyno",
    installed_by: username,
  }),
});
```

#### Creating Custom Commands

```javascript
// Register a custom slash command
await registerSlashCommand(
  serverId,
  botId,
  "remind",
  "Set a reminder for later",
  [
    { name: "time", description: "How long from now (e.g., 1h, 30m)", required: true },
    { name: "message", description: "Reminder message", required: true },
  ],
  username
);
```

#### Listening to Discord Messages

The `discord-message-sync` edge function handles incoming Discord messages via webhooks. To set up the webhook:

1. Create a webhook in your Discord server channel
2. Point it to: `https://your-supabase-url/functions/v1/discord-message-sync`
3. Messages will automatically sync to the chat

---

## Edge Functions Overview

### `discord-oauth`
- Handles Discord OAuth2 code exchange
- Manages token refresh
- Fetches user's Discord guilds

### `discord-import`
- Imports Discord servers with full metadata
- Creates native server, channels, roles, members
- Handles sync direction configuration

### `discord-message-sync`
- Syncs messages from chat to Discord
- Listens for incoming Discord messages
- Maintains message mapping for tracking

### `slash-commands`
- Registers and retrieves slash commands
- Executes built-in and custom commands
- Manages command metadata and options

---

## Troubleshooting

### Discord OAuth Shows "Invalid Redirect URI"
- Check that your REDIRECT_URI matches exactly in Discord app settings
- Ensure protocol (http/https) matches

### Messages Not Syncing to Discord
- Verify the channel has `discord_channels` record
- Check Discord bot has permissions in the target channel
- Ensure webhook URL is correct

### Slash Commands Not Showing
- Make sure you're viewing a synced server
- Check browser console for errors
- Verify commands are registered in `slash_commands` table

### Import Fails with "Failed to fetch Discord guild"
- Check that Discord account is connected
- Verify access token is still valid
- Ensure user has manage_guild permission on the Discord server

---

## Security Considerations

1. **Token Storage**
   - Access tokens and refresh tokens are encrypted in Supabase
   - Never expose tokens to the frontend
   - Always use HTTPS in production

2. **Rate Limiting**
   - Discord API has rate limits (50 requests/second)
   - Implement exponential backoff for retries
   - Cache frequently accessed data

3. **Permissions**
   - Validate server ownership before allowing imports
   - Check user has appropriate Discord roles
   - Enforce role-based access in channels

4. **Webhooks**
   - Verify webhook signatures (Discord provides signature verification)
   - Only accept HTTPS webhooks in production
   - Implement IP whitelist if possible

---

## Future Enhancements

- [ ] Discord embed support (rich messages)
- [ ] Voice channel integration
- [ ] Custom emoji sync
- [ ] Bot marketplace UI
- [ ] Message edit/delete sync
- [ ] Reaction sync
- [ ] Thread support
- [ ] Forum channel support
- [ ] Permission inheritance from Discord roles

---

## Support

For issues or questions:
1. Check the console for error messages
2. Verify all environment variables are set
3. Check Discord Developer Portal for API errors
4. Consult Discord.js documentation: https://discord.js.org/
5. Check Supabase documentation: https://supabase.com/docs

---

## API Reference

### Discord OAuth Token Response
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_expires_at": "2024-01-01T00:00:00Z",
  "discord_user": {
    "id": "...",
    "username": "...",
    "discriminator": "..."
  }
}
```

### Discord Server Import Response
```json
{
  "success": true,
  "server_id": "uuid",
  "discord_server_id": "uuid"
}
```

### Slash Command Response
```json
{
  "success": true,
  "result": "Command output here"
}
```

---

**Last Updated:** 2026-08-21
**Version:** 1.0.0
