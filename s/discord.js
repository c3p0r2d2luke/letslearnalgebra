// ======================== DISCORD INTEGRATION ========================

// Get Discord Client ID from config
const DISCORD_CLIENT_ID = DISCORD_CONFIG?.CLIENT_ID || "1490802687111991420";
const DISCORD_REDIRECT_URI = DISCORD_CONFIG?.REDIRECT_URI || `${window.location.origin}`;
const DISCORD_AUTH_URL = "https://discord.com/api/oauth2/authorize";

let discordAccount = null;
let discordGuilds = [];

// Initialize Discord integration (called after chatUsername is set)
async function initializeDiscordIntegration() {
  try {
    // Get username from localStorage (set by auth.js)
    const username = localStorage.getItem("chatUsername");
    
    if (!username) {
      console.log("[DISCORD] No username in localStorage yet, will try again on next auth state change");
      return;
    }

    console.log("[DISCORD] Initializing Discord integration for user:", username);

    const discordAccountId = localStorage.getItem(`discord_account_${username}`);
    console.log("[DISCORD] Stored discord account ID:", discordAccountId);
    if (discordAccountId) {
      console.log("[DISCORD] Loading existing Discord account...");
      await loadDiscordAccount(username);
    }

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    console.log("[DISCORD] OAuth callback check - code:", code ? "present" : "none", "state:", params.get("state"));
    if (code && params.get("state") === "discord_auth") {
      console.log("[DISCORD] Processing OAuth callback...");
      await handleDiscordOAuthCallback(code, username);
    }
  } catch (error) {
    console.error("[DISCORD] Initialization error:", error);
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
  console.log("[DISCORD] Initiating OAuth flow...");
  console.log("[DISCORD] Client ID:", DISCORD_CLIENT_ID);
  console.log("[DISCORD] Redirect URI:", DISCORD_REDIRECT_URI);
  const scope = ["identify", "guilds", "channels.read", "messages.read"].join("%20");
  const url = new URL(DISCORD_AUTH_URL);
  url.searchParams.append("client_id", DISCORD_CLIENT_ID);
  url.searchParams.append("redirect_uri", DISCORD_REDIRECT_URI);
  url.searchParams.append("response_type", "code");
  url.searchParams.append("scope", scope);
  url.searchParams.append("state", "discord_auth");

  console.log("[DISCORD] Redirecting to:", url.toString());
  window.location.href = url.toString();
}

// Handle Discord OAuth callback
async function handleDiscordOAuthCallback(code) {
  const username = localStorage.getItem("chatUsername");
  console.log("[DISCORD] Handling OAuth callback with code:", code, "username:", username);
  try {
    console.log("[DISCORD] Exchanging code for tokens...");
    const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange_code",
        code,
        username: username,
      }),
    });

    console.log("[DISCORD] OAuth exchange response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DISCORD] OAuth exchange failed:", errorText);
      throw new Error("Discord OAuth exchange failed: " + errorText);
    }

    const result = await response.json();
    console.log("[DISCORD] OAuth exchange successful:", result);
    await loadDiscordAccount();

    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
    renderDiscordConnectionUI();

    console.log("[DISCORD] Discord account successfully connected!");
    alert("✅ Discord account connected!");
  } catch (error) {
    console.error("[DISCORD] OAuth error:", error);
    console.error("[DISCORD] Full error stack:", error.stack);
    alert(`❌ Discord connection failed: ${error.message}`);
  }
}

// Load Discord account data
async function loadDiscordAccount() {
  const username = localStorage.getItem("chatUsername");
  console.log("[DISCORD] loadDiscordAccount() called for username:", username);
  try {
    console.log("[DISCORD] Querying discord_accounts table for username:", username);
    const { data, error } = await supabaseClient
      .from("discord_accounts")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    console.log("[DISCORD] Query response - error:", error, "data:", data);
    if (error) {
      console.error("[DISCORD] Database query error:", error);
      throw error;
    }

    if (data) {
      console.log("[DISCORD] Found Discord account:", data.discord_username);
      discordAccount = data;
      localStorage.setItem(`discord_account_${username}`, JSON.stringify(discordAccount));
      renderDiscordConnectionUI();
    } else {
      console.log("[DISCORD] No Discord account found in database for user:", username);
      discordAccount = null;
    }

    return discordAccount;
  } catch (error) {
    console.error("[DISCORD] Failed to load Discord account:", error);
    console.error("[DISCORD] Stack:", error.stack);
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
  console.log("[DISCORD] Fetching Discord guilds for user:", chatUsername);
  if (!discordAccount) {
    console.log("[DISCORD] No Discord account connected");
    alert("❌ Please connect your Discord account first");
    return [];
  }

  try {
    console.log("[DISCORD] Calling discord-oauth function to get guilds...");
    const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_guilds",
        refresh_token: discordAccount.refresh_token,
      }),
    });

    console.log("[DISCORD] Guild fetch response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DISCORD] Guild fetch error:", errorText);
      throw new Error("Failed to fetch Discord guilds: " + errorText);
    }

    const result = await response.json();
    discordGuilds = result.guilds || [];
    console.log("[DISCORD] Successfully fetched", discordGuilds.length, "guilds");
    return discordGuilds;
  } catch (error) {
    console.error("[DISCORD] Failed to fetch Discord guilds:", error);
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
  console.log("[DISCORD] Import button clicked");
  const selected = document.querySelector('input[name="discord-guild"]:checked');
  if (!selected) {
    console.log("[DISCORD] No guild selected");
    alert("❌ Please select a Discord server");
    return;
  }

  const guildId = selected.value;
  const syncDirection = document.getElementById("syncDirection").value;
  console.log("[DISCORD] Selected guild ID:", guildId, "Sync direction:", syncDirection);

  try {
    // Show progress
    const guildsList = document.getElementById("discordGuildsList");
    guildsList.innerHTML = "<p>Importing Discord server... This may take a moment.</p>";

    console.log("[DISCORD] Sending import request to discord-import function...");
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

    console.log("[DISCORD] Import response status:", response.status);
    const responseText = await response.text();
    console.log("[DISCORD] Import response:", responseText);

    if (!response.ok) {
      console.error("[DISCORD] Import failed with status:", response.status);
      throw new Error(responseText);
    }

    const result = JSON.parse(responseText);
    console.log("[DISCORD] Import successful! Result:", result);

    alert("✅ Discord server imported successfully!");
    guildsList.innerHTML = "";

    // Reload servers list
    console.log("[DISCORD] Reloading servers list...");
    await loadServers();
  } catch (error) {
    console.error("[DISCORD] Import error:", error);
    console.error("[DISCORD] Full stack:", error.stack);
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

// ======================== DEBUGGING & TESTING ========================

// Debug function - check Discord account status in database
window.debugDiscordAccount = async function() {
  console.log("=== DISCORD DEBUG ===");
  console.log("chatUsername:", chatUsername);
  console.log("discordAccount object:", discordAccount);
  console.log("localStorage data:", localStorage.getItem(`discord_account_${chatUsername}`));
  
  try {
    console.log("Querying discord_accounts table for all records...");
    const { data, error } = await supabaseClient
      .from("discord_accounts")
      .select("*");
    
    if (error) {
      console.error("Error querying discord_accounts:", error);
      return;
    }
    
    console.log("All Discord accounts in database:", data);
    console.log("Total records:", data?.length || 0);
  } catch (err) {
    console.error("Debug error:", err);
  }
};

// Test Discord OAuth by manually calling the function
window.testDiscordOAuth = async function() {
  console.log("=== TESTING DISCORD OAUTH ===");
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === "1490802687111991420") {
    console.error("❌ DISCORD_CLIENT_ID not configured in discord-config.js");
    return;
  }
  
  console.log("Client ID:", DISCORD_CLIENT_ID);
  console.log("Redirect URI:", DISCORD_REDIRECT_URI);
  console.log("Initiating OAuth flow...");
  initiateDiscordOAuth();
};

// ======================== INITIALIZATION ========================

// Initialize on page load
window.addEventListener("load", async () => {
  await initializeDiscordIntegration();
});
