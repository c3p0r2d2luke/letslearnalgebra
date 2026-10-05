-- ======================== DISCORD INTEGRATION SCHEMA ========================
-- This migration adds all tables and indexes for Discord server import and sync

-- 1. Discord Accounts (OAuth tokens and user info)
CREATE TABLE IF NOT EXISTS discord_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT NOT NULL,
  discord_tag TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  scopes TEXT[] DEFAULT ARRAY['identify', 'guilds'],
  last_refreshed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Discord Servers (imported Discord guilds)
CREATE TABLE IF NOT EXISTS discord_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  discord_guild_id TEXT NOT NULL,
  discord_guild_name TEXT NOT NULL,
  discord_owner_id TEXT,
  discord_icon_url TEXT,
  sync_direction TEXT DEFAULT 'bidirectional' CHECK (sync_direction IN ('bidirectional', 'incoming_only', 'outgoing_only')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(server_id, discord_guild_id)
);

-- 3. Discord Channels (synced channels)
CREATE TABLE IF NOT EXISTS discord_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_server_id UUID NOT NULL REFERENCES discord_servers(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  discord_channel_id TEXT NOT NULL,
  discord_channel_name TEXT NOT NULL,
  channel_type TEXT DEFAULT 'text' CHECK (channel_type IN ('text', 'voice')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(channel_id, discord_channel_id)
);

-- 4. Discord Roles (imported roles)
CREATE TABLE IF NOT EXISTS discord_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_server_id UUID NOT NULL REFERENCES discord_servers(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
  discord_role_id TEXT NOT NULL,
  discord_role_name TEXT NOT NULL,
  discord_color TEXT,
  discord_permissions TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(role_id, discord_role_id)
);

-- 5. Discord Members (imported members)
CREATE TABLE IF NOT EXISTS discord_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_server_id UUID NOT NULL REFERENCES discord_servers(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES server_members(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  discord_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(member_id, discord_user_id)
);

-- 6. Message Mapping (track synced messages)
CREATE TABLE IF NOT EXISTS discord_message_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_server_id UUID NOT NULL REFERENCES discord_servers(id) ON DELETE CASCADE,
  discord_channel_id TEXT NOT NULL,
  chat_message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  discord_message_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(chat_message_id, discord_message_id)
);

-- 7. Server Bots (Discord bots on servers)
CREATE TABLE IF NOT EXISTS server_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  bot_name TEXT NOT NULL,
  bot_type TEXT CHECK (bot_type IN ('dyno', 'mee6', 'MEE6', 'custom')),
  bot_token TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 8. Slash Commands
CREATE TABLE IF NOT EXISTS slash_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  command_name TEXT NOT NULL,
  description TEXT,
  options JSONB DEFAULT '[]'::jsonb,
  handler_function TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(server_id, command_name)
);

-- ======================== ADD DISCORD COLUMN TO USERS ========================
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_account_id UUID REFERENCES discord_accounts(id) ON DELETE SET NULL;

-- ======================== INDEXES FOR PERFORMANCE ========================
CREATE INDEX IF NOT EXISTS idx_discord_accounts_username ON discord_accounts(username);
CREATE INDEX IF NOT EXISTS idx_discord_servers_guild_id ON discord_servers(discord_guild_id);
CREATE INDEX IF NOT EXISTS idx_discord_channels_channel_id ON discord_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_discord_roles_role_id ON discord_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_discord_members_member_id ON discord_members(member_id);
CREATE INDEX IF NOT EXISTS idx_slash_commands_server_id ON slash_commands(server_id);
