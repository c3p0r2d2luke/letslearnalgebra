// ======================== REALTIME FOR CHANNELS & CATEGORIES ========================

// Refetch both categories and channels from DB, then re-render.
// Called by both realtime handlers so every client always has the authoritative order.
async function reloadChannelsRealtime(deletedChannelId = null) {
  await loadCategories();
  let q = supabaseClient.from("channels").select("*").order("sort_order");
  if (currentServerId) q = q.eq("server_id", currentServerId);
  const { data, error } = await q;
  if (error) return;
  channels = data;
  await loadChannelPermissionsForServer();
  renderChannelList();
  renderMemberList();

  // If the channel the user was viewing was deleted, switch away
  if (deletedChannelId && currentChannelId === deletedChannelId) {
    if (channels.length > 0) switchChannel(channels[0].id);
    else {
      currentChannelId = null;
      messagesList.innerHTML = "";
      document.getElementById("currentChannelName").textContent = "No channels";
    }
  }

  // Keep the header name in sync if the current channel was renamed
  if (currentChannelId) {
    const cur = channels.find(c => c.id === currentChannelId);
    if (cur) document.getElementById("currentChannelName").textContent = "# " + cur.name;
  }
}

// Server-scoped realtime for channels & categories — set up per switchServer()
var _channelRealtimeSub = null;
var _categoryRealtimeSub = null;
var _customEmojiRealtimeSub = null;
var _serverMembersLoadPromise = null;
var _lastServerMembersLoadAt = 0;
var _lastServerMembersLoadServerId = null;
var _memberRealtimeServerId = null;
// Remember the last server before entering DM "server" view so we can restore it
var previousServerIdBeforeDm = null;

// Ensure sidebar shows only DMs when in DM mode, or shows channels when not
function setSidebarForDmMode(isDm) {
  const channelListEl = document.getElementById('channelList');
  const channelHeader = document.querySelector('.channel-header');
  const dmSection = document.querySelector('.dm-section');
  if (isDm) {
    if (channelListEl) channelListEl.style.display = 'none';
    if (channelHeader) channelHeader.style.display = 'none';
    if (dmSection) dmSection.style.display = 'block';
  } else {
    if (channelListEl) channelListEl.style.display = '';
    if (channelHeader) channelHeader.style.display = '';
    if (dmSection) dmSection.style.display = 'none';
  }
}


function subscribeToServerRealtime(serverId) {
  // Clean up previous server's subscriptions
  if (_channelRealtimeSub) { try { _channelRealtimeSub.unsubscribe(); } catch {} _channelRealtimeSub = null; }
  if (_categoryRealtimeSub) { try { _categoryRealtimeSub.unsubscribe(); } catch {} _categoryRealtimeSub = null; }
  if (_customEmojiRealtimeSub) { try { _customEmojiRealtimeSub.unsubscribe(); } catch {} _customEmojiRealtimeSub = null; }

  if (!serverId) return;

  _channelRealtimeSub = supabaseClient
    .channel(`channels-realtime-${serverId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "channels", filter: `server_id=eq.${serverId}` },
      (payload) => {
        const deletedId = payload.eventType === "DELETE" ? payload.old?.id : null;
        reloadChannelsRealtime(deletedId);
      }
    )
    .subscribe();

  _categoryRealtimeSub = supabaseClient
    .channel(`categories-realtime-${serverId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "categories", filter: `server_id=eq.${serverId}` },
      () => reloadChannelsRealtime()
    )
    .subscribe();

  _customEmojiRealtimeSub = supabaseClient
    .channel(`custom-emojis-realtime-${serverId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "custom_emojis", filter: `server_id=eq.${serverId}` },
      () => loadCustomEmojis()
    )
    .subscribe();
}

async function giveCustomRole(targetUser) {
  if (!currentServerId || !targetUser) {
    alert("❌ No server or user selected.");
    return;
  }

  // 1. Fetch existing roles from the database for this server
  const { data: roles, error: rolesError } = await supabaseClient
    .from("server_roles")
    .select("id, name, role, color")
    .eq("server_id", currentServerId)
    .order("name", { ascending: true });

  if (rolesError) {
    console.error("❌ Failed to fetch roles:", rolesError.message);
    alert("❌ Could not load roles. Check console.");
    return;
  }

  // Filter out the default "User" role if you don't want to assign it via this button
  // Or include it if you want to allow demoting to User.
  // Let's assume you want to assign ANY custom role created in Manage Roles.
  const availableRoles = roles.filter(r => r.name && r.name !== "User");

  if (availableRoles.length === 0) {
    alert("❌ No custom roles found in this server. Go to Server Options > Manage Roles to create one first.");
    return;
  }

  // 2. Build a selection list
  const roleList = availableRoles.map((r, i) => `${i + 1}. ${r.name} (${r.role || 'Custom'})`).join("\n");
  
  const choice = prompt(
    `Give a custom role to ${targetUser}:\n\n${roleList}\n\nEnter the number (1, 2, etc.):`
  );

  if (!choice) return;

  const selectedIndex = parseInt(choice) - 1;
  if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= availableRoles.length) {
    alert("❌ Invalid selection.");
    return;
  }

  const selectedRole = availableRoles[selectedIndex];

  // 3. Assign the role
  try {
    // First, ensure the role exists in the server_members link table
    // We update the primary_role_id for the member
    const { error: updateError } = await supabaseClient
      .from("server_members")
      .update({ primary_role_id: selectedRole.id })
      .eq("server_id", currentServerId)
      .eq("username", targetUser);

    if (updateError) throw updateError;

    // Also clear any old role links if necessary (optional, depending on your schema strictness)
    await supabaseClient
      .from("server_member_roles")
      .delete()
      .eq("server_id", currentServerId)
      .eq("member_id", (await supabaseClient.from("server_members").select("id").eq("server_id", currentServerId).eq("username", targetUser).single()).data?.id);
      
    // Re-insert the link for the new role
    const memberData = await supabaseClient.from("server_members").select("id").eq("server_id", currentServerId).eq("username", targetUser).single();
    if (memberData.data) {
      await supabaseClient.from("server_member_roles").insert({
        server_id: currentServerId,
        member_id: memberData.data.id,
        role_id: selectedRole.id
      });
    }

    alert(`✅ Assigned role "${selectedRole.name}" to ${targetUser}.`);
    
    // Refresh UI
    await loadServerMembers();
    await refreshServerRole(); // Refresh current user's view if they are the target

  } catch (error) {
    console.error("❌ Failed to assign role:", error);
    alert("❌ Failed to assign role: " + error.message);
  }
}


function sendTyping(status) {
  if (isTyping === status) return;
  isTyping = status;

  supabaseClient
    .from("typing")
    .upsert({
      username: username,
      typing: status
    });
}

function subscribeToTyping() {
  if (typingSubscription) {
    console.debug("[server] typing subscription already active");
    return;
  }

  if (typeof supabaseClient.getChannels === "function") {
    const existing = supabaseClient.getChannels().find((c) => c?.topic === "realtime:typing-channel");
    if (existing) {
      typingSubscription = existing;
      console.debug("[server] reused existing typing subscription channel");
      return;
    }
  }

  const channelName = `typing-channel-${Math.random().toString(36).slice(2)}`;
  try {
    typingSubscription = supabaseClient
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "typing" },
        () => {
          updateTypingUI();
        }
      )
      .subscribe();
  } catch (err) {
    console.warn("[server] typing subscription setup failed:", err);
  }
}

function subscribeToServerMemberships() {
  if (serverMembershipSubscription) {
    try { serverMembershipSubscription.unsubscribe(); } catch {}
    serverMembershipSubscription = null;
  }

  if (!username) return;

  serverMembershipSubscription = supabaseClient
    .channel(`server-memberships-${username}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "server_members", filter: `username=eq.${username}` },
      async () => {
        console.log("🔄 Server membership changed, reloading server list");
        await loadServers();
      }
    )
    .subscribe();
}

// ======================== SERVER SYSTEM ========================

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// In loadServers(), ensure this logic is present:
async function loadServers() {
  if (!username) return;

  try {
    await loadPersistedServerOrder();
    const isSysAdmin = currentSystemRole === "SysAdmin";
    const isSysManager = currentSystemRole === "SysManager";
    const discordImportButton = document.getElementById("goDiscordImport");
    if (discordImportButton) {
      discordImportButton.style.display = isSysAdmin ? "" : "none";
    }

    if (isSysAdmin) {
      // SysAdmins see EVERY server
      const { data, error } = await supabaseClient
        .from("servers")
        .select("*")
        .order("created_at", { ascending: true });

      if (!error) servers = data || [];
    } else if (isSysManager) {
      // SysManagers see all servers they're members of + all servers
      const { data: allServers, error: allError } = await supabaseClient
        .from("servers")
        .select("*")
        .order("created_at", { ascending: true });

      if (!allError) {
        servers = allServers || [];
      }
    } else {
      // Regular users only see servers they are members of
      const { data, error } = await supabaseClient
        .from("server_members")
        .select(`
          server_id,
          servers (
            id,
            name,
            slug,
            icon_url,
            owner_username
          )
        `)
        .eq("username", username);

      if (!error && Array.isArray(data)) {
        servers = data.map(d => d.servers).filter(Boolean);
      }
    }

    // Ensure sysmanagers and sysadmins are added to all servers
    if (isSysAdmin || isSysManager) {
      await ensureSystemUserInAllServers(isSysAdmin, isSysManager);
    }
  } catch (err) {
    console.error("❌ loadServers error:", err);
  }

  applyStoredServerOrder();
  renderServerList();

  // Handle URL navigation or default server
  const urlParams = new URLSearchParams(window.location.search);
  const serverSlug = urlParams.get("server");
  let target = currentServerId ? servers.find(s => s.id === currentServerId) : null;
  if (!target && serverSlug) target = servers.find(s => s.slug === serverSlug);
  if (!target && servers.length > 0) target = servers[0];

  if (target && currentServerId !== target.id) {
    await switchServer(target.id, false);
  } else if (!target && servers.length === 0 && currentServerId) {
    renderServerList();
    return;
  } else if (!target) {
    showNoServerScreen();
  }

  await refreshUnreadMentionCounts();
}

async function switchServer(serverId, updateUrl = true) {
  console.log("🔀 switchServer called with:", serverId);
  // Set checkpoint for current server before switching
  if (currentServerId && currentServerId !== serverId) {
    setServerCheckpoint(currentServerId);
  }
  markServerMentionsRead(serverId);
  currentConversationType = "channel";
  currentDmConversationId = null;
  currentServerId = serverId;
  if (typeof startDiscordMessageSync === "function") {
    startDiscordMessageSync(serverId);
  }
  // Remove DM icon active state when switching to a server
  const _dmIcon = document.getElementById('dmServerIcon');
  if (_dmIcon) _dmIcon.classList.remove('active');
  await subscribeToCurrentDmConversation(null);
  const server = servers.find(s => s.id === serverId);

  if (server) {
    if (updateUrl) {
      const url = new URL(window.location);
      url.searchParams.set("server", server.slug);
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", url);
    }
    const nameEl = document.getElementById("serverNameDisplay");
    if (nameEl) nameEl.textContent = server.name;
  }

  document.querySelectorAll(".server-icon[data-server-id]").forEach(el => {
    el.classList.toggle("active", el.dataset.serverId === serverId);
  });
  renderDmList();

  const noServerScreen = document.getElementById("noServerScreen");
  if (noServerScreen) noServerScreen.remove();
  const controlsEl = document.getElementById("controls");
  if (controlsEl) controlsEl.classList.add("visible");

  const msgInput = document.getElementById("messageInput");
  if (msgInput) msgInput.disabled = false;
  currentServerSettings = { ...DEFAULT_SERVER_SETTINGS };
  currentServerWordFilters = [];

  console.log("📂 Loading channels and server settings...");
  await Promise.all([
    loadServerSettings(serverId, { force: true }),
    loadChannels(),
    refreshServerRole()
  ]);
  const ensureResult = await ensureGeneralCategoryAndFixOrphans(currentServerId, { createGeneralChannelIfMissing: true });
  if (ensureResult?.changed) {
    await loadChannels();
  }

  await loadCustomEmojis();

  if (channels.length > 0) {
    console.log("📝 Loading default channel...");
    await loadDefaultChannel();
  } else {
    console.log("🆕 No channels after migration, retrying channel load...");
    await loadChannels();
    if (channels.length > 0) await loadDefaultChannel();
  }

  console.log("🌐 Subscribing to server realtime...");
  subscribeToServerRealtime(serverId);
  // Per-server block/mute: load + subscribe to own status in this server.
  await refreshOwnServerMemberStatus();
  subscribeToOwnServerStatus(serverId);
  setMemberListVisibility();

  if (canViewMembers()) {
    console.log("👥 Loading server members...");
    await loadServerMembers();
    console.log("🔔 Subscribing to presence...");
    subscribeToPresence();
  } else {
    stopMemberRealtime();
    serverMembers = [];
    memberPresence = [];
    renderMemberList();
  }

  console.log("✅ switchServer complete!");
  // Ensure sidebar is in channel mode after switching
  try { setSidebarForDmMode(false); } catch (e) {}
}

function renderServerList() {
  const serverList = document.getElementById("serverList");
  if (!serverList) return;
  if (_serverSortableInstance) {
    try { _serverSortableInstance.destroy(); } catch {}
    _serverSortableInstance = null;
  }
  serverList.innerHTML = "";

  // Add a fixed Direct Messages icon at the top (Discord-style)
  const dmIcon = document.createElement("div");
  dmIcon.className = `server-icon dm-icon${currentConversationType === 'dm' ? ' active' : ''}`;
  dmIcon.id = "dmServerIcon";
  dmIcon.title = "Direct Messages";
  dmIcon.setAttribute("draggable", "false");
  dmIcon.style.userSelect = "none";
  dmIcon.style.webkitUserSelect = "none";
  dmIcon.style.webkitTouchCallout = "none";
  dmIcon.addEventListener("selectstart", (event) => event.preventDefault());
  dmIcon.innerHTML = `<span style="font-size:18px;">✉️</span>`;
  dmIcon.onclick = async (e) => {
    e.stopPropagation();
    if (shouldSuppressClick(suppressServerClickUntil)) return;
    // Toggle a DM panel anchored to the server sidebar
    toggleServerDmPanel();
  };
  serverList.appendChild(dmIcon);

  // If DM panel should auto-open when in DM mode, ensure it's visible
  if (currentConversationType === 'dm') setTimeout(() => { dmIcon.classList.add('active'); toggleServerDmPanel(true); }, 0);

  // Then list real servers (sortable)
  servers.forEach(server => {
    const icon = document.createElement("div");
    // Only mark active if we're in channel mode and this server matches
    icon.className = `server-icon ${currentConversationType === 'channel' && server.id === currentServerId ? 'active' : ''}`;
    icon.dataset.serverId = server.id;
    icon.title = server.name;
    icon.setAttribute("draggable", "false");
    icon.style.userSelect = "none";
    icon.style.webkitUserSelect = "none";
    icon.style.webkitTouchCallout = "none";
    icon.addEventListener("selectstart", (event) => event.preventDefault());

    if (server.icon_url) {
      icon.innerHTML = `<img src="${server.icon_url}" alt="${server.name}">`;
    } else {
      icon.textContent = server.name.charAt(0).toUpperCase();
    }

    const mentionCount = getServerMentionCount(server.id);
    if (mentionCount > 0) {
      const badge = document.createElement("span");
      badge.className = "server-mention-badge";
      badge.textContent = mentionCount > 99 ? "99+" : String(mentionCount);
      icon.appendChild(badge);
    }

    icon.onclick = (e) => {
      e.stopPropagation();
      if (shouldSuppressClick(suppressServerClickUntil)) return;
      currentConversationType = 'channel';
      switchServer(server.id);
      if (window.innerWidth <= 768) closeServerSidebar();
    };

    serverList.appendChild(icon);
  });

  if (typeof Sortable !== "undefined") {
    const mobileDrag = isMobileContextMenuMode();
    _serverSortableInstance = Sortable.create(serverList, {
      animation: 150,
      // Only make actual servers sortable; DM icon is not draggable because it lacks data-server-id
      draggable: ".server-icon[data-server-id]",
      delay: mobileDrag ? 450 : 0,
      delayOnTouchOnly: mobileDrag,
      touchStartThreshold: 8,
      fallbackTolerance: 8,
      forceFallback: mobileDrag,
      fallbackOnBody: mobileDrag,
      onEnd: async () => {
        suppressServerClickUntil = Date.now() + 500;
        const orderedIds = Array.from(serverList.querySelectorAll(".server-icon[data-server-id]"))
          .map((node) => node.dataset.serverId)
          .filter(Boolean);
        const orderedServers = orderedIds
          .map((id) => servers.find((server) => server.id === id))
          .filter(Boolean);
        const remainingServers = servers.filter((server) => !orderedIds.includes(server.id));
        servers = [...orderedServers, ...remainingServers];
        await saveServerOrder();
      }
    });
  }
}

// ------------------------ Server DM Panel (now acts like a server) ------------------------
async function toggleServerDmPanel(forceOpen = false) {
  // Behavior: switch the left channel/sidebar into DM mode (non-floating)
  const dmIcon = document.getElementById('dmServerIcon');

  if (currentConversationType === 'dm' && !forceOpen) {
    // If already in DM mode and not forced, switch back to the previous server (if remembered)
    if (previousServerIdBeforeDm) {
      const target = previousServerIdBeforeDm;
      previousServerIdBeforeDm = null;
      await switchServer(target);
      // Restore channel-sidebar visibility
      setSidebarForDmMode(false);
    } else if (servers && servers.length > 0) {
      // Fall back to first available server
      const target = servers[0].id;
      await switchServer(target);
      setSidebarForDmMode(false);
    } else {
      // No servers to return to — just clear DM state
      currentConversationType = 'channel';
      currentDmConversationId = null;
      if (dmIcon) dmIcon.classList.remove('active');
      renderChannelList();
      renderDmList();
      updateConversationHeaderAndInput();
    }
    return;
  }

  // Enter DM "server" view — remember previous server so we can restore it
  previousServerIdBeforeDm = currentServerId || previousServerIdBeforeDm;
  currentConversationType = 'dm';
  currentServerId = null;
  currentChannelId = null;
  if (dmIcon) dmIcon.classList.add('active');
  // Deactivate actual server icons
  document.querySelectorAll('.server-icon[data-server-id]').forEach(el => el.classList.remove('active'));

  try {
  await loadDirectConversations(); // populates directConversations
  // Use helper to set sidebar into DM-only mode
  setSidebarForDmMode(true);

  renderDmList();
  updateConversationHeaderAndInput();
  subscribeToDirectMessages();
  } catch (err) {
  console.error('Failed to open DM server view:', err);
  }
}


function showNoServerScreen() {
  const controlsEl = document.getElementById("controls");
  if (controlsEl) controlsEl.classList.remove("visible");
  const msgInput = document.getElementById("messageInput");
  if (msgInput) msgInput.disabled = true;
  document.getElementById("currentChannelName").textContent = "No Server";
  const messagesEl = document.getElementById("messages");
  if (messagesEl) messagesEl.innerHTML = "";

  const chatApp = document.querySelector(".chat-app");
  if (!chatApp) return;
  let screen = document.getElementById("noServerScreen");
  if (!screen) {
    screen = document.createElement("div");
    screen.id = "noServerScreen";
    chatApp.appendChild(screen);
  }

  let debugInfo = "";
  if (currentSystemRole === "SysAdmin") {
    debugInfo = `<p style="color:#ff6b6b;font-size:12px;margin-top:20px;">
      <strong>⚠️ You're a SysAdmin but no servers loaded!</strong><br/>
      This might be a database permission issue. Try:<br/>
      • Check browser console for errors<br/>
      • Make sure RLS policies are applied<br/>
      • Refresh the page<br/>
      <button onclick="location.reload()" style="margin-top:10px;padding:8px 16px;background:#5865f2;color:white;border:none;cursor:pointer;border-radius:4px;">Refresh Page</button>
    </p>`;
  }

  screen.innerHTML = `
    <h3>You're not in any server</h3>
    <p>Create a new server or join one with an invite link.</p>
    <button onclick="openModal('serverModal')">Add a Server</button>
    <p style="font-size:12px;color:#999;margin-top:20px;">
      User: ${username} | Role: ${currentSystemRole}
    </p>
    ${debugInfo}
  `;
}

async function loadServerMembers() {
  if (
    !_serverMembersLoadPromise &&
    _lastServerMembersLoadServerId === currentServerId &&
    Date.now() - _lastServerMembersLoadAt < 750
  ) {
    return;
  }
  if (_serverMembersLoadPromise) return _serverMembersLoadPromise;
  _lastServerMembersLoadServerId = currentServerId;
  _lastServerMembersLoadAt = Date.now();
  _serverMembersLoadPromise = loadServerMembersInternal();
  try {
    return await _serverMembersLoadPromise;
  } finally {
    _serverMembersLoadPromise = null;
  }
}

async function loadServerMembersInternal() {
  console.log("🔍 loadServerMembers called, currentServerId:", currentServerId);
  console.log("   Current username:", username);

  if (!canViewMembers()) {
    serverMembers = [];
    memberPresence = [];
    setMemberListVisibility();
    return;
  }

  if (!currentServerId) {
    console.warn("❌ No currentServerId, aborting loadServerMembers");
    return;
  }

  const content = document.getElementById("memberListContent");
  if (content) content.innerHTML = "<div style='padding:10px;color:#999;font-size:12px;'>Loading members...</div>";

  try {
    // Always fetch fresh member data (paged so we don't hit row caps)
    console.log("📡 Fetching server_members for server:", currentServerId);
    const members = [];
    let membersError = null;
    const PAGE_SIZE = 1000;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: page, error: pageError } = await supabaseClient
        .from("server_members")
        .select("id, server_id, username, joined_at, sort_order, primary_role_id, profile_display_name, profile_avatar_url")
        .eq("server_id", currentServerId)
        .order("sort_order", { ascending: true })
        .order("username", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (pageError) {
        membersError = pageError;
        break;
      }
      if (!page || page.length === 0) break;
      members.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    // Fallback path if pagination returns nothing unexpectedly.
    if (!membersError && members.length === 0) {
      const { data: fallbackMembers, error: fallbackError } = await supabaseClient
        .from("server_members")
        .select("id, server_id, username, joined_at, sort_order, primary_role_id, profile_display_name, profile_avatar_url")
        .eq("server_id", currentServerId);
      if (fallbackError) {
        membersError = fallbackError;
      } else if (fallbackMembers?.length) {
        members.push(...fallbackMembers);
      }
    }
    const error = membersError;

    if (error) { 
      console.error("❌ loadServerMembers error:", error);
      console.error("   Error code:", error.code);
      console.error("   Error hint:", error.hint);
      console.error("   Error details:", error.details);
      if (content) {
        content.innerHTML = `<div style='padding:10px;color:#ff6b6b;font-size:11px;word-break:break-word;font-family:monospace;'>
          <strong>Error loading members:</strong><br/>
          Code: ${error.code}<br/>
          Message: ${error.message}<br/>
          ${error.hint ? `Hint: ${error.hint}<br/>` : ''}
          Server ID: ${currentServerId.substring(0, 8)}...<br/>
          Username: ${username}
        </div>`;
      }
      return; 
    }

    const { data: linkedDiscordAccount } = await supabaseClient
      .from("discord_accounts")
      .select("discord_user_id")
      .eq("username", username)
      .maybeSingle();
    const { data: mappedDiscordMember } = linkedDiscordAccount
      ? await supabaseClient
        .from("discord_servers")
        .select("id")
        .eq("server_id", currentServerId)
        .maybeSingle()
      : { data: null };
    const { data: linkedDiscordMember } = mappedDiscordMember && linkedDiscordAccount
      ? await supabaseClient
        .from("discord_members")
        .select("member_id")
        .eq("discord_server_id", mappedDiscordMember.id)
        .eq("discord_user_id", linkedDiscordAccount.discord_user_id)
        .maybeSingle()
      : { data: null };
    if (linkedDiscordMember?.member_id) {
      const linkedMember = members.find((member) => member.id === linkedDiscordMember.member_id);
      if (linkedMember && linkedMember.username !== username) {
        const duplicateIndex = members.findIndex((member) => member.username === username);
        if (duplicateIndex >= 0) {
          members.splice(members.indexOf(linkedMember), 1);
        } else {
          linkedMember.username = username;
        }
      }
    }

    const memberIds = (members || []).map(m => m.id).filter(Boolean);
    const [{ data: roleLinks, error: roleLinksError }, { data: roles, error: rolesError }] = await Promise.all([
      memberIds.length
        ? supabaseClient
            .from("server_member_roles")
            .select("member_id, role_id")
            .eq("server_id", currentServerId)
            .in("member_id", memberIds)
        : Promise.resolve({ data: [] }),
      supabaseClient
        .from("server_roles")
        .select("id, role, name, color")
        .eq("server_id", currentServerId)
    ]);
    if (roleLinksError) console.warn("⚠️ role link fetch failed, falling back to server_members.role:", roleLinksError.message);
    if (rolesError) console.warn("⚠️ role fetch failed, falling back to server_members.role:", rolesError.message);

    const roleNameById = new Map((roles || []).map(r => [r.id, normalizeServerRole(r.name || r.role || "User")]));
    const roleColorById = new Map((roles || []).map(r => [r.id, r.color || "#5865f2"]));
    const linkedRoleByMember = new Map();
    (roleLinks || []).forEach(link => {
      if (!linkedRoleByMember.has(link.member_id)) linkedRoleByMember.set(link.member_id, link.role_id);
    });

    serverMembers = (members || []).map(m => {
      const linkedRoleId = linkedRoleByMember.get(m.id);
      const effectiveRoleId = linkedRoleId || m.primary_role_id || null;
      const effectiveRoleName = effectiveRoleId ? (roleNameById.get(effectiveRoleId) || m.role || "User") : (m.role || "User");
      setServerProfileData(currentServerId, m.username, {
        display_name: m.profile_display_name || "",
        avatar_url: m.profile_avatar_url || "",
        role: effectiveRoleName,
        role_color: effectiveRoleId ? roleColorById.get(effectiveRoleId) : ""
      });
      return {
        ...m,
        role: effectiveRoleName,
        role_color: effectiveRoleId ? roleColorById.get(effectiveRoleId) : null
      };
    });
    const { data: discordServer } = await supabaseClient
      .from("discord_servers")
      .select("id")
      .eq("server_id", currentServerId)
      .maybeSingle();
    if (discordServer) {
      const { data: linkedAccount } = await supabaseClient
        .from("discord_accounts")
        .select("discord_user_id")
        .eq("username", username)
        .maybeSingle();
      const { data: linkedMember } = linkedAccount?.discord_user_id
        ? await supabaseClient
          .from("discord_members")
          .select("member_id")
          .eq("discord_server_id", discordServer.id)
          .eq("discord_user_id", linkedAccount.discord_user_id)
          .maybeSingle()
        : { data: null };
      const { data: discordProfile } = linkedMember?.member_id
        ? await supabaseClient
          .from("server_members")
          .select("profile_display_name, profile_avatar_url")
          .eq("id", linkedMember.member_id)
          .maybeSingle()
        : { data: null };
      if (discordProfile) {
        const existing = getServerProfileData(currentServerId, username) || {};
        setServerProfileData(currentServerId, username, {
          ...existing,
          display_name: discordProfile.profile_display_name || existing.display_name || username,
          avatar_url: discordProfile.profile_avatar_url || existing.avatar_url || ""
        });
      }
    }
    await loadAvatarMapForUsernames(serverMembers.map(member => getDisplayName(member)));
    console.log("✅ Loaded", serverMembers.length, "server members", serverMembers);

    await loadMemberPresence();
    renderMemberList();
  } catch (err) {
    console.error("❌ Unexpected error in loadServerMembers:", err);
    if (content) {
      content.innerHTML = `<div style='padding:10px;color:#ff6b6b;font-size:11px;'>
        Unexpected error: ${err.message}
      </div>`;
    }
  }
}

async function loadMemberPresence() {
  if (!currentServerId) return;

  console.log("📡 Fetching channel_presence for server:", currentServerId);
  const { data: presence, error: presenceError } = await supabaseClient
    .from("channel_presence")
    .select("*")
    .eq("server_id", currentServerId);

  if (presenceError) {
    console.error("❌ Presence fetch error:", presenceError);
    return;
  }

  memberPresence = presence || [];
  console.log("👥 Got", memberPresence.length, "presence records:", memberPresence);
}

function renderMemberList() {
  const content = document.getElementById("memberListContent");
  if (!content) return;

  if (!canViewMembers()) {
    content.innerHTML = "";
    return;
  }

  if (!serverMembers || serverMembers.length === 0) {
    content.innerHTML = `<div style='padding: 10px; color: #999; font-size: 12px;'>No members found.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  const normalizedPresence = (memberPresence || []).filter(Boolean);
  const presenceMap = new Map(normalizedPresence.map(p => [String(p.username || "").toLowerCase(), p]));
  const memberSearch = normalizeSearchValue(memberSearchTerm);
  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000;

  const online = [];
  const offline = [];

  serverMembers.forEach(m => {
    const p = presenceMap.get(String(m.username || "").toLowerCase());
    const ch = p ? channels.find(c => c.id === p.channel_id) : null;
    const searchable = normalizeSearchValue(`${m.username || ""} ${displayName(m.username) || ""} ${m.role || ""} ${ch?.name || ""}`);
    if (memberSearch && !searchable.includes(memberSearch)) return;
    const isOnline = p && (now - new Date(p.updated_at).getTime() < ONLINE_THRESHOLD);
    if (isOnline) online.push({ ...m, presence: p, activeChannel: ch });
    else offline.push({ ...m, presence: null, activeChannel: null });
  });

  const renderGroup = (label, members) => {
    if (members.length === 0) return;

    const groupLabel = document.createElement("div");
    groupLabel.className = "member-group-label";
    groupLabel.textContent = `${label} — ${members.length}`;
    fragment.appendChild(groupLabel);

    members.forEach(m => {
      const item = document.createElement("div");
      item.className = "member-item";
      const ch = m.activeChannel || null;
      const roleStr = String(m.role || "User").toLowerCase();
      const isSpecialRole = ["manager", "admin", "sysmanager", "sysadmin"].includes(roleStr);
      const avatarHtml = buildAvatarElement(m.username, "member-avatar").outerHTML;

      item.innerHTML = `
        ${avatarHtml}
        <div class="member-info">
          <div class="member-name" ${m.role_color ? `style="color:${escapeHTML(m.role_color)};"` : ""}>${escapeHTML(displayName(m.username))}</div>
          ${ch ? `<div class="member-channel">${ch.channel_type === "voice" ? "🎤" : "#"} ${escapeHTML(ch.name)}</div>` : ""}
        </div>
        ${isSpecialRole ? `<span class="member-role-badge ${roleStr}" ${m.role_color ? `style="background:${escapeHTML(m.role_color)};"` : ""}>${escapeHTML(m.role)}</span>` : ""}
      `;
      const statusDot = document.createElement("span");
      statusDot.className = `status-dot ${label === "Online" ? "online" : ""}`;
      const avatarNode = item.querySelector(".member-avatar");
      if (avatarNode) avatarNode.appendChild(statusDot);

      if (m.username && m.username !== username) {
        item.addEventListener("click", async () => {
          try {
            const conversationId = await ensureDirectConversation(m.username);
            await loadDirectConversations();
            await openDirectConversation(conversationId);
          } catch (dmError) {
            console.error("❌ Failed to open DM from member list:", dmError);
            alert(`❌ Could not open DM: ${dmError.message}`);
          }
        });
      }

      if (m.username === username || currentSystemRole === "SysAdmin" || userPermissions.manage_roles) {
        item.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const memberMenu = document.getElementById("memberMenu");
          if (!memberMenu) return;
          const menuItems = [];
          if (m.username === username) {
            menuItems.push({
              label: "Edit Server Profile",
              color: "white",
              action: async () => {
                await editMyServerProfile();
              }
            });
          } else {
            menuItems.push({
              label: "Message",
              color: "white",
              action: async () => {
                const conversationId = await ensureDirectConversation(m.username);
                await loadDirectConversations();
                await openDirectConversation(conversationId);
              }
            });
          }

          if (currentSystemRole === "SysAdmin" || userPermissions.manage_roles) {
            menuItems.push(
              {
                label: "User Info",
                color: "white",
                action: async () => {
                  await userInfo(m.username);
                }
              },
              {
                label: "Change Name",
                color: "white",
                action: async () => {
                  await changeName(m.username);
                }
              },
              {
                label: "Promote / Demote",
                color: "white",
                action: async () => {
                  await promote(m.username);
                }
              },
              {
                label: "Give Custom Role",
                color: "white",
                action: async () => {
                  await giveCustomRole(m.username);
                }
              },
              {
                label: "Change Server Role",
                color: "white",
                action: async () => {
                  const nextRole = prompt(`Set role for ${m.username}:`, normalizeServerRole(m.role || "User"));
                  if (!nextRole) return;
                  await setMemberServerRole(m, nextRole);
                }
              },
              {
                label: "Mute User",
                color: "white",
                action: async () => {
                  await muteUser(m.username);
                }
              },
              {
                label: "Block User",
                color: "#ed4245",
                action: async () => {
                  await blockUser(m.username);
                }
              },
              {
                label: "Unblock User",
                color: "white",
                action: async () => {
                  await unblockUser(m.username);
                }
              },
              {
                label: "Force Logout",
                color: "#ed4245",
                action: async () => {
                  await forceLogout(m.username);
                }
              },
              {
                label: "Add To Another Server",
                color: "white",
                action: async () => {
                  await addMemberToAnotherServer(m);
                }
              },
              {
                label: "Kick From This Server",
                color: "#ed4245",
                action: async () => {
                  await kickMemberFromCurrentServer(m);
                }
              },
              {
                label: "Delete User + Messages",
                color: "#ed4245",
                action: async () => {
                  await deleteUser(m.username);
                }
              }
            );
          }

          showContextMenu(memberMenu, e.clientX, e.clientY, menuItems);
        };
      }
      fragment.appendChild(item);
      // Inside renderMemberList, inside the forEach loop:
item.addEventListener("click", async () => {
  if (m.username === username) {
    // Clicking own name opens profile
    openUserProfile(m.username, currentServerId);
  } else {
    // Clicking others opens DM (existing logic)
    try {
      const conversationId = await ensureDirectConversation(m.username);
      await loadDirectConversations();
      await openDirectConversation(conversationId);
    } catch (dmError) {
      console.error("❌ Failed to open DM:", dmError);
    }
  }
});
    });
  };

  // Sort alphabetically so the full member list is predictable.
  online.sort((a, b) => String(a.username || "").localeCompare(String(b.username || ""), undefined, { sensitivity: "base" }));
  offline.sort((a, b) => String(a.username || "").localeCompare(String(b.username || ""), undefined, { sensitivity: "base" }));

  if (online.length === 0 && offline.length === 0) {
    content.innerHTML = `<div style='padding: 10px; color: #999; font-size: 12px;'>No members match your search.</div>`;
    return;
  }

  const total = document.createElement("div");
  total.className = "member-group-label";
  total.textContent = `Total — ${online.length + offline.length}`;
  fragment.appendChild(total);

  renderGroup("Online", online);
  renderGroup("Offline", offline);

  content.innerHTML = "";
  content.appendChild(fragment);
}

async function updateChannelPresence(channelId) {
  if (!username || !currentServerId) return;
  await supabaseClient.from("channel_presence").upsert({
    username,
    channel_id: channelId,
    server_id: currentServerId,
    updated_at: new Date().toISOString()
  }, { onConflict: "username,server_id" });
}

function subscribeToPresence() {
  console.log("🔔 subscribeToPresence called, currentServerId:", currentServerId);

  if (memberRealtimeSubscription && _memberRealtimeServerId === currentServerId) {
    console.log("🔔 Member realtime already active for:", currentServerId);
    return;
  }
  const expectedTopic = `realtime:members-realtime-${currentServerId}`;
  const existingChannel = typeof supabaseClient.getChannels === "function"
    ? supabaseClient.getChannels().find((channel) => channel.topic === expectedTopic)
    : null;
  if (existingChannel) {
    memberRealtimeSubscription = existingChannel;
    console.log("🔔 Reusing member realtime subscription for:", currentServerId);
    return;
  }
  stopMemberRealtime();

  if (!currentServerId) {
    console.warn("❌ No currentServerId for subscribeToPresence");
    return;
  }

  if (!canViewMembers()) {
    console.log("🔒 Member realtime skipped: insufficient permissions");
    return;
  }

  console.log("📡 Setting up member realtime for server:", currentServerId);
  memberRealtimeSubscription = supabaseClient
    .channel(`members-realtime-${currentServerId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "channel_presence",
      filter: `server_id=eq.${currentServerId}`
    }, async () => {
      console.log("🔄 Presence changed, refreshing member presence");
      await loadMemberPresence();
      renderMemberList();
    })
    .subscribe();
  _memberRealtimeServerId = currentServerId;

  console.log("✅ Member realtime subscription set up!");
}

async function generateInvite() {
  if (!currentServerId) { alert("❌ No server selected."); return; }
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();
  const { error } = await supabaseClient.from("server_invites").insert({
    server_id: currentServerId,
    code,
    created_by: username
  });
  if (error) { alert("❌ Failed to create invite: " + error.message); return; }
  const base = window.location.origin + window.location.pathname;
  const link = `${base}?invite=${code}`;
  const linkInput = document.getElementById("inviteLinkText");
  if (linkInput) linkInput.value = link;
  openModal("inviteModal");
}

async function joinServer(codeOrUrl) {
  let code = codeOrUrl.trim();
  try {
    const u = new URL(code);
    const c = u.searchParams.get("invite");
    if (c) code = c;
  } catch {}

  const { data: invite, error } = await supabaseClient
    .from("server_invites")
    .select("*, servers(*)")
    .eq("code", code)
    .maybeSingle();

  if (error || !invite) return "❌ Invalid invite code.";
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return "❌ This invite has expired.";
  if (invite.max_uses && invite.use_count >= invite.max_uses) return "❌ This invite has reached its maximum uses.";

  const { data: existing } = await supabaseClient
    .from("server_members")
    .select("username")
    .eq("server_id", invite.server_id)
    .eq("username", username)
    .maybeSingle();

  if (!existing) {
    const { error: joinErr } = await supabaseClient.from("server_members").insert({
      server_id: invite.server_id,
      username,
      primary_role_id: null
    });
    if (joinErr) return "❌ Failed to join: " + joinErr.message;
    await supabaseClient.from("server_invites")
      .update({ use_count: invite.use_count + 1 })
      .eq("id", invite.id);
  }

  if (!servers.find(s => s.id === invite.server_id)) {
    servers.push(invite.servers);
    renderServerList();
  }
  await switchServer(invite.server_id);
  return null;
}

async function checkInviteOnLoad() {
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = urlParams.get("invite");
  if (!inviteCode || !username) return;

  const { data: invite } = await supabaseClient
    .from("server_invites")
    .select("*, servers(*)")
    .eq("code", inviteCode)
    .maybeSingle();

  if (!invite || !invite.servers) return;

  const titleEl = document.getElementById("acceptInviteTitle");
  const descEl = document.getElementById("acceptInviteDesc");
  if (titleEl) titleEl.textContent = `You've been invited to join ${invite.servers.name}!`;
  if (descEl) descEl.textContent = "Click Accept to join the server.";

  const confirmBtn = document.getElementById("confirmAcceptInvite");
  const declineBtn = document.getElementById("declineAcceptInvite");
  const closeBtn = document.getElementById("closeAcceptInviteModal");

  if (confirmBtn) confirmBtn.onclick = async () => {
    closeModal("acceptInviteModal");
    const err = await joinServer(inviteCode);
    if (err) alert(err);
  };
  if (declineBtn) declineBtn.onclick = () => {
    closeModal("acceptInviteModal");
    const url = new URL(window.location);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url);
  };
  if (closeBtn) closeBtn.onclick = () => closeModal("acceptInviteModal");

  openModal("acceptInviteModal");
}

// Replace your existing createServer function with this:
async function createServer(name, slug) {
  if (!username) return "❌ You must be signed in to create a server.";

  const iconInput = document.getElementById("newServerIcon");
  const trimName = name.trim();
  const trimSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!trimName || !trimSlug) return "❌ Please fill in all fields.";

  const { data: existing } = await supabaseClient
    .from("servers")
    .select("id")
    .eq("slug", trimSlug)
    .maybeSingle();

  if (existing) return "❌ That URL is already taken. Try another.";

  let iconUrl = null;
  const iconFile = iconInput?.files?.[0] || null;
  if (iconFile) {
    if (!String(iconFile.type || "").startsWith("image/")) {
      return "❌ Server icon must be an image.";
    }
    if (iconFile.size > 5 * 1024 * 1024) {
      return "❌ Server icon must be under 5MB.";
    }

    const iconName = `server-icons/${Date.now()}_${iconFile.name.replace(/\s+/g, "_")}`;
    const { error: uploadError } = await supabaseClient.storage
      .from("chat-files")
      .upload(iconName, iconFile);
    if (uploadError) return "❌ Failed to upload server icon: " + uploadError.message;

    const { data: iconData } = supabaseClient.storage
      .from("chat-files")
      .getPublicUrl(iconName);
    iconUrl = iconData?.publicUrl || null;
  }

  const { data: newServer, error } = await supabaseClient
    .from("servers")
    .insert({ name: trimName, slug: trimSlug, owner_username: username, icon_url: iconUrl })
    .select()
    .maybeSingle();

  if (error) return "❌ Failed to create server: " + error.message;

  // The creator becomes the initial server owner/member.
  const { data: existingMember } = await supabaseClient
    .from("server_members")
    .select("id")
    .eq("server_id", newServer.id)
    .eq("username", username)
    .maybeSingle();

  if (existingMember?.id) {
    await supabaseClient
      .from("server_members")
      .update({ primary_role_id: null })
      .eq("id", existingMember.id);
  } else {
    await supabaseClient.from("server_members").insert({
      server_id: newServer.id,
      username,
      primary_role_id: null
    });
  }

  // Ensure structure exists for new servers
  await ensureGeneralCategoryAndFixOrphans(newServer.id, { createGeneralChannelIfMissing: true });

  servers.push(newServer);
  renderServerList();
  await switchServer(newServer.id);
  return null;
}

function initServerModals() {
  // In initServerModals(), modify the addServerBtn listener:
const addBtn = document.getElementById("addServerBtn");
if (addBtn) {
  addBtn.style.display = username ? "flex" : "none";

  addBtn.addEventListener("click", () => {
    if (!username) {
      alert("❌ You must be signed in to create a server.");
      return;
    }
    openModal("serverModal");
  });
}

  const goCreate = document.getElementById("goCreateServer");
  if (goCreate) goCreate.addEventListener("click", () => {
    closeModal("serverModal");
    openModal("createServerModal");
  });

  const newServerIconInput = document.getElementById("newServerIcon");
  const newServerIconPreview = document.getElementById("newServerIconPreview");
  if (newServerIconInput && newServerIconPreview) {
    newServerIconInput.addEventListener("change", () => {
      const file = newServerIconInput.files?.[0];
      if (!file) {
        newServerIconPreview.textContent = "No image selected";
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      newServerIconPreview.innerHTML = `<img src="${previewUrl}" alt="Server icon preview">`;
    });
  }

  const goJoin = document.getElementById("goJoinServer");
  if (goJoin) goJoin.addEventListener("click", () => {
    closeModal("serverModal");
    openModal("joinServerModal");
  });

  const goDiscordImport = document.getElementById("goDiscordImport");
  if (goDiscordImport) {
    goDiscordImport.style.display = currentSystemRole === "SysAdmin" ? "" : "none";
  }
  if (goDiscordImport) goDiscordImport.addEventListener("click", async () => {
    if (currentSystemRole !== "SysAdmin") {
      alert("❌ Only SysAdmins can import Discord servers.");
      return;
    }
    closeModal("serverModal");
    if (typeof openModal === "function") {
      openModal("importDiscordModal");
    }
    if (typeof loadDiscordImportGuilds === "function") {
      await loadDiscordImportGuilds();
    }
  });

  const cancelImportDiscord = document.getElementById("cancelImportDiscordModal");
  if (cancelImportDiscord) cancelImportDiscord.addEventListener("click", () => {
    closeModal("importDiscordModal");
    openModal("serverModal");
  });

  const closeImportDiscord = document.getElementById("closeImportDiscordModal");
  if (closeImportDiscord) closeImportDiscord.addEventListener("click", () => closeModal("importDiscordModal"));

  const closeServer = document.getElementById("closeServerModal");
  if (closeServer) closeServer.addEventListener("click", () => closeModal("serverModal"));

  const confirmCreate = document.getElementById("confirmCreateServer");
  if (confirmCreate) confirmCreate.addEventListener("click", async () => {
    const name = document.getElementById("newServerName")?.value || "";
    const slug = document.getElementById("newServerSlug")?.value || "";
    const errEl = document.getElementById("createServerError");
    if (errEl) errEl.style.display = "none";
    const err = await createServer(name, slug);
    if (err) {
      if (errEl) { errEl.textContent = err; errEl.style.display = "block"; }
      return;
    }
    if (document.getElementById("newServerName")) document.getElementById("newServerName").value = "";
    if (document.getElementById("newServerSlug")) document.getElementById("newServerSlug").value = "";
    if (document.getElementById("newServerIcon")) document.getElementById("newServerIcon").value = "";
    if (document.getElementById("newServerIconPreview")) document.getElementById("newServerIconPreview").textContent = "No image selected";
    closeModal("createServerModal");
  });

  const cancelCreate = document.getElementById("cancelCreateServer");
  if (cancelCreate) cancelCreate.addEventListener("click", () => {
    closeModal("createServerModal");
    openModal("serverModal");
  });
  const closeCreate = document.getElementById("closeCreateServerModal");
  if (closeCreate) closeCreate.addEventListener("click", () => closeModal("createServerModal"));

  const confirmJoin = document.getElementById("confirmJoinServer");
  if (confirmJoin) confirmJoin.addEventListener("click", async () => {
    const code = document.getElementById("inviteCodeInput")?.value || "";
    const errEl = document.getElementById("joinServerError");
    if (errEl) errEl.style.display = "none";
    const err = await joinServer(code);
    if (err) {
      if (errEl) { errEl.textContent = err; errEl.style.display = "block"; }
      return;
    }
    if (document.getElementById("inviteCodeInput")) document.getElementById("inviteCodeInput").value = "";
    closeModal("joinServerModal");
  });

  const cancelJoin = document.getElementById("cancelJoinServer");
  if (cancelJoin) cancelJoin.addEventListener("click", () => {
    closeModal("joinServerModal");
    openModal("serverModal");
  });
  const closeJoin = document.getElementById("closeJoinServerModal");
  if (closeJoin) closeJoin.addEventListener("click", () => closeModal("joinServerModal"));

  const copyBtn = document.getElementById("copyInviteBtn");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    const linkInput = document.getElementById("inviteLinkText");
    if (!linkInput) return;
    navigator.clipboard.writeText(linkInput.value).catch(() => {
      linkInput.select();
      document.execCommand("copy");
    });
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
  });

  const closeInvite = document.getElementById("closeInviteModal");
  if (closeInvite) closeInvite.addEventListener("click", () => closeModal("inviteModal"));
  const closeInviteX = document.getElementById("closeInviteModalX");
  if (closeInviteX) closeInviteX.addEventListener("click", () => closeModal("inviteModal"));

  const mlToggle = document.getElementById("memberListToggle");
  if (mlToggle) {
    mlToggle.addEventListener("click", () => {
      if (!canViewMembers()) return;
      const ml = document.getElementById("memberList");
      if (!ml) return;
      if (window.innerWidth <= 768) {
        ml.classList.toggle("open");
      } else {
        ml.style.display = (ml.style.display === "none" || ml.style.display === "") ? "flex" : "none";
      }
    });
  }

  document.addEventListener("click", (e) => {
    const ml = document.getElementById("memberList");
    if (!ml || !ml.classList.contains("open")) return;
    if (!ml.contains(e.target) && e.target.id !== "memberListToggle") {
      ml.classList.remove("open");
    }
  });

  // Inside initServerModals()
const closeManageInvites = document.getElementById("closeManageInvitesModal");
if (closeManageInvites) closeManageInvites.addEventListener("click", () => closeModal("manageInvitesModal"));
const closeManageInvitesX = document.getElementById("closeManageInvitesModalX");
if (closeManageInvitesX) closeManageInvitesX.addEventListener("click", () => closeModal("manageInvitesModal"));

  setMemberListVisibility();
}

// ======================== SERVER ROLE HELPERS ========================

async function refreshServerRole() {
  if (!currentServerId || !username) return;

  if (currentSystemRole === "SysAdmin") {
    // Ensure sysadmin is a member and admin in every server
    await ensureSysAdminInServer(currentServerId);
    currentRole = "Admin";
    loadUserPermissions("admin");
  } else if (currentSystemRole === "SysManager") {
    // Ensure sysmanager is a member in every server
    await ensureSysManagerInServer(currentServerId);
    currentRole = "Manager";
    loadUserPermissions("manager");
  } else {
    const { data: memberData } = await supabaseClient
      .from("server_members")
      .select("id, role, primary_role_id, profile_display_name, profile_avatar_url")
      .eq("server_id", currentServerId)
      .eq("username", username)
      .maybeSingle();
    let resolvedRole = normalizeServerRole(memberData?.role || "User");
    let customRolePerms = null;
    if (memberData?.primary_role_id) {
      const { data: primaryRole } = await supabaseClient
        .from("server_roles")
        .select("name, role, permissions")
        .eq("id", memberData.primary_role_id)
        .maybeSingle();
      resolvedRole = normalizeServerRole(primaryRole?.name || primaryRole?.role || resolvedRole);
      customRolePerms = primaryRole?.permissions || null;
    } else if (memberData?.id) {
      const { data: memberRoleLink } = await supabaseClient
        .from("server_member_roles")
        .select("role_id")
        .eq("server_id", currentServerId)
        .eq("member_id", memberData.id)
        .maybeSingle();
      if (memberRoleLink?.role_id) {
        const { data: linkedRole } = await supabaseClient
          .from("server_roles")
          .select("name, role, permissions")
          .eq("id", memberRoleLink.role_id)
          .maybeSingle();
        resolvedRole = normalizeServerRole(linkedRole?.name || linkedRole?.role || resolvedRole);
        customRolePerms = linkedRole?.permissions || null;
      }
    }
    setServerProfileData(currentServerId, username, {
      display_name: memberData?.profile_display_name || "",
      avatar_url: memberData?.profile_avatar_url || "",
      role: resolvedRole
    });
    currentRole = resolvedRole;
    loadUserPermissions(resolvedRole, customRolePerms);
  }

  localStorage.setItem("chatRole", currentRole);
  console.log(`✅ Server role: ${currentRole} | System: ${currentSystemRole}`);
  updateRoleUI();
}

function updateRoleUI() {
  const createChannelBtn = document.getElementById("createChannelBtn");
  const createCategoryBtnEl = document.getElementById("createCategoryBtn");
  if (createChannelBtn) createChannelBtn.style.display = userPermissions.manage_roles ? "inline-block" : "none";
  if (createCategoryBtnEl) createCategoryBtnEl.style.display = userPermissions.manage_roles ? "inline-block" : "none";
  setMemberListVisibility();
}

// Ensure sysadmin is added as admin to a server
async function ensureSysAdminInServer(serverId) {
  if (!serverId || !username) return;

  try {
    // Check if already a member
    const { data: existingMember } = await supabaseClient
      .from("server_members")
      .select("id, role")
      .eq("server_id", serverId)
      .eq("username", username)
      .maybeSingle();

    if (existingMember) {
      // Update role to Admin if not already
      if (existingMember.role !== "Admin") {
        const { error: updateError } = await supabaseClient
          .from("server_members")
          .update({})
          .eq("id", existingMember.id);

        if (updateError) throw updateError;
        console.log(`Updated sysadmin role to Admin in server ${serverId}`);
      }
    } else {
      // Add as new member with Admin role
      const { error: insertError } = await supabaseClient
        .from("server_members")
        .insert({
          server_id: serverId,
          username: username,
          role: "Admin",
          joined_at: new Date().toISOString()
        });

      if (insertError) throw insertError;
      console.log(`Added sysadmin as Admin to server ${serverId}`);
    }
  } catch (error) {
    console.error("Failed to ensure sysadmin in server:", error);
  }
}

// Ensure sysmanager is added as member to a server
async function ensureSysManagerInServer(serverId) {
  if (!serverId || !username) return;

  try {
    // Check if already a member
    const { data: existingMember } = await supabaseClient
      .from("server_members")
      .select("id")
      .eq("server_id", serverId)
      .eq("username", username)
      .maybeSingle();

    if (!existingMember) {
      // Add as new member with User role (sysmanagers get access via system role)
      const { error: insertError } = await supabaseClient
        .from("server_members")
        .insert({
          server_id: serverId,
          username: username,
          role: "User",
          joined_at: new Date().toISOString()
        });

      if (insertError) throw insertError;
      console.log(`Added sysmanager as member to server ${serverId}`);
    }
  } catch (error) {
    console.error("Failed to ensure sysmanager in server:", error);
  }
}

// Ensure system user is added to all servers
async function ensureSystemUserInAllServers(isSysAdmin, isSysManager) {
  if (!username || (!isSysAdmin && !isSysManager)) return;

  try {
    // Get all servers
    const { data: allServers, error: serversError } = await supabaseClient
      .from("servers")
      .select("id, name");

    if (serversError) throw serversError;
    if (!allServers || allServers.length === 0) return;

    console.log(`Ensuring system user access to ${allServers.length} servers...`);

    // Process servers in batches to avoid overwhelming the database
    const batchSize = 10;
    for (let i = 0; i < allServers.length; i += batchSize) {
      const batch = allServers.slice(i, i + batchSize);

      await Promise.all(batch.map(async (server) => {
        if (isSysAdmin) {
          await ensureSysAdminInServer(server.id);
        } else if (isSysManager) {
          await ensureSysManagerInServer(server.id);
        }
      }));

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < allServers.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`System user access ensured for all servers`);
  } catch (error) {
    console.error("Failed to ensure system user in all servers:", error);
  }
}

// ======================== GIF / IMAGE URL RESOLVER ========================

function resolveGifUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // Already a direct gif/image
    if (/\.(gif|png|jpe?g|webp)(\?.*)?$/i.test(u.pathname)) {
      return url;
    }

    // giphy.com/gifs/slug-HASH  →  media.giphy.com/media/HASH/giphy.gif
    if (host === "giphy.com" || host === "www.giphy.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      // /gifs/some-slug-HASH or /embed/HASH
      const gifSegment = parts.find(p => p !== "gifs" && p !== "embed" && p !== "media");
      if (gifSegment) {
        const hash = gifSegment.includes("-")
          ? gifSegment.split("-").pop()
          : gifSegment;
        if (hash) return `https://media.giphy.com/media/${hash}/giphy.gif`;
      }
    }

    // media.giphy.com/media/HASH/... - already direct
    if (host === "media.giphy.com" || host === "media0.giphy.com" ||
        host === "media1.giphy.com" || host === "media2.giphy.com" ||
        host === "media3.giphy.com" || host === "media4.giphy.com") {
      return url;
    }

    // tenor direct GIF CDN
    if (host === "c.tenor.com" || host === "media.tenor.com") {
      return url;
    }

    return null;
  } catch {
    return null;
  }
}

// Page URLs that probably point to a single GIF (need async resolution
// because the page itself isn't an image).
function isLikelyGifPageUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if ((host === "tenor.com" || host === "www.tenor.com")
        && u.pathname.startsWith("/view/")) return true;
    if ((host === "giphy.com" || host === "www.giphy.com")
        && (u.pathname.startsWith("/gifs/") || u.pathname.startsWith("/embed/"))) return true;
    return false;
  } catch {
    return false;
  }
}

// In-memory cache for resolved tenor/giphy page → media URLs so we don't
// re-fetch during the same session.
const _gifPageResolveCache = new Map();

async function resolveGifPageUrlAsync(pageUrl) {
  if (_gifPageResolveCache.has(pageUrl)) {
    return _gifPageResolveCache.get(pageUrl);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(
      `https://api.microlink.io?url=${encodeURIComponent(pageUrl)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    const json = await res.json();
    const candidate = json?.data?.image?.url
      || json?.data?.video?.url
      || null;

    if (!candidate) {
      _gifPageResolveCache.set(pageUrl, null);
      return null;
    }

    // Only treat as a gif/image we can embed if the URL looks like media.
    let pathname = "";
    try { pathname = new URL(candidate).pathname; } catch { pathname = ""; }
    if (/\.(gif|webp|png|jpe?g|mp4)(\?.*)?$/i.test(pathname)) {
      _gifPageResolveCache.set(pageUrl, candidate);
      return candidate;
    }

    _gifPageResolveCache.set(pageUrl, null);
    return null;
  } catch (e) {
    console.warn("resolveGifPageUrlAsync failed:", pageUrl, e?.message || e);
    return null;
  }
}

// Build the inline GIF/video element for an embed URL.
function createInlineGifElement(mediaUrl) {
  const isVideo = /\.mp4(\?|$)/i.test(mediaUrl);
  if (isVideo) {
    const v = document.createElement("video");
    v.src = mediaUrl;
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.controls = false;
    v.className = "msg-image gif-embed";
    return v;
  }
  const img = document.createElement("img");
  img.src = mediaUrl;
  img.loading = "lazy";
  img.className = "msg-image gif-embed";
  img.onclick = () => openLightbox(mediaUrl);
  return img;
}


window.addEventListener("beforeunload", () => {
  navigator.sendBeacon(
    `${supabaseUrl}/rest/v1/typing`,
    JSON.stringify({
      username: username,
      typing: false
    })
  );
});

async function handleInlineConfirm() {
  const row = document.getElementById("newChannelRow");
  const input = document.getElementById("newChannelInput");

  const mode = row.dataset.mode;
  const targetId = row.dataset.targetId;
  const originalName = row.dataset.targetName;
  const value = input.value.trim();

  if (!value) return;

  try {
    if (mode === "channel-create") {
      const catInput = row.querySelector(".extra-input");
      const catValue = catInput ? catInput.value.trim() : "";
      if (!catValue) {
        alert("Please enter a category name.");
        return;
      }
      await performCreateChannel(value, catValue);
    } 
    else if (mode === "channel-rename") {
      await performRenameChannel(parseInt(targetId, 10), value);
    } 
    else if (mode === "category-create") {
      await performCreateCategory(value);
    } 
    else if (mode === "category-rename") {
      await performRenameCategory(originalName, value);
    }
  } catch (err) {
    console.error("❌ Inline action failed:", err);
  }

  closeInlineRow();
}

// ================================
// DISABLED: OLD INLINE TRIGGERS
// ================================
// We no longer support the inline row at the bottom.
// Channel creation is now handled exclusively via:
// 1. Right-clicking in the channel list (Context Menu)
// 2. The dedicated "Create Channel" modal (if implemented separately)

const createChannelBtn = document.getElementById("createChannelBtn");
const createCategoryBtn = document.getElementById("createCategoryBtn");

if (createChannelBtn) {
  // Option 1: Hide the button entirely if you only use Right-Click
  createChannelBtn.style.display = "none";

  // Option 2: If you want to keep the button but link it to a NEW modal, 
  // uncomment the line below and replace 'YOUR_NEW_MODAL_ID' with your actual modal ID
  // createChannelBtn.addEventListener("click", () => openModal('YOUR_NEW_MODAL_ID'));
}

if (createCategoryBtn) {
  // Same logic for categories if needed
  createCategoryBtn.style.display = "none";
}

// ======================== SERVER CONTEXT MENU ========================

function showServerContextMenu(x, y, serverId) {
  const menu = document.getElementById("serverMenu");
  if (!menu) return;

  closeAllContextMenus();
  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  const isOwner = server.owner_username === username;
  const isSysAdmin = currentSystemRole === "SysAdmin";
  const canManage = isOwner || isSysAdmin;
  const canLeave = !isOwner;

  menu.innerHTML = "";

  const markRead = document.createElement("button");
  markRead.textContent = "Mark All Messages as Read";
  markRead.onclick = async (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    try {
      await markServerMessagesRead(serverId);
    } catch (error) {
      console.error("❌ Failed to mark server messages as read:", error);
      alert("❌ Failed to mark messages as read.");
    }
  };
  menu.appendChild(markRead);

  // --- Management Options (Owner/SysAdmin only) ---
  if (canManage) {
    const addOption = (label, action, isDanger = false) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (isDanger) btn.classList.add("danger");
      btn.onclick = (e) => {
        e.stopPropagation();
        menu.style.display = "none";
        action();
      };
      menu.appendChild(btn);
    };

    addOption("Edit Server Name", () => editServerSetting(serverId, "name"));
    addOption("Edit Server Slug", () => editServerSetting(serverId, "slug"));
    addOption("Change Icon", () => editServerIcon(serverId));
    addOption("Server Options", () => manageServerOptions(serverId));

    // --- NEW: Invite Management ---
    addOption("Generate Invite", () => {
       // Reuse existing generateInvite logic but ensure it targets currentServerId
       // We need to temporarily set currentServerId if not already set
       const prevServerId = currentServerId;
       currentServerId = serverId;
       generateInvite();
       currentServerId = prevServerId;
    });

    addOption("Manage Invites", () => {
       openManageInvitesModal(serverId);
    });

    // Separator
    const sep = document.createElement("div");
    sep.style.height = "1px";
    sep.style.background = "#444";
    sep.style.margin = "4px 0";
    menu.appendChild(sep);

    addOption("Delete Server", () => deleteServer(serverId), true);
  }

  // --- Leave Option ---
  if (canLeave) {
    const btn = document.createElement("button");
    btn.textContent = "Leave Server";
    btn.classList.add("danger");
    btn.onclick = (e) => {
      e.stopPropagation();
      menu.style.display = "none";
      leaveServer(serverId);
    };
    menu.appendChild(btn);
  }

  // Position Menu
  menu.style.display = "block";
  const menuRect = menu.getBoundingClientRect();
  let left = x + 10;
  let top = y + 10;
  if (left + menuRect.width > window.innerWidth) left = x - menuRect.width - 10;
  if (top + menuRect.height > window.innerHeight) top = y - menuRect.height - 10;
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;
}

async function updateServerSettingValues(serverId, values = {}) {
  // SCHEMA MATCH: Update 'server_settings' table
  const { error } = await supabaseClient
    .from("server_settings")
    .upsert({ server_id: serverId, ...values }, { onConflict: "server_id" });
    
  if (error) throw error;

  // Update local cache
  serverSettingsCache.set(serverId, {
    ...getEffectiveServerSettings(serverId),
    ...values
  });

  if (serverId === currentServerId) {
    currentServerSettings = getEffectiveServerSettings(serverId);
    await loadCustomEmojis();
  }
}

function setServerOptionsError(message = "") {
  const errorEl = document.getElementById("serverOptionsError");
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = message ? "block" : "none";
}

function closeServerOptionsModal() {
  const modal = document.getElementById("serverOptionsModal");
  if (modal) modal.style.display = "none";
  currentServerOptionsTargetId = null;
  setServerOptionsError("");
}

async function openServerOptionsModal(serverId) {
  if (!canManageServerOptions(serverId)) {
    alert("❌ You do not have permission to manage server options.");
    return;
  }

  await loadServerSettings(serverId, { force: true });
  const modal = document.getElementById("serverOptionsModal");
  if (!modal) return;

  const settings = getEffectiveServerSettings(serverId);
  const words = getEffectiveServerWordFilters(serverId);
  const server = servers.find((entry) => entry.id === serverId);

  currentServerOptionsTargetId = serverId;
  document.getElementById("serverOptionsSubtitle").textContent = `Manage feature toggles for ${server?.name || "this server"}.`;
  document.getElementById("serverOptionBadWords").checked = Boolean(settings.bad_word_filter_enabled);
  document.getElementById("serverOptionAdminEmoji").checked = Boolean(settings.admin_only_custom_emojis);
  document.getElementById("serverOptionLinks").checked = Boolean(settings.allow_plaintext_links);
  document.getElementById("serverOptionEveryone").checked = Boolean(settings.allow_everyone_mentions);
  document.getElementById("serverOptionWordList").value = words.join(", ");
  setServerOptionsError("");
  modal.style.display = "flex";
}

async function saveServerOptionsModal() {
  if (!currentServerOptionsTargetId) return;

  const serverId = currentServerOptionsTargetId;
  const values = {
    bad_word_filter_enabled: document.getElementById("serverOptionBadWords").checked,
    admin_only_custom_emojis: document.getElementById("serverOptionAdminEmoji").checked,
    allow_plaintext_links: document.getElementById("serverOptionLinks").checked,
    allow_everyone_mentions: document.getElementById("serverOptionEveryone").checked
  };
  const words = [...new Set(
    document.getElementById("serverOptionWordList").value
      .split(",")
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  )];

  try {
    await updateServerSettingValues(serverId, values);

    const { data: existingRows, error: existingError } = await supabaseClient
      .from("server_word_filters")
      .select("id, word, is_active")
      .eq("server_id", serverId);
    if (existingError) throw existingError;

    if (words.length > 0) {
      const { error: upsertError } = await supabaseClient
        .from("server_word_filters")
        .upsert(
          words.map((word) => ({
            server_id: serverId,
            word,
            replacement: "****",
            is_active: true,
            created_by: username
          })),
          { onConflict: "server_id,word" }
        );
      if (upsertError) throw upsertError;
    }

    const wordSet = new Set(words);
    const toDeactivate = (existingRows || [])
      .filter((row) => row.is_active && !wordSet.has(String(row.word || "").toLowerCase()))
      .map((row) => row.id)
      .filter(Boolean);

    if (toDeactivate.length > 0) {
      const { error: deactivateError } = await supabaseClient
        .from("server_word_filters")
        .update({ is_active: false })
        .in("id", toDeactivate);
      if (deactivateError) throw deactivateError;
    }

    serverWordFiltersCache.set(serverId, words);
    if (serverId === currentServerId) currentServerWordFilters = [...words];
    closeServerOptionsModal();
  } catch (error) {
    console.error("❌ Failed to update server options:", error);
    setServerOptionsError("Failed to save server options: " + error.message);
  }
}

async function manageServerOptions(serverId) {
  await openServerOptionsModal(serverId);
}

// Attach listener to server icons
document.addEventListener("DOMContentLoaded", () => {
  const serverList = document.getElementById("serverList");
  if (serverList) {
    serverList.addEventListener("contextmenu", (e) => {
      const icon = e.target.closest(".server-icon[data-server-id]");
      if (!icon) return;

      e.preventDefault();
      const serverId = icon.dataset.serverId;
      showServerContextMenu(e.clientX, e.clientY, serverId);
    });
  }
});

// --- Action Handlers ---

async function editServerSetting(serverId, field) {
  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  let promptText = "";
  let currentValue = "";

  if (field === "name") {
    promptText = "Enter new server name:";
    currentValue = server.name;
  } else if (field === "slug") {
    promptText = "Enter new URL slug (letters, numbers, hyphens):";
    currentValue = server.slug;
  }

  const newValue = prompt(promptText, currentValue);
  if (newValue === null || newValue.trim() === "") return;

  const trimmed = newValue.trim();

  // Validation for slug
  if (field === "slug" && !/^[a-z0-9-]+$/.test(trimmed)) {
    alert("❌ Slug must contain only lowercase letters, numbers, and hyphens.");
    return;
  }

  try {
    const updateData = field === "name" ? { name: trimmed } : { slug: trimmed };

    const { error } = await supabaseClient
      .from("servers")
      .update(updateData)
      .eq("id", serverId);

    if (error) throw error;

    // Update local state
    server[field] = trimmed;
    if (field === "name" && serverId === currentServerId) {
      document.getElementById("serverNameDisplay").textContent = trimmed;
    }
    renderServerList(); // Re-render to update tooltip/title

    alert(`✅ Server ${field} updated.`);
  } catch (err) {
    console.error("Update failed:", err);
    alert("❌ Failed to update: " + err.message);
  }
}

async function editServerIcon(serverId) {
  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  // Create a temporary file input
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("❌ Icon must be under 5MB.");
      return;
    }

    const uploadBtn = document.getElementById("uploadBtn");
    if (uploadBtn) {
      uploadBtn.textContent = "⏳";
      uploadBtn.disabled = true;
    }

    try {
      const timestamp = Date.now();
      const fileName = `server-icons/${timestamp}_${file.name.replace(/\s+/g, "_")}`;

      const { error: uploadError } = await supabaseClient.storage
        .from("chat-files")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabaseClient.storage
        .from("chat-files")
        .getPublicUrl(fileName);

      const newIconUrl = urlData.publicUrl;

      const { error: updateError } = await supabaseClient
        .from("servers")
        .update({ icon_url: newIconUrl })
        .eq("id", serverId);

      if (updateError) throw updateError;

      server.icon_url = newIconUrl;
      renderServerList();
      alert("✅ Icon updated!");
    } catch (err) {
      console.error("Icon update failed:", err);
      alert("❌ Failed: " + err.message);
    } finally {
      if (uploadBtn) {
        uploadBtn.textContent = "📎";
        uploadBtn.disabled = false;
      }
    }
  };

  input.click();
}

// Replace your existing deleteServer function with this simplified version
async function deleteServer(serverId) {
  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  if (!confirm(`Are you sure you want to delete "${server.name}"? This will permanently delete all channels, messages, members, emojis, and server data. This cannot be undone.`)) {
    return;
  }

  try {
    // With cascade, we only need to delete the server itself
    const { error } = await supabaseClient
      .from("servers")
      .delete()
      .eq("id", serverId);

    if (error) throw error;

    // Update local state
    servers = servers.filter(s => s.id !== serverId);

    // If we were in this server, switch away
    if (currentServerId === serverId) {
      currentServerId = null;
      currentChannelId = null;
      showNoServerScreen();
    }

    renderServerList();
    alert("✅ Server and all associated data deleted successfully.");
  } catch (err) {
    console.error("Delete failed:", err);
    alert("❌ Failed to delete server: " + err.message);
  }
}

async function leaveServer(serverId) {
  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  if (!confirm(`Leave "${server.name}"? You will lose access to all channels and messages.`)) {
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("server_members")
      .delete()
      .eq("server_id", serverId)
      .eq("username", username);

    if (error) throw error;

    // Update local state
    servers = servers.filter(s => s.id !== serverId);

    if (currentServerId === serverId) {
      currentServerId = null;
      currentChannelId = null;
      showNoServerScreen();
    }

    renderServerList();
    alert("✅ You have left the server.");
  } catch (err) {
    console.error("Leave failed:", err);
    alert("❌ Failed to leave: " + err.message);
  }
}

// Close server menu when clicking outside
document.addEventListener("click", (e) => {
  const serverMenu = document.getElementById("serverMenu");

  // Only act if the menu is currently visible
  if (serverMenu && serverMenu.style.display === "block") {
    // If the click target is NOT the menu itself and NOT inside the menu
    if (!serverMenu.contains(e.target)) {
      serverMenu.style.display = "none";
    }
  }
});

async function changeName(targetUser) {
  if (!currentServerId || !targetUser) {
    alert("❌ No server or user selected.");
    return;
  }

  // 1. Permission Check
  const isOwner = isServerOwner();
  const isAdmin = currentSystemRole === "SysAdmin" || currentSystemRole === "SysManager";
  const hasManageRoles = userPermissions.manage_roles;

  if (!isAdmin && !isOwner && !hasManageRoles) {
    alert("❌ You don't have permission to change user names.");
    return;
  }

  // 2. Get current name for the prompt
  const member = serverMembers.find(m => m.username === targetUser);
  const currentDisplayName = member?.profile_display_name || "";
  const actualName = targetUser;

  // 3. Ask which name to use
  const useCustom = confirm(
    `Change name for "${actualName}"\n\n` +
    `Actual name: ${actualName}\n` +
    `Current display name: ${currentDisplayName || "(none — using actual name)"}\n\n` +
    `Click OK to set a custom display name (nickname).\n` +
    `Click Cancel to use their actual name (${actualName}) instead.`
  );

  let trimmedName = null; 
  let isNicknameChange = false;

  if (useCustom) {
    const newNameInput = prompt(
      `Custom display name for ${actualName}:`,
      currentDisplayName || actualName
    );
    
    if (newNameInput === null) return; 
    
    const cleaned = newNameInput.trim();
    
    if (!cleaned) {
      alert("❌ Name cannot be empty. (Pick Cancel on the first dialog to use the actual name.)");
      return;
    }
    
    if (cleaned === actualName) {
      trimmedName = null;
    } else {
      trimmedName = cleaned;
      isNicknameChange = true; // Flag: This is just a nickname change
    }
  }

  // 4. Update Database
  try {
    // A. Update the Server Member Profile (Nickname)
    // This ALWAYS happens if a nickname is set
    if (trimmedName !== null) {
      const { error: profileError } = await supabaseClient
        .from("server_members")
        .update({ 
          profile_display_name: trimmedName 
        })
        .eq("server_id", currentServerId)
        .eq("username", targetUser);

      if (profileError) {
        console.error("Profile Update Error:", profileError);
        throw profileError;
      }
    }

    // B. 🚀 CRITICAL: Update Messages ONLY if we are changing the REAL USERNAME
    // If it's just a nickname, we DO NOT update the 'username' column in messages
    // because the FK constraint requires the username to exist in the 'users' table.
    if (!isNicknameChange && trimmedName !== null) {
      // This path implies we are changing the ACTUAL username (e.g., "OldName" -> "NewName")
      // 1. First, update the 'users' table to ensure the new name exists
      const { error: userUpdateError } = await supabaseClient
        .from("users")
        .update({ username: trimmedName })
        .eq("username", targetUser);

      if (userUpdateError) {
        console.error("User Table Update Error:", userUpdateError);
        throw userUpdateError;
      }

      // 2. Now update the messages
      const serverChannelIds = channels
        .filter(ch => ch.server_id === currentServerId)
        .map(ch => ch.id);

      if (serverChannelIds.length > 0) {
        const { error: messageError } = await supabaseClient
          .from("messages")
          .update({ username: trimmedName })
          .in("channel_id", serverChannelIds)
          .eq("username", targetUser);

        if (messageError) {
          console.error("Message Update Error:", messageError);
          throw messageError;
        }
      }

      // 3. Update DMs
      const { data: dmMemberships, error: dmError } = await supabaseClient
        .from("direct_conversation_members")
        .select("conversation_id")
        .eq("username", targetUser);

      if (!dmError && dmMemberships && dmMemberships.length > 0) {
        const conversationIds = dmMemberships.map(m => m.conversation_id);
        const { error: dmMessageError } = await supabaseClient
          .from("dm_messages")
          .update({ username: trimmedName })
          .in("conversation_id", conversationIds)
          .eq("username", targetUser);

        if (dmMessageError) {
          console.error("DM Message Update Error:", dmMessageError);
          // Non-fatal, but log it
        }
      }
      
      // 4. Update the targetUser variable for the rest of the function
      // (Now that the username has changed, we refer to the new name)
      // Note: In a real app, you might need to reload the user object here.
    }

    // 5. Update Local State (Frontend Cache)
    if (member) {
      // If it's a nickname, update the display name
      // If it's a real name change, the 'username' in the member object might need updating too
      member.profile_display_name = trimmedName || "";
      setServerProfileData(currentServerId, targetUser, {
        ...getServerProfileData(currentServerId, targetUser),
        display_name: trimmedName || ""
      });
    }

    // 6. Re-render UI
    renderMemberList();

    if (trimmedName) {
      if (isNicknameChange) {
        alert(`✅ Nickname set to "${trimmedName}".\n(Note: Old messages still show the real username, but the UI will show the nickname.)`);
      } else {
        alert(`✅ Username changed to "${trimmedName}".\n🔄 Old messages updated in database.`);
      }
    } else {
      alert(`✅ Name reset to actual username.`);
    }

  } catch (err) {
    console.error("Change name failed:", err);
    alert("❌ Failed to update name: " + (err.message || "Unknown error"));
  }
}

// --- New: Manage Invites Modal Logic ---

async function openManageInvitesModal(serverId) {
  if (!serverId) return;
  const modal = document.getElementById("manageInvitesModal");
  const listContainer = document.getElementById("inviteListContent");
  const serverNameDisplay = document.getElementById("inviteServerName");

  const server = servers.find(s => s.id === serverId);
  if (!server) return;

  serverNameDisplay.textContent = server.name;
  listContainer.innerHTML = '<div style="padding:20px;text-align:center;">Loading invites...</div>';

  openModal("manageInvitesModal");

  try {
    // Fetch invites for this server
    const { data: invites, error } = await supabaseClient
      .from("server_invites")
      .select("*")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!invites || invites.length === 0) {
      listContainer.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No active invites found.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    invites.forEach(invite => {
      const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
      const isMaxed = invite.max_uses && invite.use_count >= invite.max_uses;

      const item = document.createElement("div");
      item.className = "invite-item";
      item.innerHTML = `
        <div class="invite-header">
          <span class="invite-code">${invite.code}</span>
          <span class="invite-status ${isExpired ? 'expired' : isMaxed ? 'maxed' : 'active'}">
            ${isExpired ? 'Expired' : isMaxed ? 'Max Uses' : 'Active'}
          </span>
        </div>
        <div class="invite-details">
          <div>Uses: ${invite.use_count || 0} / ${invite.max_uses || '∞'}</div>
          <div>Created: ${new Date(invite.created_at).toLocaleDateString()}</div>
          <div>Expires: ${invite.expires_at ? new Date(invite.expires_at).toLocaleString() : 'Never'}</div>
        </div>
        <div class="invite-actions">
          <button class="btn-edit-invite" data-id="${invite.id}">Edit</button>
          <button class="btn-delete-invite" data-id="${invite.id}">Delete</button>
        </div>
      `;
      fragment.appendChild(item);
    });

    listContainer.innerHTML = "";
    listContainer.appendChild(fragment);

    // Attach listeners
    listContainer.querySelectorAll(".btn-edit-invite").forEach(btn => {
      btn.addEventListener("click", () => editInvite(btn.dataset.id));
    });
    listContainer.querySelectorAll(".btn-delete-invite").forEach(btn => {
      btn.addEventListener("click", () => deleteInvite(btn.dataset.id));
    });

  } catch (err) {
    console.error("Failed to load invites:", err);
    listContainer.innerHTML = `<div style="color:red;padding:20px;">Error loading invites: ${err.message}</div>`;
  }
}

async function editInvite(inviteId) {
  const invite = await supabaseClient
    .from("server_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (!invite) return;

  const newMax = prompt("Max uses (leave blank for unlimited):", invite.max_uses || "");
  if (newMax === null) return;

  const newExp = prompt("Expiration date (YYYY-MM-DD HH:MM or leave blank for never):", 
    invite.expires_at ? new Date(invite.expires_at).toISOString().slice(0, 16) : "");
  if (newExp === null) return;

  const updateData = {};
  if (newMax !== null && newMax.trim() !== "") {
    const val = parseInt(newMax);
    if (!isNaN(val)) updateData.max_uses = val;
  }

  if (newExp !== null && newExp.trim() !== "") {
    const date = new Date(newExp);
    if (!isNaN(date.getTime())) {
      updateData.expires_at = date.toISOString();
    } else {
      alert("Invalid date format.");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("server_invites")
    .update(updateData)
    .eq("id", inviteId);

  if (error) {
    alert("Failed to update invite: " + error.message);
  } else {
    alert("Invite updated!");
    // Refresh the modal
    openManageInvitesModal(currentServerId);
  }
}

async function deleteInvite(inviteId) {
  if (!confirm("Delete this invite?")) return;

  const { error } = await supabaseClient
    .from("server_invites")
    .delete()
    .eq("id", inviteId);

  if (error) {
    alert("Failed to delete: " + error.message);
  } else {
    openManageInvitesModal(currentServerId);
  }
}

// --- Channel Mention Click Handler ---
document.addEventListener("click", (e) => {
  const channelMention = e.target.closest(".channel-mention");
  if (!channelMention) return;

  const channelName = channelMention.dataset.channel;
  if (!channelName || !currentServerId) return;

  // Find the channel in the current server
  const targetChannel = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());

  if (targetChannel) {
    e.preventDefault();
    e.stopPropagation();
    switchChannel(targetChannel.id);
    if (window.innerWidth <= 768) closeSidebar();
  } else {
    // Optional: Alert if channel not found
    // alert(`Channel #${channelName} not found in this server.`);
  }
});

function getChannelContext() {
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  // Matches # followed by alphanumeric/underscore/hyphen at the end of the string
  const match = beforeCursor.match(/(^|\s)#([a-zA-Z0-9_-]*)$/);
  if (!match) return null;
  return {
    query: match[2] || "",
    start: cursor - match[2].length - 1,
    end: cursor
  };
}

// --- Channel Mention Click Handler ---
document.addEventListener("click", (e) => {
  const channelMention = e.target.closest(".channel-mention");
  if (!channelMention) return;

  const channelName = channelMention.dataset.channel;
  if (!channelName || !currentServerId) return;

  // Find the channel in the current server
  const targetChannel = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());

  if (targetChannel) {
    e.preventDefault();
    e.stopPropagation();
    switchChannel(targetChannel.id);
    if (window.innerWidth <= 768) closeSidebar();
  } else {
    // Optional: Alert if channel not found
    // alert(`Channel #${channelName} not found in this server.`);
  }
});

function getProfileData(usernameVal, serverId = null) {
  if (serverId) {
    // Return server-specific profile
    return getServerProfileData(serverId, usernameVal) || {
      display_name: usernameVal,
      avatar_url: getAvatarUrl(usernameVal),
      description: ""
    };
  }
  // Return global profile
  return {
    display_name: usernameVal,
    avatar_url: getAvatarUrl(usernameVal),
    description: "" // You might want to fetch this from 'users' table if you add a column
  };
}

async function fetchUserProfile(usernameVal, serverId = null) {
  // Always fetch the global profile so we can fall back when the per-server
  // bio/avatar are empty. (The bio "About Me" used to be blank for anyone who
  // only set it on their global profile.)
  const globalReq = supabaseClient
    .from("users")
    .select("profile_description, avatar_url")
    .eq("username", usernameVal)
    .maybeSingle();

  if (serverId) {
    const memberReq = supabaseClient
      .from("server_members")
      .select("profile_display_name, profile_avatar_url, profile_description, role")
      .eq("server_id", serverId)
      .eq("username", usernameVal)
      .maybeSingle();

    const [{ data: memberData, error: memberErr }, { data: globalData }] =
      await Promise.all([memberReq, globalReq]);

    if (memberErr) {
      console.warn("Profile fetch error:", memberErr);
      return getProfileData(usernameVal, serverId);
    }
    return {
      display_name: memberData?.profile_display_name || usernameVal,
      avatar_url: memberData?.profile_avatar_url || globalData?.avatar_url || getAvatarUrl(usernameVal),
      description: memberData?.profile_description || globalData?.profile_description || "",
      role: memberData?.role || null
    };
  } else {
    const { data: globalData } = await globalReq;
    return {
      display_name: usernameVal,
      avatar_url: globalData?.avatar_url || getAvatarUrl(usernameVal),
      description: globalData?.profile_description || ""
    };
  }
}

async function openUserProfile(usernameVal, serverId = null) {
  if (!username) return;
  if (!usernameVal) return;

  currentProfileUsername = usernameVal;
  currentProfileServerId = serverId;

  const modal = document.getElementById("userProfileModal");
  if (!modal) return;

  // Show loading state
  document.getElementById("profileDisplayName").textContent = "Loading...";
  document.getElementById("profileDescription").textContent = "";

  // Fetch data
  const profile = await fetchUserProfile(usernameVal, serverId);

  // Update UI
  document.getElementById("profileDisplayName").textContent = profile.display_name;
  document.getElementById("profileUsername").textContent = `@${usernameVal}`;

  // Role in this server (only when viewing in a server context)
  const roleWrap = document.getElementById("profileServerRole");
  const roleBadge = document.getElementById("profileServerRoleBadge");
  if (roleWrap && roleBadge) {
    let roleToShow = null;
    if (serverId && profile && profile.role) roleToShow = profile.role;
    else if (usernameVal === username && serverId === currentServerId) roleToShow = currentRole;
    if (roleToShow) {
      const norm = (typeof normalizeServerRole === "function") ? normalizeServerRole(roleToShow) : roleToShow;
      roleBadge.textContent = norm;
      roleBadge.className = "profile-server-role-badge role-" + String(norm).toLowerCase();
      roleWrap.style.display = "flex";
    } else {
      roleWrap.style.display = "none";
    }
  }

  // Handle Bio
  const descEl = document.getElementById("profileDescription");
  descEl.textContent = profile.description || "No bio yet.";
  descEl.style.cursor = "pointer";
  descEl.title = "Click to edit bio";

  // Add click listener to bio for editing (only if it's the current user)
  if (usernameVal === username && serverId === currentServerId) {
    descEl.onclick = () => enableBioEdit(profile.description || "");
  } else {
    descEl.onclick = null;
  }

  // Update Avatar
  const avatarImg = document.getElementById("profileAvatarImage");
  const avatarFallback = document.getElementById("profileAvatarFallback");
  const avatarContainer = document.getElementById("profileAvatarContainer");

  avatarImg.style.display = "none";
  avatarFallback.style.display = "flex";

  if (profile.avatar_url) {
    avatarImg.src = profile.avatar_url;
    avatarImg.style.display = "block";
    avatarFallback.style.display = "none";
  } else {
    avatarFallback.textContent = getInitials(usernameVal);
  }

  // Show "Edit Profile" button only if it's the current user viewing themselves in this server.
  const editBtn = document.getElementById("profileEditBtn");
  const isOwnProfile = usernameVal === username;
  const isOwnServerProfile = isOwnProfile && serverId === currentServerId;

  if (editBtn) {
    if (isOwnServerProfile) {
      editBtn.style.display = "block";
      editBtn.textContent = "Edit Name & Avatar";
    } else {
      editBtn.style.display = "none";
    }
  }

  // Render Discord connection UI if viewing own profile
  if (isOwnProfile) {
    renderDiscordConnectionUI();
  }

  modal.style.display = "flex";
}

function closeUserProfile() {
  const modal = document.getElementById("userProfileModal");
  if (modal) modal.style.display = "none";
}

async function performLogout({ showMessage = false } = {}) {
  closeUserProfile();
  localStorage.removeItem("chatUsername");
  localStorage.removeItem("chatRole");
  sessionStorage.clear();
  await supabaseClient.auth.signOut();
  if (showMessage) alert("You have been logged out.");
  location.reload();
}

/* ======================================================================
   DANGER — Delete Account (irreversible app-side delete + sign out)
   The auth.users row may persist; account profile/data is wiped here.
   ====================================================================== */
async function deleteMyAccount() {
  if (!username) return;
  const status = document.getElementById("settingsDeleteAccountStatus");
  const setStatus = (txt, isErr = false) => {
    if (!status) return;
    status.textContent = txt;
    status.classList.toggle("error", !!isErr);
  };

  // Two-step confirmation: confirm() + type-username prompt.
  if (!confirm(`This will permanently delete your account "${username}", remove you from every server, and erase your messages, reactions and DMs.\n\nThis CANNOT be undone. Continue?`)) return;
  const typed = window.prompt(`Type your username to confirm permanent deletion:\n\n${username}`);
  if (typed == null) return;
  if (typed.trim() !== username) { setStatus("❌ Username didn't match. Aborted.", true); return; }

  setStatus("⏳ Deleting your account…");
  const btn = document.getElementById("settingsDeleteAccountBtn");
  if (btn) btn.disabled = true;

  try {
    // Best-effort cleanup. RLS should permit a user to delete their own rows.
    const tables = [
      { table: "reactions",                 col: "username" },
      { table: "messages",                  col: "username" },
      { table: "dm_messages",               col: "username" },
      { table: "voice_room_participants",   col: "username" },
      { table: "channel_permissions",       col: "username" },
      { table: "server_member_roles",       col: "username" },
      { table: "server_members",            col: "username" },
      { table: "users",                     col: "username" }
    ];
    for (const t of tables) {
      try {
        await supabaseClient.from(t.table).delete().eq(t.col, username);
      } catch (err) {
        console.warn(`delete from ${t.table} failed:`, err.message);
      }
    }

    setStatus("✅ Account data removed. Signing you out…");
    // Wipe local state and sign out.
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try { await supabaseClient.auth.signOut(); } catch {}

    setTimeout(() => { location.reload(); }, 800);
  } catch (err) {
    if (btn) btn.disabled = false;
    setStatus("❌ Failed to delete: " + err.message, true);
  }
}

async function linkGoogleAccount() {
  await linkOAuthIdentity("google");
}

async function linkGithubAccount() {
  await linkOAuthIdentity("github");
}

/*async function linkSpotifyAccount() {
  await linkOAuthIdentity("spotify");
}*/

async function linkOAuthIdentity(provider) {
  console.log(`🔄 Attempting to link ${provider}...`);

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    showLinkStatus(`❌ You must be logged in to link accounts.`, "error");
    return;
  }

  localStorage.setItem('oauth_linking', 'true');
  localStorage.setItem('oauth_provider', provider);
  localStorage.setItem('oauth_user_id', session.user.id);

  const redirectTo = getAuthRedirectUrl();

  // 🔥 CRITICAL FIX: Define required scopes for Spotify
  const scopes = {
    //spotify: ['user-read-email'], // These are required for Supabase to get the profile
    google: [],
    github: [],
    discord: [],
    azure: []
  };

  const { data, error } = await supabaseClient.auth.linkIdentity({
    provider: provider,
    options: {
      skipBrowserRedirect: false,
      scopes: (scopes[provider] || []).join(" "),
      ...(redirectTo ? { redirectTo } : {})
    }
  });

  if (error) {
    console.error("❌ Link Error:", error);
    localStorage.removeItem('oauth_linking');
    localStorage.removeItem('oauth_provider');
    localStorage.removeItem('oauth_user_id');
    showLinkStatus(`❌ Failed to link ${provider}: ${error.message}`, "error");
    return;
  }

  if (data?.url) {
    console.log(`🔄 Redirecting to ${provider}...`);
    showLinkStatus(`🔄 Redirecting to ${provider} to link account...`, "success");
    window.location.href = data.url;
  } else {
    localStorage.removeItem('oauth_linking');
    localStorage.removeItem('oauth_provider');
    localStorage.removeItem('oauth_user_id');
    showLinkStatus(`❌ No redirect URL received.`, "error");
  }
}

function showLinkStatus(message, type = "success") {
  const statusEl = document.getElementById("accountLinkStatus");
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.style.display = "block";
  statusEl.style.color = type === "error" ? "#ed4245" : "#3ba55d";
  statusEl.style.background = type === "error" ? "rgba(237, 66, 69, 0.1)" : "rgba(59, 165, 93, 0.1)";

  setTimeout(() => {
    statusEl.style.display = "none";
  }, 5000);
}

async function changeAccountPassword() {
  const newPassword = prompt("Enter your new password:");
  if (!newPassword) return;
  if (String(newPassword).length < 6) {
    alert("❌ Password must be at least 6 characters.");
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    alert("❌ Please sign in again to change your password.");
    await performLogout();
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({
    password: newPassword
  });

  if (error) {
    alert("❌ Failed to update password: " + error.message);
    return;
  }

  alert("✅ Password updated.");
}

async function changeAccountEmail() {
  const newEmail = prompt("Enter your new email:");
  if (!newEmail) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(newEmail))) {
    alert("❌ Please enter a valid email address.");
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    alert("❌ Please sign in again to change your email.");
    await performLogout();
    return;
  }

  const redirectTo = getAuthRedirectUrl();
  const { error } = await supabaseClient.auth.updateUser(
    { email: newEmail },
    redirectTo ? { emailRedirectTo: redirectTo } : undefined
  );

  if (error) {
    alert("❌ Failed to update email: " + error.message);
    return;
  }

  alert("✅ Email update requested. Check your inbox to confirm the change.");
}

// --- Profile Modal Listeners ---
const profileModal = document.getElementById("userProfileModal");
if (profileModal) {
  // Close on X or Close button
  document.getElementById("profileCloseBtn").addEventListener("click", closeUserProfile);

  // Close on clicking outside
  profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) closeUserProfile();
  });

  // Avatar Click (Upload)
  document.getElementById("profileAvatarContainer").addEventListener("click", async () => {
    // Only allow upload if it's the current user
    if (currentProfileUsername !== username) return;

    // Trigger the existing avatar upload logic
    const fileInput = document.getElementById("avatarInput");
    if (fileInput) {
      fileInput.click();
    }
  });

  // Edit Button Click
  document.getElementById("profileEditBtn").addEventListener("click", async () => {
    if (currentProfileUsername !== username) return;

    // Reuse existing edit profile logic
    await editMyServerProfile();
    // Refresh modal data after edit
    openUserProfile(username, currentServerId);
  });

  // Note: profile-modal account/log-out/link buttons were moved to the User Settings modal.
  const _profileLogoutBtn = document.getElementById("profileLogoutBtn");
  if (_profileLogoutBtn) _profileLogoutBtn.addEventListener("click", async () => {
    if (currentProfileUsername !== username) return;
    await performLogout();
  });
  const _profileChgPwdBtn = document.getElementById("profileChangePasswordBtn");
  if (_profileChgPwdBtn) _profileChgPwdBtn.addEventListener("click", async () => {
    if (currentProfileUsername !== username) return;
    await changeAccountPassword();
  });
  const _profileChgEmailBtn = document.getElementById("profileChangeEmailBtn");
  if (_profileChgEmailBtn) _profileChgEmailBtn.addEventListener("click", async () => {
    if (currentProfileUsername !== username) return;
    await changeAccountEmail();
  });
}

const serverOptionsModal = document.getElementById("serverOptionsModal");
if (serverOptionsModal) {
  document.getElementById("closeServerOptionsModal").addEventListener("click", closeServerOptionsModal);
  document.getElementById("cancelServerOptionsBtn").addEventListener("click", closeServerOptionsModal);
  document.getElementById("saveServerOptionsBtn").addEventListener("click", saveServerOptionsModal);
  serverOptionsModal.addEventListener("click", (event) => {
    if (event.target === serverOptionsModal) closeServerOptionsModal();
  });
  const openRolesBtn = document.getElementById("openServerRolesBtn");
  if (openRolesBtn) openRolesBtn.addEventListener("click", () => openServerRolesModal(currentServerOptionsTargetId));
}

/* ======================================================================
   SERVER ROLES MANAGER — create/edit roles + per-role permission toggles.
   ====================================================================== */

const ROLE_PERMISSION_DEFS = [
  { key: "manage_roles",        title: "Manage Roles",            desc: "Edit other roles, channels, server settings, and member roles." },
  { key: "manage_messages",     title: "Manage Messages",         desc: "Delete or pin any message in this server." },
  { key: "mute_users",          title: "Mute / Block Members",    desc: "Mute or block other members in this server." },
  { key: "send_gifs",           title: "Send GIFs",               desc: "Use /gif and post GIF / image / video URLs." },
  { key: "send_links",          title: "Send Links",              desc: "Bypass the server's plain-text link restriction." },
  { key: "send_attachments",    title: "Send Attachments",        desc: "Upload files in text channels." },
  { key: "mention_everyone",    title: "Mention @everyone / @here", desc: "Use @everyone and @here regardless of server setting." },
  { key: "bypass_word_filter",  title: "Bypass Bad-Word Filter",  desc: "Send messages without the bad-word filter censoring them." },
  { key: "create_invites",      title: "Create Invites",          desc: "Create new invite links for this server." },
  { key: "use_custom_emojis",   title: "Use Custom Emojis",       desc: "Use server custom emojis even when restricted to admins." }
];

let serverRolesCache = [];
let editingRoleId = null;
let _isCreatingNewRole = false;

async function openServerRolesModal(serverId) {
  if (!serverId) return;
  if (!canManageServerOptions(serverId)) {
    alert("❌ You don't have permission to manage roles.");
    return;
  }
  const modal = document.getElementById("serverRolesModal");
  if (!modal) return;
  modal.style.display = "flex";
  document.getElementById("serverRolesEditor").style.display = "none";
  setServerRolesError("");
  await loadServerRolesForEditor(serverId);
}

function closeServerRolesModal() {
  const modal = document.getElementById("serverRolesModal");
  if (modal) modal.style.display = "none";
  editingRoleId = null;
  _isCreatingNewRole = false;
  setServerRolesError("");
}

function setServerRolesError(msg) {
  const el = document.getElementById("serverRolesError");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

async function loadServerRolesForEditor(serverId) {
  const list = document.getElementById("serverRolesList");
  if (!list) return;
  list.innerHTML = '<div class="server-roles-empty">Loading roles…</div>';
  const { data, error } = await supabaseClient
    .from("server_roles")
    .select("id, server_id, role, name, color, permissions, description")
    .eq("server_id", serverId)
    .order("name", { ascending: true });
  if (error) {
    list.innerHTML = `<div class="server-roles-empty">Failed to load roles: ${escapeHTML(error.message)}</div>`;
    return;
  }
  serverRolesCache = data || [];
  renderServerRolesList();
}

function renderServerRolesList() {
  const list = document.getElementById("serverRolesList");
  if (!list) return;
  if (!serverRolesCache.length) {
    list.innerHTML = '<div class="server-roles-empty">No roles yet. Click "+ New Role" to create one.</div>';
    return;
  }
  list.innerHTML = "";
  serverRolesCache.forEach((role) => {
    const row = document.createElement("div");
    row.className = "server-role-row" + (role.id === editingRoleId ? " selected" : "");
    const name = role.name || role.role || "Role";
    row.innerHTML = `
      <span class="server-role-swatch" style="background:${escapeHTML(role.color || "#5865f2")};"></span>
      <span class="server-role-row-name">${escapeHTML(name)}</span>
    `;
    row.addEventListener("click", () => openRoleEditor(role.id));
    list.appendChild(row);
  });
}

function openRoleEditor(roleId) {
  const role = serverRolesCache.find((r) => r.id === roleId);
  if (!role) return;
  editingRoleId = roleId;
  _isCreatingNewRole = false;
  setServerRolesError("");
  const editor = document.getElementById("serverRolesEditor");
  editor.style.display = "flex";
  document.getElementById("serverRoleNameInput").value = role.name || role.role || "";
  document.getElementById("serverRoleColorInput").value = normalizeHexColor(role.color) || "#5865f2";
  renderRolePermissionToggles(role.permissions || {});
  document.getElementById("deleteServerRoleBtn").style.display = "inline-block";
  renderServerRolesList();
}

function startNewRole() {
  editingRoleId = null;
  _isCreatingNewRole = true;
  setServerRolesError("");
  const editor = document.getElementById("serverRolesEditor");
  editor.style.display = "flex";
  document.getElementById("serverRoleNameInput").value = "";
  document.getElementById("serverRoleColorInput").value = "#5865f2";
  renderRolePermissionToggles({});
  document.getElementById("deleteServerRoleBtn").style.display = "none";
  renderServerRolesList();
}

function renderRolePermissionToggles(perms) {
  const container = document.getElementById("serverRolePermissionsList");
  if (!container) return;
  container.innerHTML = "";
  ROLE_PERMISSION_DEFS.forEach((def) => {
    const row = document.createElement("label");
    row.className = "server-role-permission-row";
    row.innerHTML = `
      <span class="server-role-permission-info">
        <span class="server-role-permission-title">${escapeHTML(def.title)}</span>
        <span class="server-role-permission-desc">${escapeHTML(def.desc)}</span>
      </span>
      <span class="server-role-permission-toggle">
        <input type="checkbox" data-perm-key="${escapeHTML(def.key)}" ${perms[def.key] ? "checked" : ""} />
      </span>
    `;
    container.appendChild(row);
  });
}

function collectRolePermissionsFromUI() {
  const out = {};
  document.querySelectorAll("#serverRolePermissionsList input[data-perm-key]").forEach((inp) => {
    out[inp.dataset.permKey] = !!inp.checked;
  });
  return out;
}

function normalizeHexColor(c) {
  if (typeof c !== "string") return "";
  const m = c.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? "#" + m[1].toLowerCase() : "";
}

async function saveCurrentRole() {
  const serverId = currentServerOptionsTargetId;
  if (!serverId) { setServerRolesError("No server selected."); return; }
  const name = document.getElementById("serverRoleNameInput").value.trim();
  const color = normalizeHexColor(document.getElementById("serverRoleColorInput").value) || "#5865f2";
  const permissions = collectRolePermissionsFromUI();
  if (!name) { setServerRolesError("Role name can't be empty."); return; }

  try {
    if (_isCreatingNewRole || !editingRoleId) {
      const { data, error } = await supabaseClient
        .from("server_roles")
        .insert({ server_id: serverId, role: name, name, color, permissions })
        .select("id, server_id, role, name, color, permissions")
        .single();
      if (error) throw error;
      serverRolesCache.push(data);
      editingRoleId = data.id;
      _isCreatingNewRole = false;
      await syncDiscordRole("create", data);
    } else {
      const { error } = await supabaseClient
        .from("server_roles")
        .update({ name, role: name, color, permissions })
        .eq("id", editingRoleId);
      if (error) throw error;
      const cached = serverRolesCache.find((r) => r.id === editingRoleId);
      if (cached) { cached.name = name; cached.role = name; cached.color = color; cached.permissions = permissions; }
      await syncDiscordRole("update", { id: editingRoleId, name, color });
    }
    renderServerRolesList();
    setServerRolesError("");
    if (typeof showToast === "function") showToast("✅ Role saved.");
    else alert("✅ Role saved.");
    // Refresh the current user's permissions in case their own role changed.
    if (serverId === currentServerId) await refreshServerRole();
  } catch (err) {
    console.error("saveCurrentRole failed", err);
    setServerRolesError("Save failed: " + err.message);
  }
}

async function deleteCurrentRole() {
  if (!editingRoleId) return;
  const role = serverRolesCache.find((r) => r.id === editingRoleId);
  if (!role) return;
  if (!confirm(`Delete the role "${role.name || role.role}"? Members with this role will fall back to "User".`)) return;
  try {
    // Drop role assignments first so we don't leave dangling FK references.
    await supabaseClient
      .from("server_member_roles")
      .delete()
      .eq("role_id", editingRoleId);
    await supabaseClient
      .from("server_members")
      .update({ primary_role_id: null })
      .eq("primary_role_id", editingRoleId);
    const { error } = await supabaseClient
      .from("server_roles")
      .delete()
      .eq("id", editingRoleId);
    if (error) throw error;
    await syncDiscordRole("delete", { id: editingRoleId });
    serverRolesCache = serverRolesCache.filter((r) => r.id !== editingRoleId);
    editingRoleId = null;
    document.getElementById("serverRolesEditor").style.display = "none";
    renderServerRolesList();
    if (typeof showToast === "function") showToast("🗑️ Role deleted.");
    if (currentServerOptionsTargetId === currentServerId) await refreshServerRole();
  } catch (err) {
    console.error("deleteCurrentRole failed", err);
    setServerRolesError("Delete failed: " + err.message);
  }

  async function syncDiscordRole(operation, role) {
    if (!currentServerOptionsTargetId || !role?.id) return;
    const { data: mapping } = await supabaseClient
      .from("discord_servers")
      .select("id")
      .eq("server_id", currentServerOptionsTargetId)
      .maybeSingle();
    if (!mapping) return;
    const response = await fetch(`${supabaseUrl}/functions/v1/discord-message-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "manage_role",
        operation,
        server_id: currentServerOptionsTargetId,
        role_id: role.id,
        name: role.name,
        color: role.color
      })
    });
    if (!response.ok) {
      console.error("Discord role synchronization failed:", await response.text());
    }
  }
}

(function wireServerRolesModal() {
  const modal = document.getElementById("serverRolesModal");
  if (!modal) return;
  document.getElementById("closeServerRolesModal").addEventListener("click", closeServerRolesModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeServerRolesModal(); });
  document.getElementById("createServerRoleBtn").addEventListener("click", startNewRole);
  document.getElementById("saveServerRoleBtn").addEventListener("click", saveCurrentRole);
  document.getElementById("deleteServerRoleBtn").addEventListener("click", deleteCurrentRole);
})();

// --- Click Handlers for Usernames ---
// Add this to your existing click handlers for usernames in messages/member list

// 1. In createMessageElement (or wherever you render usernames)
// Ensure the username span has a click handler
// Example modification in createMessageElement:
// const header = document.createElement("div");
// header.className = "username";
// header.innerHTML = `${escapeHTML(displayName(msg.username))}<span class="msg-timestamp">${timestamp}</span>`;
// header.style.cursor = "pointer"; // Add cursor
// header.addEventListener("click", (e) => {
//   e.stopPropagation();
//   openUserProfile(msg.username, currentServerId);
// });

// 2. In renderMemberList (for member list items)
// Modify the item creation:
// item.addEventListener("click", async () => {
//   if (m.username === username) {
//     // If clicking own name in member list, open profile
//     openUserProfile(m.username, currentServerId);
//   } else {
//     // Existing DM logic
//     const conversationId = await ensureDirectConversation(m.username);
//     await loadDirectConversations();
//     await openDirectConversation(conversationId);
//   }
// });

function enableBioEdit(currentBio) {
  const descEl = document.getElementById("profileDescription");
  if (!descEl) return;

  // Create textarea
  const textarea = document.createElement("textarea");
  textarea.className = "bio-edit-area";
  textarea.value = currentBio;
  textarea.placeholder = "Write your bio...";

  // Create buttons
  const saveBtn = document.createElement("button");
  saveBtn.className = "bio-save-btn";
  saveBtn.textContent = "Save Bio";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "bio-cancel-btn";
  cancelBtn.textContent = "Cancel";

  // Replace content
  descEl.innerHTML = "";
  descEl.appendChild(textarea);
  descEl.appendChild(saveBtn);
  descEl.appendChild(cancelBtn);

  textarea.focus();

  // Save Handler
  saveBtn.onclick = async () => {
    const newBio = textarea.value.trim();
    if (!currentServerId || !username) return;

    const { error } = await supabaseClient
      .from("server_members")
      .update({ profile_description: newBio })
      .eq("server_id", currentServerId)
      .eq("username", username);

    if (error) {
      alert("❌ Failed to save bio: " + error.message);
      return;
    }

    // Update local cache
    const existing = getServerProfileData(currentServerId, username) || {};
    setServerProfileData(currentServerId, username, {
      ...existing,
      description: newBio
    });

    // Re-render modal
    openUserProfile(username, currentServerId);
  };

  // Cancel Handler
  cancelBtn.onclick = () => {
    openUserProfile(username, currentServerId);
  };

  // Save on Ctrl+Enter
  textarea.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
      saveBtn.click();
    }
  });
}

async function checkLinkedIdentities() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  const username = localStorage.getItem("chatUsername") || window.chatUsername;

  let discordLinked = !!(window.discordAccount || discordAccount);
  if (!discordLinked && username) {
    try {
      const { data } = await supabaseClient
        .from("discord_accounts")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      discordLinked = !!data;
    } catch (e) {}
  }

  const identities = user?.identities || [];
  if (!discordLinked) {
    discordLinked = identities.some(id => id.provider === 'discord');
  }

  return {
    google: identities.some(id => id.provider === 'google'),
    github: identities.some(id => id.provider === 'github'),
    discord: discordLinked,
    azure: identities.some(id => id.provider === 'azure')
  };
}

async function unlinkOAuthIdentity(provider) {
  console.log(`🔄 Attempting to unlink ${provider}...`);

  if (provider === 'discord') {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const identity = user?.identities?.find(id => id.provider === 'discord');

    if (identity && typeof supabaseClient.auth.unlinkIdentity === "function") {
      try {
        const { error } = await supabaseClient.auth.unlinkIdentity(identity);
        if (error) {
          console.warn("Could not unlink Discord auth identity:", error);
        }
      } catch (err) {
        console.warn("Discord auth unlink failed:", err);
      }
    }

    if (typeof disconnectDiscordAccount === "function") {
      await disconnectDiscordAccount();
    }
    return;
  }

  // 1. Check if user is logged in
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    showLinkStatus(`❌ You must be logged in to unlink accounts.`, "error");
    return;
  }

  // 2. Find the identity to unlink
  const identity = user.identities?.find(id => id.provider === provider);
  if (!identity) {
    showLinkStatus(`❌ ${provider} account is not linked.`, "error");
    return;
  }

  // 3. Unlink the identity using the user-facing Supabase API.
  let unlinkError = null;
  try {
    if (typeof supabaseClient.auth.unlinkIdentity === "function") {
      const { error } = await supabaseClient.auth.unlinkIdentity(identity);
      unlinkError = error || null;
    } else {
      unlinkError = new Error("Your Supabase client is too old to support unlinkIdentity. Please update it.");
    }
  } catch (err) {
    unlinkError = err;
  }

  if (unlinkError) {
    console.error("❌ Unlink Error:", unlinkError);
    showLinkStatus(`❌ Failed to unlink ${provider}: ${unlinkError.message || unlinkError}`, "error");
    return;
  }

  // Refresh the auth user so user.identities reflects the new state.
  try { await supabaseClient.auth.refreshSession(); } catch {}

  console.log(`✅ Successfully unlinked ${provider}`);
  showLinkStatus(`✅ ${provider} account unlinked successfully!`, "success");

  // 4. Update the button states
  await updateAccountLinkButtons();
}

async function updateAccountLinkButtons() {
  const linked = await checkLinkedIdentities();

  const buttons = {
    google: document.getElementById("linkGoogleBtn"),
    github: document.getElementById("linkGithubBtn"),
    discord: document.getElementById("linkDiscordBtn"),
    azure: document.getElementById("linkAzureBtn"),
    spotify: document.getElementById("linkSpotifyBtn")
  };

  const providerNames = {
    google: "Google",
    github: "GitHub",
    discord: "Discord",
    azure: "Azure",
    spotify: "Spotify"
  };

  const providerIcons = {
    google: "🔵",
    github: "🐙",
    discord: "💬",
    azure: "🐦",
    spotify: "🎵"
  };

  let spotifyLinked = false;
  try {
    const { data: spotifyRow, error } = await supabaseClient.from('users').select('spotify_access_token').eq('username', username).maybeSingle();
    spotifyLinked = !error && !!spotifyRow?.spotify_access_token;
  } catch (err) {
    console.warn('Could not determine Spotify linked state:', err);
  }

  linked.spotify = spotifyLinked;

  Object.keys(buttons).forEach(provider => {
    const button = buttons[provider];
    if (!button) return;

    if (linked[provider]) {
      button.innerHTML = `<span style="margin-right: 8px;">${providerIcons[provider]}</span> ${providerNames[provider]} Linked`;
      button.style.background = "linear-gradient(135deg, #22c55e, #16a34a)";
      button.onclick = async () => {
        if (provider === 'spotify') {
          if (confirm('Disconnect your Spotify account?')) {
            await unlinkSpotify();
            await updateAccountLinkButtons();
          }
          return;
        }
        if (provider === 'discord') {
          if (confirm('Are you sure you want to disconnect your Discord account?')) {
            await disconnectDiscordAccount();
          }
          return;
        }
        if (confirm(`Are you sure you want to unlink your ${providerNames[provider]} account?`)) {
          await unlinkOAuthIdentity(provider);
        }
      };
    } else {
      button.innerHTML = `<span style="margin-right: 8px;">${providerIcons[provider]}</span> Link ${providerNames[provider]} Account`;

      const originalGradients = {
        google: "linear-gradient(135deg, #4285f4, #34a853)",
        github: "linear-gradient(135deg, #24292e, #5865f2)",
        discord: "linear-gradient(135deg, #5865f2, #99aab5)",
        azure: "linear-gradient(135deg, #1da1f2, #14171a)",
        spotify: "linear-gradient(135deg, #1db954, #1da1f2)"
      };
      button.style.background = originalGradients[provider];
      button.onclick = async () => {
        if (provider === 'spotify') {
          await linkSpotify();
          setTimeout(() => updateAccountLinkButtons(), 1200);
        } else if (provider === 'discord') {
          if (typeof initiateDiscordOAuth === "function") {
            initiateDiscordOAuth();
          }
        } else {
          await linkOAuthIdentity(provider);
        }
      };
    }

    if (provider === 'spotify') {
      const unlinkBtn = document.getElementById('unlinkSpotifyBtn');
      if (unlinkBtn) {
        unlinkBtn.style.display = linked.spotify ? 'inline-block' : 'none';
      }
    }
  });
}

async function updateProfileAuthButtons() {
  const isOwnProfile = currentProfileUsername === username;
  if (!isOwnProfile) return;

  const linked = await checkLinkedIdentities();

  const googleBtn = document.getElementById("profileLinkGoogleBtn");
  const githubBtn = document.getElementById("profileLinkGithubBtn");

  if (googleBtn) {
    if (linked.google) {
      googleBtn.textContent = "✅ Google Linked";
      googleBtn.disabled = true;
      googleBtn.classList.add("modal-btn-secondary"); // Optional: style it differently
      googleBtn.style.opacity = "0.7";
    } else {
      googleBtn.textContent = "Link Google";
      googleBtn.disabled = false;
      googleBtn.style.opacity = "1";
    }
  }

  if (githubBtn) {
    if (linked.github) {
      githubBtn.textContent = "✅ Github Linked";
      githubBtn.disabled = true;
      githubBtn.classList.add("modal-btn-secondary");
      githubBtn.style.opacity = "0.7";
    } else {
      githubBtn.textContent = "Link Github";
      githubBtn.disabled = false;
      githubBtn.style.opacity = "1";
    }
  }
}

// --- SAFE MODAL LISTENER ATTACHMENT ---
// (Legacy: the in-profile "Link Accounts" button was moved to User Settings → Connections.
//  These listeners now only attach if the legacy modal still exists; otherwise no-op.)
function setupAccountLinkListeners() {
  const openBtn = document.getElementById("openAccountLinkModal");
  const closeBtn = document.getElementById("closeAccountLinkModal");
  const modal = document.getElementById("accountLinkModal");

  if (!openBtn || !closeBtn || !modal) {
    // Legacy modal/button no longer exists — silently skip.
    return;
  }

  console.log("✅ Account Link Modal listeners attached successfully.");

  // 2. Open Listener
  openBtn.addEventListener("click", async () => {
    // Double check ownership
    if (currentProfileUsername && currentProfileUsername !== username) {
      alert("You can only link accounts for your own profile.");
      return;
    }

    // Debug log
    console.log("🔓 Opening Account Link Modal for:", currentProfileUsername);

    // Update button states before showing modal
    await updateAccountLinkButtons();

    modal.style.display = "flex";
  });

  // 3. Close Listener
  closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // 4. Backdrop Click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  }

// Run immediately
setupAccountLinkListeners();

// Also run on DOMContentLoaded just in case
document.addEventListener("DOMContentLoaded", setupAccountLinkListeners);

// --- FORCE RE-ATTACH LISTENERS FOR ACCOUNT LINK MODAL ---
function forceAttachAccountLinkListeners() {
  const modal = document.getElementById("accountLinkModal");
  const closeBtn = document.getElementById("closeAccountLinkModal");
  const linkGoogle = document.getElementById("linkGoogleBtn");
  const linkGithub = document.getElementById("linkGithubBtn");
  const linkDiscord = document.getElementById("linkDiscordBtn");
  const linkAzure = document.getElementById("linkAzureBtn");
 // const linkSpotify = document.getElementById("linkSpotifyBtn");

  console.log("🔧 Forcing account link listeners...");


  // Close on backdrop click
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        console.log("✅ Backdrop clicked");
        modal.style.display = "none";
      }
    };
  }
}

// Run immediately
forceAttachAccountLinkListeners();

// Also run on DOMContentLoaded just in case
document.addEventListener("DOMContentLoaded", forceAttachAccountLinkListeners);

const openBtn = document.getElementById("openAccountLinkModal");
const closeBtn = document.getElementById("closeAccountLinkModal");
const modal = document.getElementById("accountLinkModal");

if (openBtn && closeBtn && modal) {
  openBtn.addEventListener("click", () => { modal.style.display = "flex"; });
  closeBtn.addEventListener("click", () => { modal.style.display = "none"; });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
}
