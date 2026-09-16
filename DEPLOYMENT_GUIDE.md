# Discord Integration - Deployment Guide

## Quick Start (5 Steps)

### 1. Create Discord Application
1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name (e.g., "LetsLearnAlgebra")
4. Accept terms and create

### 2. Get Discord Credentials
1. Go to "OAuth2" → "General"
2. Copy **Client ID** (save this)
3. Click "Reset Secret" and copy **Client Secret** (keep private!)
4. Add Redirect URIs:
   - Development: `http://localhost:3000`
   - Production: `https://yourdomain.com`

### 3. Create Bot
1. Go to "Bot" section
2. Click "Add Bot"
3. Under TOKEN, click "Copy"
4. Save the **Bot Token** (keep private!)
5. Enable these Intents:
   - Message Content Intent
   - Server Members Intent

### 4. Configure Application
1. Update `s/discord-config.js`:
   ```javascript
   DISCORD_CONFIG.CLIENT_ID = "YOUR_CLIENT_ID_HERE"
   ```

2. Set Supabase Environment Variables:
   ```
   DISCORD_CLIENT_ID = "your_client_id"
   DISCORD_CLIENT_SECRET = "your_client_secret"
   DISCORD_REDIRECT_URI = "https://yourdomain.com"
   DISCORD_BOT_TOKEN = "your_bot_token"
   ```

### 5. Deploy Database & Functions
```bash
# Apply database migrations
psql $DATABASE_URL < /tmp/discord_migrations.sql

# Deploy edge functions to Supabase
supabase functions deploy discord-oauth
supabase functions deploy discord-import
supabase functions deploy discord-message-sync
supabase functions deploy slash-commands
```

---

## Detailed Setup Instructions

### Step 1: Discord Developer Portal Setup

#### Create Application
1. Navigate to https://discord.com/developers/applications
2. Click "New Application"
3. Enter name: "LetsLearnAlgebra"
4. Accept Developer Terms of Service
5. Click "Create"

#### Configure OAuth2
1. Go to "OAuth2" → "General"
2. **Copy Client ID** (you'll need this for frontend config)
3. Under "CLIENT SECRET":
   - Click "Reset Secret"
   - Click "Copy" (save securely)
4. Under "REDIRECTS":
   - Click "Add Redirect"
   - For development: `http://localhost:3000`
   - For production: `https://yourdomain.com`
   - Click "Save"

#### Create Bot
1. Go to "Bot" in left sidebar
2. Click "Add Bot"
3. Under "TOKEN":
   - Click "Copy" (save securely, never commit!)
4. Under "GATEWAY INTENTS":
   - Enable "Message Content Intent"
   - Enable "Server Members Intent"
5. Under "SERVER PERMISSIONS":
   - Select: Send Messages, Read Message History, Manage Webhooks, Manage Roles

### Step 2: Database Setup

#### Option A: Using Supabase CLI
```bash
# Navigate to project directory
cd /home/takeo/letslearnalgebra

# Connect to Supabase (if not already authenticated)
supabase link --project-ref YOUR_PROJECT_REF

# Apply migrations
supabase db push

# Or manually run migrations in Supabase SQL editor
cat /tmp/discord_migrations.sql | psql $DATABASE_URL
```

#### Option B: Manual SQL Setup
1. Go to Supabase Dashboard
2. Open SQL Editor
3. Create new query
4. Paste contents of `/tmp/discord_migrations.sql`
5. Click "Execute"

### Step 3: Frontend Configuration

#### Update Discord Config
Edit `s/discord-config.js`:

```javascript
const DISCORD_CONFIG = {
  CLIENT_ID: "1234567890123456789", // Your Client ID from Step 1
  REDIRECT_URI: `${window.location.origin}${window.location.pathname}`,
  SCOPES: ["identify", "guilds", "channels.read", "messages.read"],
  AUTH_URL: "https://discord.com/api/oauth2/authorize",
};
```

### Step 4: Supabase Environment Variables

#### In Supabase Dashboard
1. Go to Project Settings → Environment Variables
2. Create new variables:

| Variable Name | Value |
|---|---|
| DISCORD_CLIENT_ID | (from OAuth2 General) |
| DISCORD_CLIENT_SECRET | (from OAuth2 General) |
| DISCORD_REDIRECT_URI | https://yourdomain.com |
| DISCORD_BOT_TOKEN | (from Bot page) |

#### In .env.local (for local development)
```env
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_REDIRECT_URI=http://localhost:3000
DISCORD_BOT_TOKEN=your_bot_token
```

### Step 5: Deploy Edge Functions

#### Using Supabase CLI
```bash
# Deploy all Discord functions
supabase functions deploy discord-oauth
supabase functions deploy discord-import
supabase functions deploy discord-message-sync
supabase functions deploy slash-commands

# View logs
supabase functions list
```

#### Verify Deployment
```bash
# Test a function
curl -X POST https://your-project.supabase.co/functions/v1/discord-oauth \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"action":"get_guilds","refresh_token":"test"}'
```

---

## Testing Checklist

### Phase 1: Discord OAuth
- [ ] User can click "Connect Discord Account" in profile
- [ ] OAuth flow redirects to Discord
- [ ] Discord permission consent screen shows
- [ ] After approval, returns to app
- [ ] Discord username shows in profile
- [ ] Can disconnect Discord account

### Phase 2: Server Import
- [ ] Click "Import Discord Server" in Add Server modal
- [ ] Discord guilds list appears with icons
- [ ] Can select sync direction
- [ ] Import completes successfully
- [ ] New server appears in server list
- [ ] Channels are created
- [ ] Roles are created

### Phase 3: Message Sync
- [ ] Discord badges appear on synced channels
- [ ] Send message in synced channel
- [ ] Message appears in Discord
- [ ] Discord message appears in chat
- [ ] Usernames sync correctly

### Phase 4: Slash Commands
- [ ] Type "/" in message input
- [ ] Command autocomplete appears
- [ ] Can select and execute commands
- [ ] Built-in commands work (/help, /ping, /echo)

### Phase 5: UI
- [ ] All Discord UI elements are visible
- [ ] Buttons are clickable
- [ ] Modal dialogs work correctly
- [ ] Error messages display properly

---

## Troubleshooting

### OAuth Errors

**"Invalid redirect URI"**
- Verify redirect URI in Discord app settings matches exactly
- Check http vs https matches
- Check for trailing slashes

**"Invalid client ID"**
- Verify CLIENT_ID in discord-config.js
- Ensure it's the correct Client ID (not Secret)
- Check it's not expired or revoked

### Import Errors

**"Failed to fetch Discord guild"**
- Verify Discord account is connected
- Check access token isn't expired
- Ensure user has manage_guild permission
- Check Discord API is accessible (not blocked by firewall)

**"Failed to import roles/channels"**
- Verify database tables were created
- Check Supabase connection string
- Ensure edge function can access database
- Check database has enough space

### Message Sync Issues

**Messages not syncing to Discord**
- Verify channel has discord_channels record
- Check Discord bot has Send Messages permission
- Verify webhook URL is correct
- Check Discord rate limits (50 req/second)

**Discord messages not syncing to chat**
- Verify webhook is set up correctly
- Check firewall allows incoming webhooks
- Verify discord_server_id is mapped correctly
- Check message parsing in function

### Slash Command Issues

**Commands not showing in autocomplete**
- Verify /slash-commands edge function is deployed
- Check commands are registered in database
- Ensure channel_id is correct
- Check browser console for errors

---

## Performance Optimization

### Database
- Indexes created automatically by migration
- Add more indexes if needed:
```sql
CREATE INDEX idx_discord_message_mapping_message_id 
  ON discord_message_mapping(message_id);
```

### Edge Functions
- Keep function payload under 6MB
- Implement request timeouts
- Use connection pooling for database

### Frontend
- Lazy load discord.js (loaded after auth)
- Cache guild list in localStorage
- Debounce message sync calls

---

## Security Best Practices

1. **Never commit secrets**
   - Keep CLIENT_SECRET and BOT_TOKEN in environment variables only
   - Use .gitignore to exclude .env files

2. **Token rotation**
   - Rotate bot token periodically
   - Implement token expiration checks
   - Use OAuth2 refresh tokens

3. **Webhook verification**
   - Verify Discord webhook signatures
   - Whitelist Discord IP ranges if possible
   - Use HTTPS only for webhooks

4. **Rate limiting**
   - Implement exponential backoff
   - Cache API responses
   - Set rate limit headers

---

## Monitoring & Logging

### Enable Function Logs
```bash
supabase functions list
supabase functions list discord-oauth
```

### Monitor Database
```sql
-- Check table sizes
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables 
WHERE tablename LIKE 'discord%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check function execution count
SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '1 hour';
```

### Set Up Alerts
- Monitor edge function error rates
- Track API rate limit usage
- Monitor database disk usage
- Set up Discord audit log monitoring

---

## Maintenance

### Regular Tasks
- Review and rotate bot token monthly
- Check Discord API changelog for deprecations
- Monitor function execution costs
- Clean up old message mappings

### Backups
```sql
-- Backup Discord sync data
SELECT * INTO discord_data_backup 
FROM (
  SELECT * FROM discord_accounts
  UNION SELECT * FROM discord_servers
) AS t;
```

### Updates
- Check Discord.js library updates
- Update Supabase SDK if needed
- Review and apply security patches

---

## Rollback Plan

If issues occur:

1. **Disable Discord features**
   - Comment out discord.js import in chat.html
   - Functions will continue to exist but won't be called

2. **Disable edge functions**
   ```bash
   supabase functions delete discord-oauth
   ```

3. **Rollback database**
   ```sql
   DROP TABLE IF EXISTS discord_accounts CASCADE;
   DROP TABLE IF EXISTS discord_servers CASCADE;
   -- etc for all discord tables
   ```

4. **Restore from backup**
   - Use Supabase's automated backups
   - Go to Settings → Backups
   - Restore to previous state

---

## Support & Resources

- Discord Developer Docs: https://discord.dev
- Supabase Docs: https://supabase.com/docs
- OAuth2 Spec: https://tools.ietf.org/html/rfc6749
- Edge Functions Guide: https://supabase.com/docs/guides/functions
- Troubleshooting: Check browser console and function logs

---

## Version Information

- Implementation Version: 1.0.0
- Discord API Version: v10
- Deno Runtime: Latest
- Date: 2026-08-21

---

## Checklist for Going Live

- [ ] Discord app created and configured
- [ ] Client ID and Secret stored securely
- [ ] Bot token created and stored securely
- [ ] Redirect URIs added to Discord app
- [ ] Database migrations applied
- [ ] discord-config.js updated with Client ID
- [ ] Supabase environment variables set
- [ ] Edge functions deployed
- [ ] All testing checklist items complete
- [ ] Performance tested with real data
- [ ] Security review completed
- [ ] Monitoring and logging configured
- [ ] Backup plan documented
- [ ] Team trained on Discord features
- [ ] Documentation updated

---

**Status:** Ready to Deploy  
**Last Updated:** 2026-08-21  
**Maintainer:** Your Team
