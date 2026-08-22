// ======================== DISCORD INTEGRATION ========================

// Get Discord Client ID from config
const DISCORD_CLIENT_ID = DISCORD_CONFIG?.CLIENT_ID || "YOUR_DISCORD_CLIENT_ID";
const DISCORD_REDIRECT_URI = DISCORD_CONFIG?.REDIRECT_URI || `${window.location.origin}`;
const DISCORD_AUTH_URL = "https://discord.com/api/oauth2/authorize";

let discordAccount = null;
let discordGuilds = [];

// Initialize Discord integration
async function initializeDiscordIntegration() {
  if (!chatUsername) return;

  const discordAccountId = localStorage.getItem(`discord_account_${chatUsername}`);
  if (discordAccountId) {
    await loadDiscordAccount();
  }

  // Handle OAuth callback
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code && params.get("state") === "discord_auth") {
    await handleDiscordOAuthCallback(code);
  }
}

// Show Discord connection button in profile
function renderDiscordConnectionUI() {
  const profileBox = document.getElementById("profileBox");
  if (!profileBox) return;

  let discordSection = document.getElementById("discordSection");
  if (!discordSection) {
    discordSection = document.createElement("div");
    discordSection.id = "discordSection";
    discordSection.style.borderTop = "1px solid #333";
    discordSection.style.paddingTop = "10px";
    discordSection.style.marginTop = "10px";
    profileBox.appendChild(discordSection);
  }

  if (discordAccount) {
    discordSection.innerHTML = `
      <div style="margin: 10px 0;">
        <strong>Discord Connected</strong>
        <div style="margin-top: 5px; font-size: 12px;">
          <p>User: <strong>${discordAccount.discord_username}</strong></p>
          <button onclick="disconnectDiscordAccount()" style="padding: 5px 10px; background: #f44747; border: none; border-radius: 4px; color: white; cursor: pointer;">
            Disconnect Discord
          </button>
        </div>
      </div>
    `;
  } else {
    discordSection.innerHTML = `
      <button onclick="initiateDiscordOAuth()" style="padding: 8px 15px; background: #5865F2; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; width: 100%;">
        🔗 Connect Discord Account
      </button>
    `;
  }
}

// Initiate Discord OAuth flow
function initiateDiscordOAuth() {
  const scope = ["identify", "guilds", "channels.read", "messages.read"].join("%20");
  const url = new URL(DISCORD_AUTH_URL);
  url.searchParams.append("client_id", DISCORD_CLIENT_ID);
  url.searchParams.append("redirect_uri", DISCORD_REDIRECT_URI);
  url.searchParams.append("response_type", "code");
  url.searchParams.append("scope", scope);
  url.searchParams.append("state", "discord_auth");

  window.location.href = url.toString();
}

// Handle Discord OAuth callback
async function handleDiscordOAuthCallback(code) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange_code",
        code,
        username: chatUsername,
      }),
    });

    if (!response.ok) {
      throw new Error("Discord OAuth exchange failed");
    }

    const result = await response.json();
    await loadDiscordAccount();

    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
    renderDiscordConnectionUI();

    alert("✅ Discord account connected!");
  } catch (error) {
    console.error("Discord OAuth error:", error);
    alert(`❌ Discord connection failed: ${error.message}`);
  }
}

// Load Discord account data
async function loadDiscordAccount() {
  try {
    const { data, error } = await supabaseClient
      .from("discord_accounts")
      .select("*")
      .eq("username", chatUsername)
      .maybeSingle();

    if (error) throw error;

    discordAccount = data;
    localStorage.setItem(`discord_account_${chatUsername}`, JSON.stringify(discordAccount));
    renderDiscordConnectionUI();

    return discordAccount;
  } catch (error) {
    console.error("Failed to load Discord account:", error);
  }
}

// Disconnect Discord account
async function disconnectDiscordAccount() {
  try {
    const { error } = await supabaseClient
      .from("discord_accounts")
      .delete()
      .eq("username", chatUsername);

    if (error) throw error;

    discordAccount = null;
    localStorage.removeItem(`discord_account_${chatUsername}`);
    renderDiscordConnectionUI();

    alert("✅ Discord account disconnected!");
  } catch (error) {
    console.error("Failed to disconnect Discord:", error);
    alert("❌ Failed to disconnect Discord account");
  }
}

// ======================== DISCORD SERVER IMPORT ========================

// Fetch user's Discord guilds
async function fetchDiscordGuilds() {
  if (!discordAccount) {
    alert("❌ Please connect your Discord account first");
    return [];
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_guilds",
        refresh_token: discordAccount.refresh_token,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch Discord guilds");
    }

    const result = await response.json();
    discordGuilds = result.guilds || [];
    return discordGuilds;
  } catch (error) {
    console.error("Failed to fetch Discord guilds:", error);
    alert(`❌ Failed to fetch Discord guilds: ${error.message}`);
    return [];
  }
}

// Show Discord import dialog in Add Server modal
function showDiscordImportUI() {
  const serverModal = document.getElementById("serverModal");
  if (!serverModal) return;

  let discordImportDiv = document.getElementById("discordImportUI");
  if (discordImportDiv) {
    discordImportDiv.remove();
  }

  discordImportDiv = document.createElement("div");
  discordImportDiv.id = "discordImportUI";
  discordImportDiv.style.cssText = "margin-top: 15px; padding: 10px; border: 1px solid #5865F2; border-radius: 4px;";
  discordImportDiv.innerHTML = `
    <div style="margin-bottom: 10px;">
      <button onclick="loadDiscordImportGuilds()" style="padding: 8px 15px; background: #5865F2; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; width: 100%;">
        📥 Import Discord Server
      </button>
    </div>
    <div id="discordGuildsList"></div>
  `;

  serverModal.appendChild(discordImportDiv);
}

// Load and display Discord guilds in modal
async function loadDiscordImportGuilds() {
  if (!discordAccount) {
    alert("❌ Please connect your Discord account first");
    return;
  }

  const guildsList = document.getElementById("discordGuildsList");
  guildsList.innerHTML = "<p>Loading Discord guilds...</p>";

  const guilds = await fetchDiscordGuilds();

  if (guilds.length === 0) {
    guildsList.innerHTML = "<p>No Discord servers found</p>";
    return;
  }

  let html = "<div style='max-height: 300px; overflow-y: auto;'>";
  guilds.forEach((guild) => {
    const iconUrl = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
      : "https://via.placeholder.com/30";

    html += `
      <div style="display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #444; cursor: pointer;" onclick="selectDiscordGuild('${guild.id}', '${guild.name}')">
        <img src="${iconUrl}" alt="${guild.name}" style="width: 30px; height: 30px; border-radius: 50%; margin-right: 10px;">
        <div style="flex: 1;">
          <strong>${guild.name}</strong>
          <div style="font-size: 11px; color: #999;">Members: ${guild.approximate_member_count}</div>
        </div>
        <input type="radio" name="discord-guild" value="${guild.id}" />
      </div>
    `;
  });
  html += "</div>";

  html += `
    <div style="margin-top: 10px;">
      <label style="font-size: 12px; display: block; margin-bottom: 8px;">
        <strong>Sync Direction:</strong>
      </label>
      <select id="syncDirection" style="width: 100%; padding: 5px; margin-bottom: 10px; background: #222; color: #fff; border: 1px solid #444;">
        <option value="bidirectional">Bidirectional (sync both ways)</option>
        <option value="incoming_only">Incoming Only (Discord → Chat)</option>
        <option value="outgoing_only">Outgoing Only (Chat → Discord)</option>
      </select>
      <button onclick="importSelectedDiscordGuild()" style="padding: 8px 15px; background: #43B581; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; width: 100%;">
        ✅ Import Selected Server
      </button>
    </div>
  `;

  guildsList.innerHTML = html;
}

// Select Discord guild and import it
async function selectDiscordGuild(guildId, guildName) {
  const radio = document.querySelector(`input[value="${guildId}"]`);
  if (radio) radio.checked = true;
}

// Import the selected Discord guild
async function importSelectedDiscordGuild() {
  const selected = document.querySelector('input[name="discord-guild"]:checked');
  if (!selected) {
    alert("❌ Please select a Discord server");
    return;
  }

  const guildId = selected.value;
  const syncDirection = document.getElementById("syncDirection").value;

  try {
    // Show progress
    const guildsList = document.getElementById("discordGuildsList");
    guildsList.innerHTML = "<p>Importing Discord server... This may take a moment.</p>";

    const response = await fetch(`${supabaseUrl}/functions/v1/discord-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "import_server",
        discord_guild_id: guildId,
        access_token: discordAccount.access_token,
        username: chatUsername,
        sync_direction: syncDirection,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const result = await response.json();

    alert("✅ Discord server imported successfully!");
    guildsList.innerHTML = "";

    // Reload servers list
    await loadServers();
  } catch (error) {
    console.error("Import failed:", error);
    alert(`❌ Import failed: ${error.message}`);
    await loadDiscordImportGuilds();
  }
}

// ======================== MESSAGE SYNC ========================

// Check if a channel is synced to Discord
async function isChannelSyncedToDiscord(channelId) {
  try {
    const { data, error } = await supabaseClient
      .from("discord_channels")
      .select("discord_server_id, discord_channel_id")
      .eq("channel_id", channelId)
      .maybeSingle();

    return data || null;
  } catch (error) {
    console.error("Error checking Discord sync:", error);
    return null;
  }
}

// Sync a message to Discord
async function syncMessageToDiscord(messageId, channelId) {
  try {
    const syncInfo = await isChannelSyncedToDiscord(channelId);
    if (!syncInfo) return; // Channel not synced

    const response = await fetch(`${supabaseUrl}/functions/v1/discord-message-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sync_to_discord",
        message_id: messageId,
        channel_id: channelId,
        bot_token: Deno.env.get("DISCORD_BOT_TOKEN"), // Will be handled server-side
      }),
    });

    if (!response.ok) {
      console.error("Failed to sync message to Discord");
    }
  } catch (error) {
    console.error("Error syncing message to Discord:", error);
  }
}

// ======================== SLASH COMMANDS ========================

// Register a slash command
async function registerSlashCommand(serverId, botId, commandName, description, options, username) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/slash-commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "register_command",
        server_id: serverId,
        bot_id: botId,
        command_name: commandName,
        description,
        options: options || [],
        username,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to register command");
    }

    return await response.json();
  } catch (error) {
    console.error("Error registering command:", error);
    throw error;
  }
}

// Get slash commands for a server
async function getSlashCommands(serverId) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/slash-commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_commands",
        server_id: serverId,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch commands");
    }

    const data = await response.json();
    return data.commands || [];
  } catch (error) {
    console.error("Error fetching commands:", error);
    return [];
  }
}

// Execute a slash command
async function executeSlashCommand(serverId, commandName, params) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/slash-commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute_command",
        server_id: serverId,
        command_name: commandName,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to execute command");
    }

    return await response.json();
  } catch (error) {
    console.error("Error executing command:", error);
    throw error;
  }
}

// Add slash command UI to message input
function setupSlashCommandUI() {
  const messageInput = document.getElementById("messageInput");
  if (!messageInput) return;

  messageInput.addEventListener("keyup", async (e) => {
    if (e.key === "/" && messageInput.value === "/") {
      await showCommandAutocomplete();
    }
  });
}

// Show command autocomplete dropdown
async function showCommandAutocomplete() {
  if (!currentServerId) return;

  const commands = await getSlashCommands(currentServerId);
  if (commands.length === 0) return;

  let autocompleteDiv = document.getElementById("commandAutocomplete");
  if (!autocompleteDiv) {
    autocompleteDiv = document.createElement("div");
    autocompleteDiv.id = "commandAutocomplete";
    autocompleteDiv.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 10px;
      background: #2C2F33;
      border: 1px solid #5865F2;
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 1000;
      min-width: 200px;
    `;
    document.body.appendChild(autocompleteDiv);
  }

  let html = "";
  commands.forEach((cmd) => {
    html += `
      <div style="padding: 8px 12px; border-bottom: 1px solid #444; cursor: pointer; hover-background: #3c3f45;" onclick="insertCommand('${cmd.command_name}')">
        <strong>/${cmd.command_name}</strong>
        <div style="font-size: 11px; color: #999;">${cmd.description}</div>
      </div>
    `;
  });

  autocompleteDiv.innerHTML = html;
  autocompleteDiv.style.display = "block";
}

// Insert command into message input
function insertCommand(commandName) {
  const messageInput = document.getElementById("messageInput");
  messageInput.value = `/${commandName} `;
  messageInput.focus();

  const autocompleteDiv = document.getElementById("commandAutocomplete");
  if (autocompleteDiv) {
    autocompleteDiv.style.display = "none";
  }
}

// Parse and handle slash commands
async function handleSlashCommand(message, channelId) {
  if (!message.startsWith("/")) return null;

  const parts = message.slice(1).split(" ");
  const commandName = parts[0];
  const params = {};

  // Parse parameters (simplified - assumes key=value format)
  for (let i = 1; i < parts.length; i++) {
    const [key, value] = parts[i].split("=");
    if (key && value) {
      params[key] = value;
    }
  }

  try {
    const result = await executeSlashCommand(currentServerId, commandName, params);
    return result.result || "Command executed";
  } catch (error) {
    return `Error executing command: ${error.message}`;
  }
}

// ======================== INITIALIZATION ========================

// Initialize on page load
window.addEventListener("load", async () => {
  await initializeDiscordIntegration();
});
