// ======================== DISCORD INTEGRATION ========================

// Get Discord Client ID from config
const DISCORD_CLIENT_ID = DISCORD_CONFIG?.CLIENT_ID || "1490802687111991420";
const DISCORD_AUTH_URL = DISCORD_CONFIG?.AUTH_URL || "https://discord.com/api/oauth2/authorize";
const DISCORD_API = DISCORD_CONFIG?.API_URL || "https://discord.com/api/v10";
const DISCORD_REDIRECT_URI = DISCORD_CONFIG?.REDIRECT_URI || `${window.location.origin}${window.location.pathname}`;

let discordAccount = null;
let discordGuilds = [];

async function getDiscordSessionAccount() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) return null;

    const discordIdentity = (session.user?.identities || []).find((identity) => identity.provider === "discord");
    const providerToken = session.provider_token || discordIdentity?.provider_token || null;
    const providerRefreshToken = session.provider_refresh_token || discordIdentity?.provider_refresh_token || null;

    if (!providerToken) return null;

    const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!userResponse.ok) {
      console.warn("[DISCORD] Provider token exists but Discord /users/@me failed:", userResponse.status);
      return null;
    }

    const discordUser = await userResponse.json();
    const username = localStorage.getItem("chatUsername") || window.chatUsername;
    if (!username) return null;

    return {
      id: discordUser.id,
      username,
      discord_user_id: discordUser.id,
      discord_username: discordUser.username,
      discord_tag: discordUser.discriminator ? `${discordUser.username}#${discordUser.discriminator}` : discordUser.username,
      access_token: providerToken,
      refresh_token: providerRefreshToken,
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ["identify", "guilds"],
      last_refreshed_at: new Date().toISOString(),
      source: "session",
    };
  } catch (error) {
    console.warn("[DISCORD] Failed to build Discord account from auth session:", error);
    return null;
  }

  async function linkDiscordSessionAccount(account, username) {
    if (!account?.access_token || !username) return account;

    const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link_session",
        username,
        discord_user_id: account.discord_user_id,
        discord_username: account.discord_username,
        discord_tag: account.discord_tag,
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        token_expires_at: account.token_expires_at,
        scopes: account.scopes,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save Discord session account: ${errorText}`);
    }

    const result = await response.json();
    return result.account || account;
  }
}

// Initialize Discord integration (called after chatUsername is set)
async function initializeDiscordIntegration() {
  try {
    const username = localStorage.getItem("chatUsername") || window.chatUsername;
    if (!username) {
      console.log("[DISCORD] No username in localStorage yet");
      return;
    }

    console.log("[DISCORD] Initializing Discord integration for user:", username);
    await loadDiscordAccount(username);

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && (state === "discord_auth" || state === "discord")) {
      console.log("[DISCORD] Processing OAuth callback...");
      await handleDiscordOAuthCallback(code, username);
    }
  } catch (error) {
    console.error("[DISCORD] Initialization error:", error);
  }
}

// Show Discord connection button in profile
function renderDiscordConnectionUI() {
  const discordSection = document.getElementById("discordSection");
  if (!discordSection) return;

  const currentAcc = discordAccount || window.discordAccount;
  if (currentAcc) {
    discordSection.innerHTML = `
      <div style="margin: 10px 0;">
        <strong>Discord Connected</strong>
        <div style="margin-top: 5px; font-size: 12px;">
          <p>User: <strong>${currentAcc.discord_username}</strong></p>
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
  const redirectUri = DISCORD_REDIRECT_URI;
  console.log("[DISCORD] Client ID:", DISCORD_CLIENT_ID);
  console.log("[DISCORD] Redirect URI:", redirectUri);
  const scope = (DISCORD_CONFIG?.SCOPES || ["identify", "guilds"]).join(" ");
  const url = new URL(DISCORD_AUTH_URL);
  url.searchParams.append("client_id", DISCORD_CLIENT_ID);
  url.searchParams.append("redirect_uri", redirectUri);
  url.searchParams.append("response_type", "code");
  url.searchParams.append("scope", scope);
  url.searchParams.append("state", "discord_auth");

  console.log("[DISCORD] Redirecting to:", url.toString());
  window.location.href = url.toString();
}

// Handle Discord OAuth callback
async function handleDiscordOAuthCallback(code, usernameParam) {
  const username = usernameParam || localStorage.getItem("chatUsername") || window.chatUsername;
  console.log("[DISCORD] Handling OAuth callback with code:", code, "username:", username);
  const redirectUri = DISCORD_REDIRECT_URI;

  try {
    console.log("[DISCORD] Exchanging code for tokens...");
    const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange_code",
        code,
        username: username,
        redirect_uri: redirectUri,
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

    // Clean up URL query parameters
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    await loadDiscordAccount(username);

    console.log("[DISCORD] Discord account successfully connected!");
    alert("✅ Discord account connected!");
  } catch (error) {
    console.error("[DISCORD] OAuth error:", error);
    alert(`❌ Discord connection failed: ${error.message}`);
  }
}

// Load Discord account data
async function loadDiscordAccount(usernameParam) {
  const username = usernameParam || localStorage.getItem("chatUsername") || window.chatUsername;
  if (!username) return null;
  console.log("[DISCORD] loadDiscordAccount() called for username:", username);
  try {
    let data = null;
    const { data: dbRow, error } = await supabaseClient
      .from("discord_accounts")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      console.error("[DISCORD] Database query error:", error);
      throw error;
    }

    if (dbRow) {
      console.log("[DISCORD] Found Discord account row:", dbRow.discord_username);
      data = dbRow;
    }

    if (!data) {
      const sessionAccount = await getDiscordSessionAccount();
      if (sessionAccount) {
        console.log("[DISCORD] Using Discord account from Supabase auth session");
        data = await linkDiscordSessionAccount(sessionAccount, username);
      }
    }

    if (data) {
      discordAccount = data;
      window.discordAccount = data;
      localStorage.setItem(`discord_account_${username}`, JSON.stringify(discordAccount));
    } else {
      console.log("[DISCORD] No Discord account found for user:", username);
      discordAccount = null;
      window.discordAccount = null;
      localStorage.removeItem(`discord_account_${username}`);
    }

    renderDiscordConnectionUI();
    if (typeof updateAccountLinkButtons === "function") {
      updateAccountLinkButtons();
    }
    if (typeof refreshSettingsConnections === "function") {
      refreshSettingsConnections();
    }

    return discordAccount;
  } catch (error) {
    console.error("[DISCORD] Failed to load Discord account:", error);
  }
}

// Disconnect Discord account
async function disconnectDiscordAccount() {
  const username = localStorage.getItem("chatUsername") || window.chatUsername;
  if (!username) return;

  try {
    const { error } = await supabaseClient
      .from("discord_accounts")
      .delete()
      .eq("username", username);

    if (error) throw error;

    discordAccount = null;
    window.discordAccount = null;
    localStorage.removeItem(`discord_account_${username}`);

    renderDiscordConnectionUI();
    if (typeof updateAccountLinkButtons === "function") {
      updateAccountLinkButtons();
    }
    if (typeof refreshSettingsConnections === "function") {
      refreshSettingsConnections();
    }

    alert("✅ Discord account disconnected!");
  } catch (error) {
    console.error("Failed to disconnect Discord:", error);
    alert("❌ Failed to disconnect Discord account");
  }
}

// ======================== DISCORD SERVER IMPORT ========================

// Fetch user's Discord guilds
async function fetchDiscordGuilds() {
  const username = localStorage.getItem("chatUsername") || window.chatUsername;
  const currentAcc = discordAccount || window.discordAccount || (await getDiscordSessionAccount());

  if (!currentAcc) {
    console.log("[DISCORD] No Discord account connected");
    return [];
  }

  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${supabaseUrl}/functions/v1/discord-oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_guilds",
          username,
          access_token: currentAcc.access_token,
          refresh_token: currentAcc.refresh_token,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        discordGuilds = result.guilds || [];
        console.log("[DISCORD] Successfully fetched", discordGuilds.length, "guilds");
        return discordGuilds;
      }

      const errorText = await response.text();
      lastError = new Error("Failed to fetch Discord guilds: " + errorText);
      const retryAfter = Number(response.headers.get("Retry-After") || 0);
      if (response.status !== 429 && !errorText.includes("rate limited")) break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfter * 1000)));
    }

    throw lastError || new Error("Failed to fetch Discord guilds.");
  } catch (error) {
    console.log("[DISCORD] Calling discord-oauth function to get guilds...");
    console.error("[DISCORD] Failed to fetch Discord guilds:", error);
    alert(`❌ Failed to fetch Discord guilds: ${error.message}`);
    return [];
  }
}

// Show Discord import dialog in Add Server modal
function showDiscordImportUI() {
  if (typeof openModal === "function") {
    openModal("importDiscordModal");
    loadDiscordImportGuilds();
  }
}

// Load and display Discord guilds in modal
async function loadDiscordImportGuilds() {
  const guildsList = document.getElementById("discordGuildsList");
  if (!guildsList) return;

  const username = localStorage.getItem("chatUsername") || window.chatUsername;
  if (!discordAccount && !window.discordAccount && username) {
    await loadDiscordAccount(username);
  }

  const currentAcc = discordAccount || window.discordAccount;
  if (!currentAcc) {
    guildsList.innerHTML = `
      <div style="text-align: center; padding: 20px 10px;">
        <p style="color: #ff6b6b; margin-bottom: 12px; font-weight: bold;">❌ Discord account is not connected.</p>
        <p style="font-size: 13px; color: #ccc; margin-bottom: 15px;">Please connect your Discord account before importing servers.</p>
        <button onclick="initiateDiscordOAuth()" style="padding: 10px 18px; background: #5865F2; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; width: 100%;">
          🔗 Connect Discord Account
        </button>
      </div>
    `;
    return;
  }

  guildsList.innerHTML = "<p style='text-align: center; padding: 15px;'>⏳ Loading Discord servers...</p>";

  const guilds = await fetchDiscordGuilds();

  if (!guilds || guilds.length === 0) {
    guildsList.innerHTML = `
      <div style="text-align: center; padding: 15px;">
        <p style="color: #bbb;">No Discord servers found for this account.</p>
      </div>
    `;
    return;
  }

  let html = "<div style='max-height: 280px; overflow-y: auto; margin-bottom: 15px;'>";
  guilds.forEach((guild) => {
    const iconUrl = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
      : "https://via.placeholder.com/32";

    html += `
      <div style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #333; cursor: pointer;" onclick="selectDiscordGuild('${guild.id}')">
        <img src="${iconUrl}" alt="${guild.name}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 12px; object-fit: cover;">
        <div style="flex: 1;">
          <div style="font-weight: bold; color: #fff;">${guild.name}</div>
          <div style="font-size: 11px; color: #999;">${guild.owner ? '👑 Owner' : 'Member'}</div>
        </div>
        <input type="checkbox" name="discord-guild" value="${guild.id}" style="cursor: pointer;" onclick="event.stopPropagation()" />
      </div>
    `;
  });
  html += "</div>";

  html += `
    <div style="margin-top: 10px;">
      <label style="font-size: 12px; display: block; margin-bottom: 6px; color: #ccc;">
        <strong>Sync Direction:</strong>
      </label>
      <select id="syncDirection" style="width: 100%; padding: 8px; margin-bottom: 15px; background: #2f3136; color: #fff; border: 1px solid #444; border-radius: 4px;">
        <option value="bidirectional">Bidirectional (sync both ways)</option>
        <option value="incoming_only">Incoming Only (Discord → Chat)</option>
        <option value="outgoing_only">Outgoing Only (Chat → Discord)</option>
      </select>
      <button onclick="importSelectedDiscordGuilds()" style="padding: 10px 15px; background: #43B581; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; width: 100%;">
        ✅ Import Selected Servers
      </button>
    </div>
  `;

  guildsList.innerHTML = html;
}

// Select Discord guild and import it
function selectDiscordGuild(guildId) {
  const checkbox = document.querySelector(`input[name="discord-guild"][value="${guildId}"]`);
  if (checkbox) checkbox.checked = !checkbox.checked;
}

// Import all selected Discord guilds
async function importSelectedDiscordGuilds() {
  console.log("[DISCORD] Import button clicked");
  const selected = [...document.querySelectorAll('input[name="discord-guild"]:checked')];
  if (selected.length === 0) {
    alert("❌ Please select at least one Discord server to import");
    return;
  }

  const syncDirection = document.getElementById("syncDirection")?.value || "bidirectional";
  const username = localStorage.getItem("chatUsername") || window.chatUsername;
  const currentAcc = discordAccount || window.discordAccount;
  const selectedGuilds = selected.map((checkbox) =>
    discordGuilds.find((guild) => guild.id === checkbox.value)
  ).filter(Boolean);

  try {
    const guildsList = document.getElementById("discordGuildsList");
    if (guildsList) {
      guildsList.innerHTML = `<p style='text-align: center; padding: 20px;'>⏳ Importing ${selectedGuilds.length} Discord server(s)... This may take a moment.</p>`;
    }

    const results = [];
    const failures = [];
    for (const guild of selectedGuilds) {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/discord-import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import_server",
            discord_guild_id: guild.id,
            discord_guild: guild,
            access_token: currentAcc ? currentAcc.access_token : null,
            username,
            sync_direction: syncDirection,
          }),
        });
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(responseText || "Import failed");
        }
        results.push(JSON.parse(responseText));
      } catch (error) {
        failures.push(`${guild.name}: ${error.message}`);
      }
    }

    if (results.length === 0) {
      throw new Error(failures.join("\n") || "All server imports failed.");
    }

    const importedSummary = results.map((result) => {
      const imported = result.imported || {};
      const diagnostics = result.diagnostics || {};
      const warnings = result.warnings?.length ? `\n  Warnings: ${result.warnings.join(" ")}` : "";
      return `\n${imported.categories || 0} categories, ${imported.channels || 0} channels, ${imported.roles || 0} roles, ${imported.members || 0} members, ${imported.messages || 0} messages. API: channels ${diagnostics.channels_status ?? "?"}, roles ${diagnostics.roles_status ?? "?"}, members ${diagnostics.members_status ?? "?"}.${warnings}`;
    }).join("");
    const failureMessage = failures.length ? `\n\nFailed:\n${failures.join("\n")}` : "";
    alert(`✅ Imported ${results.length} Discord server(s) successfully.${importedSummary}${failureMessage}`);
    if (typeof closeModal === "function") {
      closeModal("importDiscordModal");
    }

    // Reload servers list and switch to the new server
    if (typeof loadServers === "function") {
      await loadServers();
    }
    if (results[0]?.server_id && typeof switchServer === "function") {
      await switchServer(results[0].server_id);
    }
  } catch (error) {
    console.error("[DISCORD] Import error:", error);
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
      }),
    });

    if (!response.ok) {
      console.error("Failed to sync message to Discord:", await response.text());
    }

    async function syncMessagesFromDiscord() {
      if (typeof currentServerId === "undefined" || !currentServerId) return;
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/discord-message-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_from_discord",
            server_id: currentServerId,
          }),
        });
        if (!response.ok) {
          console.error("Failed to receive Discord messages:", await response.text());
        }
      } catch (error) {
        console.error("Error receiving Discord messages:", error);
      }
    }
  } catch (error) {
    console.error("Error syncing message to Discord:", error);
  }
}

// ======================== INITIALIZATION ========================

// Initialize on page load
window.addEventListener("load", async () => {
  await initializeDiscordIntegration();
  await syncMessagesFromDiscord();
  window.setInterval(syncMessagesFromDiscord, 15000);
});
