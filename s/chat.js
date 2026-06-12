// ======================== CHANNEL RIGHT-CLICK MENU ========================
channelList.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!userPermissions.manage_roles) return;

  const channelEl = e.target.closest(".channel");
  if (!channelEl) return;

  const channelId = parseInt(channelEl.dataset.id, 10);
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return;

  showContextMenu(document.getElementById("channelMenu"), e.clientX, e.clientY, [
    // Renaming is disabled in the inline row. 
    // If you have a modal for renaming, replace the action below:
    // { label: "Rename Channel", color: "white", action: () => openModal('renameChannelModal') }, 

    { label: "Edit Permissions", color: "white", action: () => openChannelPermsModal(channelId) },
    { label: "Delete Channel", color: "#ed4245", action: () => showInlineDelete("channel", channelId, ch.name) }
  ]);
});

// Close channel/category menus on any click
document.addEventListener("click", () => {
  document.getElementById("channelMenu").style.display = "none";
  const mm = document.getElementById("memberMenu");
  if (mm) mm.style.display = "none";
  const cm = document.getElementById("categoryMenu");
  if (cm) cm.style.display = "none";
});

function showContextMenu(menuEl, x, y, items) {
  menuEl.innerHTML = "";
  const isMobile = window.innerWidth <= 768;

  const fragment = document.createDocumentFragment();
  items.forEach(({ label, color, action }) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "context-menu-item";
    if (color) btn.style.color = color;
    btn.onclick = (ev) => { 
      ev.stopPropagation(); 
      menuEl.style.display = "none"; 
      action(); 
    };
    fragment.appendChild(btn);
  });
  menuEl.appendChild(fragment);

  menuEl.style.display = "block";
  menuEl.style.visibility = "hidden";

  if (isMobile) {
    menuEl.style.left = "8px";
    menuEl.style.right = "8px";
    menuEl.style.bottom = "max(8px, env(safe-area-inset-bottom))";
    menuEl.style.top = "auto";
    menuEl.style.width = "auto";
    menuEl.style.borderRadius = "12px 12px 0 0";
    menuEl.classList.add("mobile-sheet");
  } else {
    menuEl.classList.remove("mobile-sheet");
    menuEl.style.width = "min(220px, calc(100vw - 16px))";
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    let left = x + 4;
    let top = y + 4;
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    menuEl.style.left = left + "px";
    menuEl.style.top = top + "px";
    menuEl.style.right = "auto";
    menuEl.style.bottom = "auto";
  }
  menuEl.style.visibility = "visible";
}

function showCategoryContextMenu(catName, x, y) {
  const menu = document.getElementById("categoryMenu");
  showContextMenu(menu, x, y, [
    { label: "Rename Category", color: "white", action: () => openInlineRow("category-rename", catName, null) },
    { label: "Delete Category", color: "#ed4245", action: () => showInlineDeleteCategory(catName) }
  ]);
}

async function setMemberServerRole(targetMember, nextRole) {
  if (!targetMember?.id || !currentServerId) return;
  const cleanedRole = normalizeServerRole(nextRole);
  if (!cleanedRole) return;

  const { data: roleRow } = await supabaseClient
    .from("server_roles")
    .select("id")
    .eq("server_id", currentServerId)
    .or(`name.eq.${cleanedRole},role.eq.${cleanedRole}`)
    .maybeSingle();

  const updateData = {
    primary_role_id: roleRow?.id || null
  };

  const { error } = await supabaseClient
    .from("server_members")
    .update(updateData)
    .eq("id", targetMember.id)
    .eq("server_id", currentServerId);

  if (error) {
    alert("❌ Failed to update role: " + error.message);
    return;
  }

  await supabaseClient
    .from("server_member_roles")
    .delete()
    .eq("server_id", currentServerId)
    .eq("member_id", targetMember.id);

  await loadServerMembers();
}

async function addMemberToAnotherServer(targetMember) {
  if (!targetMember?.username) return;
  if (!servers.length) {
    alert("❌ No servers available.");
    return;
  }

  const serverChoices = servers
    .filter(s => s.id !== currentServerId)
    .map((s, i) => `${i + 1}. ${s.name} (${s.slug})`)
    .join("\n");
  if (!serverChoices) {
    alert("ℹ️ No other servers available.");
    return;
  }

  const picked = prompt(
    `Add ${targetMember.username} to which server?\n\n${serverChoices}\n\nEnter the number or server slug:`
  );
  if (!picked) return;

  const trimmed = picked.trim();
  let targetServer = null;
  const byNumber = Number(trimmed);
  if (Number.isInteger(byNumber) && byNumber > 0) {
    targetServer = servers.filter(s => s.id !== currentServerId)[byNumber - 1] || null;
  }
  if (!targetServer) {
    targetServer = servers.find(s => s.slug === trimmed || s.name === trimmed || s.id === trimmed) || null;
  }
  if (!targetServer) {
    alert("❌ Server not found.");
    return;
  }

  const { data: existing } = await supabaseClient
    .from("server_members")
    .select("id")
    .eq("server_id", targetServer.id)
    .eq("username", targetMember.username)
    .maybeSingle();
  if (existing) {
    alert(`ℹ️ ${targetMember.username} is already in ${targetServer.name}.`);
    return;
  }

  const { error } = await supabaseClient.from("server_members").insert({
    server_id: targetServer.id,
    username: targetMember.username,
    role: "User",
    primary_role_id: null
  });
  if (error) {
    alert("❌ Failed to add member: " + error.message);
    return;
  }
  alert(`✅ Added ${targetMember.username} to ${targetServer.name} as a User.`);
}

// ======================== CHANNEL + CATEGORY ADMIN ACTIONS ========================

// ---- Inline Row helpers ----
function openInlineRow(mode, prefill, targetId) {
  const row = document.getElementById("newChannelRow");
  const inp = document.getElementById("newChannelInput");
  const label = document.getElementById("newChannelLabel");
  const createChannelBtn = document.getElementById("createChannelBtn");
  const createCategoryBtn = document.getElementById("createCategoryBtn");

  row.dataset.mode = mode;
  row.dataset.targetId = targetId ?? "";
  row.dataset.targetName = prefill ?? "";

  const labels = {
    "channel-create": "Create Channel",
    "channel-rename": "Rename channel:",
    "category-create": "New category:",
    "category-rename": "Rename category:"
  };
  label.textContent = labels[mode] || "";

  // Remove any extra inputs
  const extraInputs = row.querySelectorAll(".extra-input");
  extraInputs.forEach(el => el.remove());

  if (mode === "channel-create") {
    // Add category input
    const catInput = document.createElement("input");
    catInput.type = "text";
    catInput.className = "extra-input";
    catInput.placeholder = "category-name";
    catInput.maxLength = 32;
    row.insertBefore(catInput, inp);
    inp.placeholder = "channel-name";
  } else {
    inp.placeholder = mode.includes("channel") ? "channel-name" : "category-name";
  }

  inp.value = prefill || "";
  inp.focus();
  inp.select();

  createChannelBtn.style.display = "none";
  if (createCategoryBtn) createCategoryBtn.style.display = "none";
  row.style.display = "flex";
  inp.focus();
  inp.select();
}

function closeInlineRow() {
  const row = document.getElementById("newChannelRow");
  row.style.display = "none";
  row.dataset.mode = "";
  if (userPermissions.manage_roles) {
    const createChannelBtn = document.getElementById("createChannelBtn");
    const createCategoryBtn = document.getElementById("createCategoryBtn");
    if (createChannelBtn) createChannelBtn.style.display = "inline-block";
    if (createCategoryBtn) createCategoryBtn.style.display = "inline-block";
  }
}

function showInlineDelete(type, id, name) {
  // Remove any existing delete bar
  document.querySelectorAll(".inline-delete-bar").forEach(el => el.remove());

  const bar = document.createElement("div");
  bar.className = "inline-delete-bar";
  bar.innerHTML = `<span>Delete <b>#${name}</b>?</span>`;

  const yes = document.createElement("button");
  yes.className = "inline-delete-yes";
  yes.textContent = "Delete";

  const no = document.createElement("button");
  no.className = "inline-delete-no";
  no.textContent = "Cancel";

  yes.onclick = async (e) => {
    e.stopPropagation();
    bar.remove();
    if (type === "channel") await performDeleteChannel(id, name);
  };
  no.onclick = (e) => { e.stopPropagation(); bar.remove(); };

  bar.appendChild(yes);
  bar.appendChild(no);

  const channelEl = document.querySelector(`.channel[data-id="${id}"]`);
  if (channelEl) channelEl.parentNode.insertBefore(bar, channelEl.nextSibling);
}

function showInlineDeleteCategory(catName) {
  document.querySelectorAll(".inline-delete-bar").forEach(el => el.remove());

  const bar = document.createElement("div");
  bar.className = "inline-delete-bar";
  bar.innerHTML = `<span>Delete <b>${catName}</b>?</span>`;

  const yes = document.createElement("button");
  yes.className = "inline-delete-yes";
  yes.textContent = "Delete";

  const no = document.createElement("button");
  no.className = "inline-delete-no";
  no.textContent = "Cancel";

  yes.onclick = async (e) => {
    e.stopPropagation();
    bar.remove();
    await performDeleteCategory(catName);
  };
  no.onclick = (e) => { e.stopPropagation(); bar.remove(); };

  bar.appendChild(yes);
  bar.appendChild(no);

  const block = document.querySelector(`.category-block[data-category-name="${catName}"]`);
  if (block) block.parentNode.insertBefore(bar, block.nextSibling);
}

// ---- Channel CRUD ----
async function performCreateChannel(name, categoryName, type = 'text') {
  const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!trimmed) return;

  if (!currentServerId) {
    console.error("❌ No server selected");
    return;
  }

  // ... (Category logic remains the same) ...
  let cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase() && c.server_id === currentServerId);
  if (!cat) {
     // ... (Create category logic) ...
     const sortOrder = categories
      .filter(c => c.server_id === currentServerId)
      .reduce((maxOrder, category) => Math.max(maxOrder, Number(category.sort_order) || 0), -1) + 1;

     const { data: newCat, error: catError } = await supabaseClient
      .from("categories")
      .insert({
        name: categoryName.trim(),
        sort_order: sortOrder,
        created_by: username,
        server_id: currentServerId
      })
      .select()
      .single();

      if (catError) {
        console.error("❌ Create category:", catError.message);
        return;
      }
      categories.push(newCat);
      cat = newCat;
  }

  const sortOrder = channels
    .filter(c => c.server_id === currentServerId)
    .reduce((maxOrder, channel) => Math.max(maxOrder, Number(channel.sort_order) || 0), -1) + 1;

  // INSERT THE NEW TYPE FIELD
  const { data, error } = await supabaseClient
    .from("channels")
    .insert({
      name: trimmed,
      created_by: username,
      sort_order: sortOrder,
      server_id: currentServerId,
      category_id: cat.id,
      channel_type: type // <-- NEW: 'text' or 'voice'
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Create channel:", error.message);
    return;
  }

  channels.push(data);
  renderChannelList();

  // If it's a voice channel, maybe switch to it? Or just show it.
  if (type === 'voice') {
    // Optional: Auto-join voice? Or just let them click it.
    // switchChannel(data.id); 
  } else {
    switchChannel(data.id);
  }
}

async function performRenameChannel(channelId, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;

  const { error } = await supabaseClient.from("channels").update({ name: trimmed }).eq("id", channelId);
  if (error) { console.error("❌ Rename channel:", error.message); return; }

  const ch = channels.find(c => c.id === channelId);
  if (ch) ch.name = trimmed;
  renderChannelList();
  if (currentChannelId === channelId) {
    document.getElementById("currentChannelName").textContent = "# " + trimmed;
  }
}

async function performDeleteChannel(channelId) {
  // Collect message ids first so we can clear dependent rows safely.
  const { data: channelMessages, error: msgFetchErr } = await supabaseClient
    .from("messages")
    .select("id")
    .eq("channel_id", channelId);
  if (msgFetchErr) {
    console.error("❌ Delete channel (fetch messages):", msgFetchErr.message);
    alert("❌ Failed to delete channel: " + msgFetchErr.message);
    return;
  }

  const messageIds = (channelMessages || []).map(m => m.id);

  if (messageIds.length) {
    // Remove reaction rows that reference messages in this channel.
    const { error: reactionsErr } = await supabaseClient
      .from("reactions")
      .delete()
      .in("message_id", messageIds);
    if (reactionsErr) {
      console.error("❌ Delete channel (reactions):", reactionsErr.message);
      alert("❌ Failed to delete channel reactions: " + reactionsErr.message);
      return;
    }

    // Clear reply pointers in any message that references soon-to-be deleted messages.
    const { error: clearRepliesErr } = await supabaseClient
      .from("messages")
      .update({ reply_to: null })
      .in("reply_to", messageIds);
    if (clearRepliesErr) {
      console.error("❌ Delete channel (clear reply pointers):", clearRepliesErr.message);
      alert("❌ Failed to clear message replies: " + clearRepliesErr.message);
      return;
    }
  }

  const { error: presenceErr } = await supabaseClient
    .from("channel_presence")
    .delete()
    .eq("server_id", currentServerId)
    .eq("channel_id", channelId);
  if (presenceErr) {
    console.error("❌ Delete channel (presence):", presenceErr.message);
    alert("❌ Failed to delete channel presence: " + presenceErr.message);
    return;
  }

  const { error: deleteMsgsErr } = await supabaseClient
    .from("messages")
    .delete()
    .eq("channel_id", channelId);
  if (deleteMsgsErr) {
    console.error("❌ Delete channel (messages):", deleteMsgsErr.message);
    alert("❌ Failed to delete channel messages: " + deleteMsgsErr.message);
    return;
  }

  const { error } = await supabaseClient.from("channels").delete().eq("id", channelId);
  if (error) {
    console.error("❌ Delete channel:", error.message);
    alert("❌ Failed to delete channel: " + error.message);
    return;
  }

  channels = channels.filter(c => c.id !== channelId);
  renderChannelList();
  if (currentChannelId === channelId && channels.length > 0) switchChannel(channels[0].id);
}

// ---- Category CRUD ----
async function performCreateCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  if (!currentServerId) {
    console.error("❌ No server selected");
    return;
  }

  const sortOrder = categories
    .filter(c => c.server_id === currentServerId)
    .reduce((maxOrder, category) => Math.max(maxOrder, Number(category.sort_order) || 0), -1) + 1;

  const { data, error } = await supabaseClient
    .from("categories")
    .insert({
      name: trimmed,
      sort_order: sortOrder,
      created_by: username,
      server_id: currentServerId
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Create category:", error.message);
    return;
  }

  categories.push(data);
  renderChannelList();
}

async function performRenameCategory(oldName, newName) {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;

  const cat = categories.find(c => c.name === oldName);
  if (cat) {
    const { error } = await supabaseClient.from("categories").update({ name: trimmed }).eq("id", cat.id);
    if (error) { console.error("❌ Rename category:", error.message); return; }
    cat.name = trimmed;
  }
  // Channels reference the category by category_id (uuid), not by name text — no channel update needed
  renderChannelList();
}

async function performDeleteCategory(catName) {
  const cat = categories.find(c => c.name === catName);
  if (!cat) return;

  // Find or create a "General" fallback category for orphaned channels
  let generalCat = categories.find(c => c.name === "General" && c.id !== cat.id);
  if (!generalCat) {
    const generalSortOrder = categories
      .filter(c => c.server_id === currentServerId)
      .reduce((maxOrder, category) => Math.max(maxOrder, Number(category.sort_order) || 0), -1) + 1;
    const { data: genData } = await supabaseClient
      .from("categories")
      .insert({ name: "General", sort_order: generalSortOrder, created_by: username, server_id: currentServerId })
      .select()
      .maybeSingle();
    if (genData) { categories.push(genData); generalCat = genData; }
  }

  // Reassign orphaned channels by category_id
  const orphans = channels.filter(c => c.category_id === cat.id);
  if (orphans.length > 0) {
    const newCatId = generalCat ? generalCat.id : null;
    await supabaseClient.from("channels").update({ category_id: newCatId }).eq("category_id", cat.id);
    orphans.forEach(c => { c.category_id = newCatId; });
  }

  await supabaseClient.from("categories").delete().eq("id", cat.id);
  categories = categories.filter(c => c.id !== cat.id);
  renderChannelList();
}

async function deleteChannel(channelId, channelName) {
  // Legacy compat — just call the inline delete show
  showInlineDelete("channel", channelId, channelName);
  return; // old code below kept as dead code just in case

}


async function switchChannel(channelId) {
  // 🔥 If currently in a voice channel, leave it before switching to a text channel
  if (currentVoiceChannelId) {
    leaveVoiceChannel();
  }

  // 🔥 CRITICAL: Set this IMMEDIATELY
  currentConversationType = "channel";
  currentDmConversationId = null;
  currentChannelId = channelId;

  // Remember the last text channel so we can return to it after a VC disconnect.
  const _switchedCh = channels.find(c => c.id === channelId);
  if (_switchedCh && _switchedCh.channel_type !== 'voice') {
    lastTextChannelId = channelId;
  }
  console.log("🔄 switchChannel called. currentChannelId set to:", currentChannelId);

  // Highlight selected channel
  document.querySelectorAll(".channel").forEach(el => {
    el.classList.remove("active");
  });

  const selected = document.querySelector(`[data-id="${channelId}"]`);
  if (selected) selected.classList.add("active");

  // Update header
  const ch = channels.find(c => c.id === channelId);
  if (ch) {
    document.getElementById("currentChannelName").textContent = "# " + ch.name;
  }
  updateConversationHeaderAndInput();
  renderDmList();
  subscribeToCurrentDmConversation(null);

  // 🔥 CLEAR AND LOAD MESSAGES
  messagesList.innerHTML = "";
  messagesMap.clear();
  messageDataMap.clear();
  clearReactionCaches();
  hideMentionSuggestions();

  // 🔥 Call loadMessages
  await loadMessages(); // Make it await so we wait for messages to load

  // 🔥 CRITICAL: Mark this channel as read immediately upon loading
  await markCurrentChannelAsRead();

  // 🔥 Subscribe to realtime for THIS specific channel
  subscribeToCurrentChannel();

  // Update channel presence for member list
  updateChannelPresence(channelId);

  setTimeout(() => {
    waitForImagesBeforeScroll();
  }, 100);
}
// ------------------------ Load Messages ------------------------
async function loadMessages() {
  if (!currentChannelId) return;

  // Faster loading UI
  messagesList.innerHTML = '<div class="loading-shimmer"></div>';
  messagesMap.clear();
  messageDataMap.clear();
  clearReactionCaches();

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("channel_id", currentChannelId)
    .order("inserted_at", { ascending: true });

  if (error) {
    messagesList.innerHTML = `<li class="error">Error: ${error.message}</li>`;
    return;
  }

  const messageIds = (data || []).map((msg) => msg.id);
  const [{ data: reactions, error: reactionsError }] = await Promise.all([
    messageIds.length > 0
      ? supabaseClient.from("reactions").select("*").in("message_id", messageIds)
      : Promise.resolve({ data: [], error: null }),
    loadAvatarMapForUsernames((data || []).map((msg) => msg.username))
  ]);

  if (reactionsError) {
    console.error("❌ Error preloading reactions:", reactionsError);
  } else {
    const reactionsByMessageId = new Map();
    (reactions || []).forEach((reaction) => {
      const key = Number(reaction.message_id);
      if (!reactionsByMessageId.has(key)) reactionsByMessageId.set(key, []);
      reactionsByMessageId.get(key).push(reaction);
    });
    messageIds.forEach((messageId) => {
      setReactionSnapshot(messageId, reactionsByMessageId.get(messageId) || []);
    });
  }

  messagesList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  data.forEach(msg => {
    const li = createMessageElement(msg);
    messagesMap.set(msg.id, li);
    messageDataMap.set(msg.id, msg);
    fragment.appendChild(li);
  });
  messagesList.appendChild(fragment);
  applyMessageSearchFilter();

  await waitForImagesBeforeScroll();
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function renderMentionToken(name) {
  const normalizedName = String(name || "");
  const isMine = normalizedName.toLowerCase() === String(username || "").toLowerCase();
  const mentionClass = isMine ? "mention mine" : "mention";
  return `<span class="${mentionClass}"><span class="mention-mark">@</span><span class="mention-name">${escapeHTML(normalizedName)}</span></span>`;
}

async function waitForImagesBeforeScroll(container = messagesList, timeoutMs = 2000) {
  if (!container) return;

  const images = [...container.querySelectorAll("img")].filter((img) => !img.complete);
  if (images.length === 0) {
    scrollToBottom();
    return;
  }

  await Promise.race([
    Promise.all(images.map((img) => new Promise((resolve) => {
      const done = () => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        resolve();
      };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }))),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);

  scrollToBottom();
}


// ======================== FULL FIXED loadUser FUNCTION ========================
async function loadUser() {
  console.log("🚀 loadUser() STARTED");

  const storedName = localStorage.getItem("chatUsername");

  if (!storedName) {
    console.error("⚠️ No username found in localStorage despite being authenticated.");
    await supabaseClient.auth.signOut();
    location.reload();
    return;
  }

  username = storedName;
  console.log("📝 Loaded username:", username);

  nameInput.value = username;
  if (namePrompt) namePrompt.style.display = "none";

  const controls = document.getElementById("controls");
  if (controls) controls.classList.add("visible");

  const input = document.getElementById("messageInput");
  const button = document.getElementById("sendButton");
  if (input) input.disabled = false;
  if (button) button.disabled = false;
  updateProfileButton();

  try {
    console.log("📡 Fetching user data from users table for:", username);
    // SCHEMA MATCH: Select 'system_role', 'sys_admin', 'sys_manager', 'muted_until'
    const { data, error } = await supabaseClient
      .from("users")
      .select("sys_admin, sys_manager, blocked, muted_until, auth_id, avatar_url, notification_preferences, profile_status, profile_description, custom_theme_id, system_role")
      .eq("username", username)
      .maybeSingle();

    console.log("   User data:", data);
    console.log("   Error:", error);

    if (!data) {
      console.warn("⚠️ User record not found in database! Creating one...");
      const authId = (await supabaseClient.auth.getUser())?.data?.user?.id;
      if (authId) {
        await supabaseClient.from("users").insert({
          username,
          auth_id: authId,
          system_role: "User",
          sys_admin: false,
          sys_manager: false
        });
        console.log("✅ Created user record");
      }
    }

    isBlocked = false; // Reset per-server block state
    mutedUntil = null;
    
    // SCHEMA MATCH: Read 'muted_until' (global mute)
    globalMutedUntil = data?.muted_until || null;
    
    currentNotificationPrefs = Object.assign(
      { mentions: true, replies: true, all_messages: false },
      data?.notification_preferences || {}
    );
    currentCustomStatus = data?.profile_status || "";
    currentBio = data?.profile_description || "";
    currentThemeId = data?.custom_theme_id || null;
    setAvatarUrl(username, data?.avatar_url || "");
    
    loadThemesAndApply().catch(err => console.warn("Theme load failed:", err));

    // SCHEMA MATCH: Determine System Role from Booleans
    if (data?.sys_admin) {
      currentSystemRole = "SysAdmin";
      console.log("👑 User is SysAdmin!");
    } else if (data?.sys_manager) {
      currentSystemRole = "SysManager";
      console.log("🔧 User is SysManager!");
    } else {
      currentSystemRole = "User";
      console.log("👤 User is regular User");
    }

    // SCHEMA MATCH: Determine Server Role from 'system_role' text
    currentRole = normalizeServerRole(data?.system_role || "User");

    localStorage.setItem("chatSysAdmin", currentSystemRole === "SysAdmin" ? "true" : "false");
    localStorage.setItem("chatSysManager", currentSystemRole === "SysManager" ? "true" : "false");
    localStorage.setItem("chatRole", currentRole);
    
    console.log("🔐 System role set to:", currentSystemRole);
    console.log("🔐 Server role set to:", currentRole);

  } catch (err) {
    console.error("❌ Error fetching user data:", err);
  }

  // Default per-server permissions until refreshServerRole() runs
  loadUserPermissions(currentRole);

  initRealtime();
  subscribeToTyping();
  subscribeToServerMemberships();
  subscribeToDirectMessages();

  initServerModals();
  await loadDirectConversations();
  await loadServers();
  await checkInviteOnLoad();

  watchForceLogout(username);
  subscribeToUserStatus();
  applyMuteBlockUI();
  await enablePush();

  console.log("🎉 loadUser() completed successfully.");
}

// ------------------------ Save Name ------------------------
async function saveName() {
  const name = nameInput.value.trim();
  if (!name) return alert("❌ Enter a name first!");

  username = name;
  localStorage.setItem("chatUsername", name);

  try {
    // 1. Check if user exists
    const { data: existingUser, error: checkError } = await supabaseClient
      .from("users")
      .select("system_role, sys_admin, sys_manager")
      .eq("username", name)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("Check error:", checkError);
    }

    // 2. Upsert user (create if missing)
    // SCHEMA MATCH: Use 'system_role' (text) and 'sys_admin'/'sys_manager' (bool)
    const { data, error } = await supabaseClient
      .from("users")
      .upsert({
        username: name,
        // Preserve existing roles if they exist, otherwise default to 'User'
        system_role: existingUser?.system_role || "User",
        sys_admin: existingUser?.sys_admin || false,
        sys_manager: existingUser?.sys_manager || false
      }, {
        onConflict: ["username"]
      })
      .select("system_role, sys_admin, sys_manager");

    if (error) {
      console.error("Failed to save user:", error);
      currentRole = "User";
      currentSystemRole = "User";
    } else {
      // SCHEMA MATCH: Read 'system_role' for currentRole
      currentRole = normalizeServerRole(data?.[0]?.system_role || "User");
      
      // SCHEMA MATCH: Read booleans for currentSystemRole
      if (data?.[0]?.sys_admin) {
        currentSystemRole = "SysAdmin";
      } else if (data?.[0]?.sys_manager) {
        currentSystemRole = "SysManager";
      } else {
        currentSystemRole = "User";
      }
    }

    localStorage.setItem("chatRole", currentRole);
    localStorage.setItem("chatSysAdmin", currentSystemRole === "SysAdmin" ? "true" : "false");
    localStorage.setItem("chatSysManager", currentSystemRole === "SysManager" ? "true" : "false");

  } catch (err) {
    console.error("Exception saving user:", err);
    currentRole = "User";
    currentSystemRole = "User";
    localStorage.setItem("chatRole", "User");
    localStorage.setItem("chatSysAdmin", "false");
    localStorage.setItem("chatSysManager", "false");
  }

  namePrompt.style.display = "none";
  const controls = document.getElementById("controls");
  if (controls) controls.classList.add("visible");
  
  const input = document.getElementById("messageInput");
  const button = document.getElementById("sendButton");
  if (input) input.disabled = false;
  if (button) button.disabled = false;

  loadMessages();
  initRealtime();

  const createBtn = document.getElementById("createChannelBtn");
  if (createBtn) createBtn.style.display = userPermissions.manage_roles ? "inline-block" : "none";
  const catBtn = document.getElementById("createCategoryBtn");
  if (catBtn) catBtn.style.display = userPermissions.manage_roles ? "inline-block" : "none";
  updateMessageLock();
}

//URL Blocker
function containsPlainTextUrl(text) {
  const textOnly = text.replace(/<[^>]*>/g, "");
  const urlRegex = /(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i;
  return urlRegex.test(textOnly);
}

function isGlobalMuteActive() {
  return globalMutedUntil && new Date(globalMutedUntil) > new Date();
}
function isServerMuteActive() {
  return mutedUntil && new Date(mutedUntil) > new Date();
}
function muteReason() {
  // Returns a human-readable string explaining why the user can't speak, or null.
  if (selfMuted) return "self";
  if (isGlobalMuteActive()) return "global";
  if (currentConversationType === "channel" && isBlocked) return "blocked";
  if (currentConversationType === "channel" && isServerMuteActive()) return "server";
  return null;
}
function isUserBlockedOrMutedSync() {
  // Self-mute and global (sysadmin) mute apply everywhere, including DMs.
  if (selfMuted) return true;
  if (isGlobalMuteActive()) return true;
  // Per-server block/mute is only enforced inside a server channel.
  if (currentConversationType !== "channel") return false;
  if (isBlocked) return true;
  if (isServerMuteActive()) return true;
  return false;
}

async function sendMessage(options = {}) {
  if (currentConversationType === "channel" && !userPermissions.send_messages) {
    alert("❌ You don't have permission to send messages.");
    return;
  }
  if (currentConversationType === "channel" && currentChannelId && !userPermissions.manage_roles) {
    const eff = getEffectiveChannelPermission(currentChannelId);
    if (eff && eff.can_send === false) {
      alert("❌ You don't have permission to send messages in this channel.");
      return;
    }
  }

  const rawContent = (typeof options.overrideContent === "string")
    ? options.overrideContent
    : input.value;
  let content = rawContent.trim();
  if (
    currentConversationType === "channel"
    && currentServerSettings.bad_word_filter_enabled
    && !userPermissions.bypass_word_filter
  ) {
    content = await censorContent(content);
  }
  if (!content || !username) return;

  if (isUserBlockedOrMutedSync()) {
    alert("❌ You cannot send messages.");
    return;
  }

  // --- GIF PERMISSION CHECK ---
  // Direct GIF/image/video URLs require the "Send GIFs" role permission.
  const isGifContent = content.startsWith("http") && (content.includes("tenor.com") || content.includes("giphy.com") || content.endsWith(".gif") || content.endsWith(".webp") || content.endsWith(".mp4"));
  const _legacyGifAllowed = ["Manager", "Admin", "SysManager", "SysAdmin"].includes(currentRole);
  if (isGifContent && !(userPermissions.send_gifs || _legacyGifAllowed)) {
    alert("❌ You don't have permission to send GIFs in this server.");
    return;
  }

  if (
    !options.bypassLinkCheck
    && currentConversationType === "channel"
    && !currentServerSettings.allow_plaintext_links
    && !userPermissions.send_links
    && !userPermissions.manage_roles
    && containsPlainTextUrl(content)
  ) {
    alert("❌ You don't have permission to send links in this server.");
    return;
  }

  if (
    currentConversationType === "channel"
    && !canMentionEveryone()
    && !userPermissions.mention_everyone
    && /@(everyone|here)\b/i.test(content)
  ) {
    alert("❌ You don't have permission to use @everyone or @here.");
    return;
  }

  if (
    currentConversationType === "channel"
    && currentServerSettings.admin_only_custom_emojis
    && !canUseRestrictedCustomEmojis()
    && /:([a-zA-Z0-9_-]+):/g.test(content)
  ) {
    const usesRestrictedCustomEmoji = [...content.matchAll(/:([a-zA-Z0-9_-]+):/g)]
      .some((match) => allCustomEmojis.some((emoji) => emoji.name === String(match[1] || "").toLowerCase()));
    if (usesRestrictedCustomEmoji) {
      alert("❌ Custom emojis are restricted to server admins on this server.");
      return;
    }
  }

  // --- IP LOGGING ---
  let ip = "unknown";
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(3000)
    });
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData?.ip) ip = ipData.ip;
    }
  } catch {
    // silently fall back to "unknown" so the message still sends
  }

  try {
    const messageData = {
      username,
      content,
      role: currentRole,
      is_pinned: false,
      ip: ip // Include IP in the message object if your schema allows, or rely on the user table update above
    };

    if (replyingTo) {
      messageData.reply_to = replyingTo;
    }

    let error = null;
    if (currentConversationType === "dm") {
      messageData.conversation_id = currentDmConversationId;
      ({ error } = await supabaseClient.from("dm_messages").insert([messageData]));
    } else {
      messageData.channel_id = currentChannelId;
      ({ error } = await supabaseClient.from("messages").insert([messageData]));
    }

    if (!error) {
      input.value = "";
      hideMentionSuggestions();
      console.log("✅ Message sent to Supabase (IP: " + ip + ")");

      setTimeout(() => {
        messagesList.scrollTop = messagesList.scrollHeight;
      }, 100);

      if (replyingTo) {
        clearReply();
      }

      const isImportant = currentConversationType === "channel" && userPermissions.manage_roles && content.includes("!important!");
      if (isImportant) {
        const memberUsernames = await getCurrentServerMemberUsernames();
        await sendPushToUsers(memberUsernames, {
          title: "Important announcement",
          body: `${username}: ${content.replace("!important!", "").trim()}`,
          important: true,
          mention: false
        });
      }

      if (currentConversationType === "channel") {
        await processMentions(content);
      } else {
        await loadDirectConversations();
      }
    }
  } catch (e) {
    console.error("❌ Failed to send message", e);
  }
  console.log("Sent good");
}

// Add this near your sendMessage function
async function processMentions(content) {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const everyoneMentioned = canMentionEveryone() && /@(everyone|here)\b/i.test(content);
  const mentionedTokens = [...content.matchAll(mentionRegex)]
    .map(match => String(match[1] || "").toLowerCase())
    .filter(token => token && token !== "everyone" && token !== "here");

  if (!everyoneMentioned && mentionedTokens.length === 0) return;

  const exactUsernames = new Set();
  const memberUsernames = await getCurrentServerMemberUsernames();
  const serverUsernameMap = new Map(memberUsernames.map(name => [String(name).toLowerCase(), name]));

  if (everyoneMentioned) {
    memberUsernames.forEach(name => exactUsernames.add(name));
  }

  mentionedTokens.forEach(token => {
    const resolved = serverUsernameMap.get(token);
    if (resolved) exactUsernames.add(resolved);
  });

  if (exactUsernames.size === 0) return;

  await sendPushToUsers([...exactUsernames], {
    title: everyoneMentioned ? `@everyone from ${username}` : `@${username} mentioned you`,
    body: content.substring(0, 140),
    mention: true,
    important: true
  });
}
// Optimized preview builder with timeout
async function buildLinkPreview(url) {
  // Check cache first
  const cache = getPreviewCache();
  if (cache[url]?.data) {
    console.log("📦 Preview loaded from cache:", url);
    return cache[url].data;
  }

  try {
    // Timeout handling (works in all browsers)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), 3000);
    });

    const fetchPromise = fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);

    // Race between fetch and timeout
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    const json = await res.json();

    if (!json.data) return null;

    const preview = `
<div class="link-preview">
  ${json.data.image ? `<img src="${json.data.image.url}">` : ""}
  <div class="lp-text">
    <div class="lp-title">${json.data.title || url}</div>
    <div class="lp-desc">${json.data.description || ""}</div>
    <a href="${url}" target="_blank">${url}</a>
  </div>
</div>
`;

    // Cache the result
    setPreviewCache(url, preview);
    return preview;
  } catch (e) {
    console.warn("Preview failed for", url, e);
    return null;
  }
}

// ------------------------ Render Message ------------------------
function renderMessage(msg) {
  const li = createMessageElement(msg);
  const existingLi = messagesMap.get(msg.id);

  if (existingLi) {
    existingLi.replaceWith(li);
  } else if (msg.reply_to) {
    const parentLi = messagesMap.get(msg.reply_to);
    if (parentLi && parentLi.parentNode === messagesList) {
      parentLi.insertAdjacentElement("afterend", li);
    } else {
      messagesList.appendChild(li);
    }
  } else {
    messagesList.appendChild(li);
  }

  messagesMap.set(msg.id, li);
  messageDataMap.set(msg.id, msg);
  applyMessageSearchFilter();

  // Only auto-scroll if user is already near bottom
  const isNearBottom = messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight < 150;
  if (isNearBottom) scrollToBottom();

}

function createMessageElement(msg) {
  const li = document.createElement("li");
  li.dataset.id = msg.id;
  li.dataset.user = msg.username;

  const row = document.createElement("div");
  row.className = "message-row";

  const avatarEl = buildAvatarElement(msg.username, "message-avatar");
  row.appendChild(avatarEl);

  const body = document.createElement("div");
  body.className = "message-body";

  // Role classes for styling
  const roleLower = (msg.role || "").toLowerCase();
  if (roleLower === "admin") li.classList.add("admin");
  else if (roleLower === "manager") li.classList.add("manager");
  else if (roleLower === "sysmanager") li.classList.add("sysmanager");
  else if (roleLower === "sysadmin") li.classList.add("sysadmin");

  if (msg.is_pinned) li.dataset.pinned = "true";
  if (msg.reply_to) li.classList.add("is-reply");

  // 1. Clean content for display (remove the internal marker if it exists)
  const cleanContent = msg.content.replaceAll(NO_EMBED_PHRASE, "");
  const hasNoEmbed = msg.content.includes(NO_EMBED_PHRASE);
  const timestamp = msg.inserted_at ? new Date(msg.inserted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // --- REPLY CONTEXT ---
  if (msg.reply_to) {
    const parentMsg = messageDataMap.get(msg.reply_to);
    if (parentMsg) {
      const replyContext = document.createElement("div");
      replyContext.className = "reply-context";
      replyContext.innerHTML = `
        <span class="reply-context-user">${escapeHTML(displayName(parentMsg.username))}</span>
        <span class="reply-context-content">${escapeHTML((parentMsg.content || "").replaceAll(NO_EMBED_PHRASE, "").slice(0, 120))}</span>
      `;
      replyContext.onclick = (e) => {
        e.stopPropagation();
        const parentEl = messagesMap.get(parentMsg.id);
        if (!parentEl) return;
        parentEl.scrollIntoView({ behavior: "smooth", block: "center" });
        parentEl.classList.add("highlighted");
        setTimeout(() => parentEl.classList.remove("highlighted"), 1400);
      };
      body.appendChild(replyContext);
    }
  }

  // --- HEADER ROW ---
  const header = document.createElement("div");
  header.className = "username";
  header.innerHTML = `${escapeHTML(displayName(msg.username))}<span class="msg-timestamp">${timestamp}</span>`;
  header.style.cursor = "pointer";
  header.addEventListener("click", (e) => {
    e.stopPropagation();
    openUserProfile(msg.username, currentServerId);
  });
  body.appendChild(header);

  // --- CONTENT ROW ---
  const contentDiv = document.createElement("div");
  contentDiv.className = "content";

  const fileMatch = cleanContent.match(/\[📄 (.*?)\]\((.*?)\)/);

  if (fileMatch) {
    // Handle File Uploads (Existing logic)
    const url = fileMatch[2].trim();
    const type = getFileType(url);
    if (type === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.className = "msg-image";
      img.loading = "lazy";
      img.onclick = () => openLightbox(url);
      contentDiv.appendChild(img);
    } else if (type === "video") {
      contentDiv.innerHTML = `<video controls style="max-width:100%;border-radius:8px;"><source src="${url}"></video>`;
    } else {
      contentDiv.innerHTML = `<a href="${url}" target="_blank">📄 ${escapeHTML(fileMatch[1])}</a>`;
    }
  } else {
    // --- TEXT MESSAGE HANDLING ---
    let formatted = formatMessageContent(cleanContent, msg.role);

    // Force @ Mention Styling
    formatted = formatted.replace(/@([a-zA-Z0-9_]+)/g, (match, name) => {
      const isMine = name.toLowerCase() === (username || "").toLowerCase();
      const mentionClass = isMine ? "mention mine" : "mention";
      return `<span class="${mentionClass}"><span class="mention-mark">@</span><span class="mention-name">${escapeHTML(name)}</span></span>`;
    });

    // Handle Code Blocks
    if (!formatted.startsWith("<pre class=\"code-block\">")) {
      formatted = replaceCustomEmojiShortcodes(formatted);
    }

    contentDiv.innerHTML = formatted;

    // Apply long message class
    if (cleanContent.length > 1000) {
      contentDiv.classList.add("long-message");
    }

    // Emoji-only message styling
    if (isEmojiOnlyMessage(cleanContent)) {
      contentDiv.classList.add("emoji-only-message");
    }

    // --- CRITICAL GIF & LINK HANDLING ---
    const urlMatch = cleanContent.match(/https?:\/\/[^\s]+/);
    
    if (urlMatch) {
      const url = urlMatch[0];
      const gifUrl = resolveGifUrl(url);

      // Helper: Strip the raw URL text from the HTML
      const stripUrlFromBody = () => {
        const escapedUrl = escapeHTML(url);
        // Zero-width spaces (\u200B) may have been inserted by the long-word
        // breaker in formatMessageContent, so normalize them away before searching.
        let html = (contentDiv.innerHTML || "").replace(/\u200B/g, "");

        if (html.includes(escapedUrl)) {
          html = html.split(escapedUrl).join("");
        } else if (html.includes(url)) {
          html = html.split(url).join("");
        }

        contentDiv.innerHTML = html.trim();
      };

      const appendInlineGif = (mediaUrl) => {
        stripUrlFromBody(); // <--- STRIPS THE TEXT URL
        contentDiv.appendChild(createInlineGifElement(mediaUrl));
      };

      const appendLinkPreview = () => {
        // Only show preview if we haven't already embedded a GIF
        if (hasNoEmbed) return;
        
        const previewContainer = document.createElement("div");
        previewContainer.className = "link-preview-container";
        contentDiv.appendChild(previewContainer);
        
        setTimeout(async () => {
          const preview = await buildLinkPreview(url);
          if (preview) {
            previewContainer.innerHTML = preview;
            previewContainer.classList.add("loaded");
          } else {
            previewContainer.remove();
          }
        }, 50);
      };

      if (gifUrl) {
        // It's a direct GIF/Image -> Show ONLY the image
        appendInlineGif(gifUrl);
      } else if (isLikelyGifPageUrl(url) && !hasNoEmbed) {
        // It's a page URL (like tenor.com/view/...) -> Try to resolve to media
        const placeholder = document.createElement("div");
        placeholder.className = "gif-resolving";
        contentDiv.appendChild(placeholder);
        
        setTimeout(async () => {
          const resolved = await resolveGifPageUrlAsync(url);
          placeholder.remove();
          if (resolved) {
            appendInlineGif(resolved); // <--- STRIPS TEXT IF SUCCESSFUL
          } else {
            appendLinkPreview(); // Fallback to preview if resolution fails
          }
        }, 0);
      } else {
        // Regular link -> Show Preview
        appendLinkPreview();
      }
    }
  }

  body.appendChild(contentDiv);

  // Scripts (Admin only)
  if (msg.role === "Admin") {
    executeScripts(contentDiv);
  }

  row.appendChild(body);
  li.appendChild(row);

  if (currentConversationType === "channel") {
    renderReactions(msg.id, li);
  }

  attachMessageLongPress(li);
  attachHoverControls(li, msg);

  return li;
}

// ------------------------ Realtime Handler ------------------------
async function handleRealtimeMessage(newMsg, eventType) {
  if (!newMsg) return;
  if (newMsg.channel_id !== currentChannelId) return;

  if (eventType === "INSERT") {
    await loadAvatarMapForUsernames([newMsg.username]);
    messageDataMap.set(newMsg.id, newMsg);
    renderMessage(newMsg);

    // Update the checkpoint immediately so we don't count this message as unread later
    // We pass the new message ID so the "read" state moves forward
    if (currentServerId) {
      setServerCheckpoint(currentServerId, newMsg.id);
    }

    setTimeout(() => {
      waitForImagesBeforeScroll();
    }, 100);

    if (messageMentionsUser(newMsg.content, username)) {
      showMentionToast(newMsg);
      await notifyMentionClientSide(newMsg);

      const el = messagesMap.get(newMsg.id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.background = "#3a3d44";
        // Reset background after a bit
        setTimeout(() => {
          if(el) el.style.background = "";
        }, 2000);
      }
    }
  }

  else if (eventType === "UPDATE") {
    await loadAvatarMapForUsernames([newMsg.username]);
    messageDataMap.set(newMsg.id, newMsg);
    renderMessage(newMsg);
    if (messageMentionsUser(newMsg.content, username)) {
      showMentionToast(newMsg);
      await notifyMentionClientSide(newMsg);

      const el = messagesMap.get(newMsg.id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.background = "#3a3d44";
        setTimeout(() => {
          if(el) el.style.background = "";
        }, 2000);
      }
    }
  }

  else if (eventType === "DELETE") {
    messageDataMap.delete(newMsg.id);

    const li = messagesMap.get(newMsg.id);
    if (li) {
      li.remove();
      messagesMap.delete(newMsg.id);
    }
    applyMessageSearchFilter();
  }
}

async function handleRealtimeDmMessage(newMsg, eventType) {
  if (!newMsg) return;

  if (eventType === "INSERT") {
    await loadAvatarMapForUsernames([newMsg.username]);
    messageDataMap.set(newMsg.id, newMsg);
    renderMessage(newMsg);
    setTimeout(() => {
      waitForImagesBeforeScroll();
    }, 100);
  } else if (eventType === "UPDATE") {
    await loadAvatarMapForUsernames([newMsg.username]);
    messageDataMap.set(newMsg.id, newMsg);
    renderMessage(newMsg);
  } else if (eventType === "DELETE") {
    messageDataMap.delete(newMsg.id);
    const li = messagesMap.get(newMsg.id);
    if (li) {
      li.remove();
      messagesMap.delete(newMsg.id);
    }
    applyMessageSearchFilter();
  }

  await loadDirectConversations();
}

// ------------------------ Send / Name Handlers ------------------------
saveNameBtn.addEventListener("click", saveName);
button.addEventListener("click", sendMessage);
if (newDmBtn) {
  newDmBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    promptForDirectMessage();
  });
}
input.addEventListener("keydown", e => {
  if (mentionSuggestionItems.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionSuggestionItems.length;
      renderMentionSuggestions(mentionSuggestionItems);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionSuggestionItems.length) % mentionSuggestionItems.length;
      renderMentionSuggestions(mentionSuggestionItems);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyMentionSuggestion(mentionSuggestionItems[mentionSelectedIndex]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideMentionSuggestions();
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
input.addEventListener("click", () => updateMentionSuggestions());
input.addEventListener("keyup", () => updateMentionSuggestions());
input.addEventListener("blur", () => {
  setTimeout(() => hideMentionSuggestions(), 120);
});

// Keep the file input listener for when the user clicks the avatar IN the modal
if (avatarInput) {
  avatarInput.addEventListener("change", async () => {
    await changeMyAvatar();
    avatarInput.value = "";
  });
}

// Secret sign-out shortcut + Admin Console Toggle
document.addEventListener("keydown", async e => {
  // 1. Admin Console Toggle (Ctrl + Alt + I)
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "i") {
    e.preventDefault();
    e.stopImmediatePropagation();
    
    if (currentSystemRole !== "SysAdmin") {
      return; 
    }

    if (adminDebugPanel) {
      if (adminDebugPanel.style.display === "none") {
        adminDebugPanel.style.display = "flex";
        const input = document.getElementById('admin-console-input');
        if (input) input.focus();
      } else {
        adminDebugPanel.style.display = "none";
      }
    } else {
      initAdminDebugPanel();
    }
    return;
  }

  // 2. Existing Secret Logout (Ctrl + Alt + Shift + T)
  if (e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    await performLogout();
  }
});

// ------------------------ Push ------------------------
const VAPID_PUBLIC_KEY = "BASYo0tS0nRAG504ReCj95aY9QacgW9vPLQKkMJRU8LXPDMtYIg-oeA__TvgyDJlop9mQqeRC1j_7ydtlKCk0zA";
async function enablePush() {
  if (!username) return;
  if(!("serviceWorker" in navigator)) return;
  const permission = await Notification.requestPermission();
  if(permission!=="granted") return;
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  await showLocalTestNotification();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: VAPID_PUBLIC_KEY });
  }
  await supabaseClient.from("push_subscriptions").upsert({ username, subscription }, { onConflict: "username" });
  try {
    const response = await invokeSendPush({
      title: "Notifications enabled",
      body: "Test push successful.",
      subscription,
      important: true,
      mention: false,
      url: window.location.pathname + window.location.search
    });
    let responseBody = "";
    try {
      responseBody = await response.text();
    } catch {}
    console.log("🧪 Test push response:", response.status, responseBody || "(empty)");
  } catch (testPushError) {
    console.warn("⚠️ Test push failed:", testPushError);
  }
  console.log("🔔 Push enabled");
}

document.addEventListener("click", () => {
  closeAllContextMenus();
});

// ======================== MOBILE SIDEBAR TOGGLE ========================
const menuToggleBtn = document.getElementById("menuToggle");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const serverSwitchBtn = document.getElementById("serverSwitchBtn");

function openSidebar() {
  document.body.classList.add("sidebar-open");
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}
function closeServerSidebar() {
  document.body.classList.remove("server-switch-open");
}

if (menuToggleBtn) {
  menuToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.body.classList.toggle("sidebar-open");
    closeServerSidebar();
  });
}

if (serverSwitchBtn) {
  serverSwitchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.body.classList.toggle("server-switch-open");
    closeSidebar();
  });
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", (e) => {
    // Only close if clicking the overlay itself, not its children
    if (e.target === sidebarOverlay) {
      closeSidebar();
      closeServerSidebar();
      const ml = document.getElementById("memberList");
      if (ml) ml.classList.remove("open");
    }
  });
}

// Close sidebar on mobile when a channel is selected
const channelListEl = document.getElementById("channelList");
if (channelListEl) {
  channelListEl.addEventListener("click", () => {
    if (window.innerWidth <= 768) closeSidebar();
  });
}

// Close emoji picker when clicking outside
document.addEventListener("click", (e) => {
  const picker = document.getElementById("emojiPicker");
  if (picker && picker.style.display !== "none" &&
      !picker.contains(e.target) && !e.target.classList.contains("emoji-trigger")) {
    picker.style.display = "none";
  }
});

// ======================== EMOJI PICKER ========================

const EMOJI_CATEGORIES = [
  { name: "Recent",      icon: "🕐", emojis: [] },
  { name: "Smileys",     icon: "😀", emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","😟","🙁","☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖"] },
  { name: "People",      icon: "👋", emojis: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🫶","🫀","🫁","🦷","🦴","👀","👁️","👅","👄","💋","🫦","👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓","👴","👵","🙍","🙎","🙅","🙆","💁","🙋","🧏","🙇","🤦","🤷","👮","🕵️","💂","🥷","👷","🤴","👸","👰","🤵","🤰","🤱","👼","🎅","🤶","🦸","🦹","🧙","🧚","🧛","🧜","🧝","🧞","🧟","💆","💇","🚶","🧍","🧎","🏃","💃","🕺"] },
  { name: "Animals",     icon: "🐶", emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐈‍⬛","🐓","🦃","🦤","🦚","🦜","🦢","🦩","🕊️","🐇","🦝","🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️","🦔","🐾","🐉","🐲"] },
  { name: "Nature",      icon: "🌿", emojis: ["🌵","🎄","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🎍","🎋","🍃","🍂","🍁","🍄","🐚","🪨","🌾","💐","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑","🌒","🌓","🌔","🌙","🌟","⭐","🌠","🌌","☁️","⛅","🌤️","⛈️","🌧️","🌨️","❄️","☃️","⛄","🌬️","💨","💧","💦","🌊","🌈","🌫️","🌀","🌪️","🌩️","⚡","🔥","💥","🌍","🌎","🌏","🗺️","🏔️","⛰️","🌋","🏕️","🏖️","🏜️","🏝️","🏞️"] },
  { name: "Food",        icon: "🍔", emojis: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🫒","🥑","🍆","🥔","🥕","🌽","🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🍄","🥜","🌰","🍞","🥐","🥖","🫓","🥨","🥯","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🫔","🌮","🌯","🥙","🧆","🥘","🍲","🫕","🥣","🥗","🍿","🧂","🥫","🍱","🍙","🍚","🍛","🍜","🍝","🍠","🍣","🍤","🍥","🥮","🍡","🥟","🥠","🥡","🍦","🍧","🍨","🍩","🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭","🍯","🍼","🥛","☕","🫖","🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾"] },
  { name: "Travel",      icon: "✈️", emojis: ["🚗","🚕","🚙","🚌","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍️","🛵","🛺","🚲","🛴","🛹","🚏","⛽","🚨","🚥","🚦","🛑","⚓","⛵","🛶","🚤","🛳️","⛴️","🚢","✈️","🛩️","🛫","🛬","💺","🚁","🚀","🛸","🏔️","⛰️","🌋","🏕️","🏖️","🏜️","🏝️","🏞️","🏟️","🏛️","🏗️","🏘️","🏚️","🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨","🏩","🏪","🏫","🏬","🏭","🏯","🏰","💒","🗼","🗽","⛪","🕌","🛕","🕍","⛩️","🕋","⛲","🎠","🎡","🎢","🎪","🌁","🌃","🏙️","🌄","🌅","🌆","🌇","🌉","🗺️"] },
  { name: "Activities",  icon: "⚽", emojis: ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🏓","🏸","🏒","🥅","⛳","🎣","🤿","🥊","🥋","🎽","🛹","🛷","⛸️","🥌","🎿","⛷️","🏂","🏋️","🤸","⛹️","🤺","🏇","🧘","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎫","🎟️","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎵","🎶","🥁","🎷","🎺","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰","🧩"] },
  { name: "Objects",     icon: "💡", emojis: ["📱","💻","⌨️","🖥️","🖨️","🖱️","💽","💾","💿","📀","📺","📷","📸","📹","🎥","📽️","🎞️","📞","☎️","📟","📡","🔋","🔌","💡","🔦","🕯️","💰","💳","🪙","✉️","📧","📨","📩","📦","📫","📬","📭","📮","✏️","✒️","🖊️","📝","📁","📂","🗂️","📅","📆","📇","📈","📉","📊","📋","📌","📍","📎","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔑","🗝️","🔨","⚒️","🛠️","⚔️","🔫","🛡️","🔧","🔩","⚙️","⚖️","🔗","🧲","🪜","🧪","🧫","🧬","🔬","🔭","💊","💉","🩸","🩹","🩺","🪞","🛏️","🛋️","🚪","🧴","🧹","🧺","🧻","🧼","🧽","🛒","🚬","🪦","🧿","📿","🪬"] },
  { name: "Symbols",     icon: "❤️", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","☯️","☦️","🛐","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","☢️","☣️","📴","📳","✴️","🆚","💮","㊙️","㊗️","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","⚠️","🚸","🔱","⚜️","🔰","♻️","✅","❇️","✳️","❎","🌐","💠","💤","🏧","♿","🅿️","🈳","🚹","🚺","🚼","🚻","⚧️","▶️","⏩","⏭️","⏯️","◀️","⏪","⏮️","⏸️","⏹️","⏺️","⏏️","➕","➖","➗","✖️","💲","💱","™️","©️","®️","✔️","☑️","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","🔷","🔶","🔹","🔸","❤️‍🔥","💬","💭","🗯️","♠️","♣️","♥️","♦️","🃏","🎴","🀄"] },
  { name: "Custom",      icon: "⭐", emojis: [] }
];

let allCustomEmojis = []; // every active custom emoji in the server
let customEmojis = []; // { id, name, url }
let pickerBuilt = false;
let currentPickerMessageId = null;

function getCustomEmojiCategory() {
  return EMOJI_CATEGORIES.find(category => category.name === "Custom");
}

function getAllReactionEmojiChoices() {
  const recent = getRecentEmojis();
  const choices = [];
  const seen = new Set();
  const pushChoice = (entry) => {
    const key = `${entry.kind}:${entry.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    choices.push(entry);
  };

  recent.forEach((emoji) => {
    const custom = customEmojis.find(item => item.url === emoji);
    if (custom) {
      pushChoice({
        kind: "emoji",
        value: custom.name,
        insertText: `:${custom.name}: `,
        label: `:${custom.name}:`,
        meta: "Custom emoji",
        preview: emoji
      });
    } else {
      pushChoice({
        kind: "emoji",
        value: emoji,
        insertText: `${emoji} `,
        label: emoji,
        meta: "Emoji",
        preview: emoji
      });
    }
  });

  customEmojis.forEach((emoji) => {
    pushChoice({
      kind: "emoji",
      value: emoji.name,
      insertText: `:${emoji.name}: `,
      label: `:${emoji.name}:`,
      meta: "Custom emoji",
      preview: emoji.url
    });
  });

  EMOJI_CATEGORIES.forEach((category) => {
    if (category.name === "Recent" || category.name === "Custom") return;
    category.emojis.forEach((emoji) => {
      pushChoice({
        kind: "emoji",
        value: emoji,
        insertText: `${emoji} `,
        label: emoji,
        meta: category.name,
        preview: emoji
      });
    });
  });

  return choices;
}

function getEmojiSuggestionItems(query) {
  const normalizedQuery = normalizeSearchValue(query);
  const allChoices = getAllReactionEmojiChoices();
  const filtered = allChoices.filter((choice) => {
    if (!normalizedQuery) return true;
    return normalizeSearchValue(`${choice.label} ${choice.meta} ${choice.value}`).includes(normalizedQuery);
  });

  return filtered.slice(0, 8);
}

async function loadCustomEmojis() {
  const customCategory = getCustomEmojiCategory();
  if (!customCategory) return;

  if (!currentServerId) {
    allCustomEmojis = [];
    customEmojis = [];
    customCategory.emojis = [];
    rebuildCustomGrid();
    return;
  }

  const { data, error } = await supabaseClient
    .from("custom_emojis")
    .select("id, server_id, name, url, created_by, created_at, visibility, is_active")
    .eq("server_id", currentServerId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("❌ Failed to load custom emojis:", error.message);
    return;
  }

  allCustomEmojis = (data || []).map((emoji) => ({
    ...emoji,
    name: String(emoji.name || "").trim().toLowerCase()
  }));
  const canUseRestricted = canUseRestrictedCustomEmojis();
  const restrictAll = currentServerSettings.admin_only_custom_emojis && !canUseRestricted;
  customEmojis = allCustomEmojis.filter((emoji) => {
    const visibility = String(emoji.visibility || "everyone").toLowerCase();
    if (restrictAll) return false;
    if (visibility === "everyone") return true;
    return canUseRestricted;
  });
  customCategory.emojis = customEmojis.map((emoji) => emoji.url);
  rebuildCustomGrid();
}

function renderEmojiSuggestionPreview(item) {
  if (!item?.preview) return escapeHTML(item.label);
  const isUrl = item.preview.startsWith("http") || item.preview.startsWith("data:");
  if (isUrl) {
    return `<img src="${escapeHTML(item.preview)}" alt="${escapeHTML(item.label)}" class="mention-suggestion-emoji">`;
  }
  return `<span class="mention-suggestion-emoji-text">${escapeHTML(item.preview)}</span>`;
}

function replaceCustomEmojiShortcodes(content) {
  if (!content || !allCustomEmojis.length) return content;
  return content.replace(/:([a-zA-Z0-9_-]+):/g, (match, name) => {
    const emoji = allCustomEmojis.find(item => item.name === String(name).toLowerCase());
    if (!emoji) return match;
    return `<img src="${escapeHTML(emoji.url)}" alt=":${escapeHTML(emoji.name)}:" title=":${escapeHTML(emoji.name)}:" class="inline-custom-emoji">`;
  });
}

function isEmojiOnlyMessage(content) {
  const normalized = String(content || "").trim();
  if (!normalized) return false;
  const withoutCustom = normalized.replace(/:([a-zA-Z0-9_-]+):/g, " ");
  const withoutUnicodeEmoji = withoutCustom.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ");
  return withoutUnicodeEmoji.trim().length === 0;
}


function rebuildCustomGrid() {
  const picker = document.getElementById("emojiPicker");
  if (!picker) return;
  const customGrid = picker.querySelector(".ep-custom-grid");
  if (customGrid) renderEmojiGrid(customGrid, customEmojis.map(e => e.url), true);
  const adminBar = picker.querySelector(".ep-admin-bar");
  if (adminBar) adminBar.style.display = userPermissions.manage_roles ? "flex" : "none";
}

function buildEmojiPicker() {
  if (pickerBuilt) return;
  pickerBuilt = true;

  const picker = document.getElementById("emojiPicker");
  picker.className = "ep-container";

  // Search row
  const searchRow = document.createElement("div");
  searchRow.className = "ep-search-row";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search emojis...";
  searchInput.className = "ep-search";
  searchInput.addEventListener("input", () => filterEmojis(searchInput.value.trim()));
  searchRow.appendChild(searchInput);
  picker.appendChild(searchRow);

  // Category tabs
  const tabRow = document.createElement("div");
  tabRow.className = "ep-tabs";
  EMOJI_CATEGORIES.forEach((cat, i) => {
    const tab = document.createElement("button");
    tab.className = "ep-tab" + (i === 1 ? " active" : "");
    tab.title = cat.name;
    tab.textContent = cat.icon;
    tab.dataset.catIndex = i;
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      picker.querySelectorAll(".ep-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      showCategory(i);
    });
    tabRow.appendChild(tab);
  });
  picker.appendChild(tabRow);

  // Emoji grid area
  const gridArea = document.createElement("div");
  gridArea.className = "ep-grid-area";
  picker.appendChild(gridArea);

  // Admin bar (add custom emoji)
  const adminBar = document.createElement("div");
  adminBar.className = "ep-admin-bar";
  adminBar.style.display = "none";
  const addCustomBtn = document.createElement("button");
  addCustomBtn.className = "ep-add-custom-btn";
  addCustomBtn.textContent = "+ Add Custom Emoji";
  addCustomBtn.addEventListener("click", (e) => { e.stopPropagation(); addCustomEmoji(); });
  adminBar.appendChild(addCustomBtn);
  picker.appendChild(adminBar);

  showCategory(1); // Start on Smileys
}

function renderEmojiGrid(container, emojis, isCustom = false) {
  container.innerHTML = "";
  emojis.forEach((emoji, idx) => {
    const btn = document.createElement("button");
    btn.className = "ep-emoji-btn";

    const isUrl = emoji.startsWith("http") || emoji.startsWith("data:");
    if (isUrl) {
      const img = document.createElement("img");
      img.src = emoji;
      img.alt = customEmojis[idx]?.name || "custom";
      img.style.width = "24px";
      img.style.height = "24px";
      img.style.objectFit = "contain";
      btn.appendChild(img);
      btn.title = customEmojis.find(e => e.url === emoji)?.name || "custom";
    } else {
      btn.textContent = emoji;
      btn.title = emoji;
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (currentPickerMessageId) {
        saveRecentEmoji(emoji);
        addReaction(currentPickerMessageId, emoji);
        document.getElementById("emojiPicker").style.display = "none";
      }
    });

    // Admin delete button for custom emojis
    if (isCustom && userPermissions.manage_roles) {
      btn.style.position = "relative";
      const del = document.createElement("span");
      del.textContent = "✕";
      del.className = "ep-custom-delete";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const ce = customEmojis.find(e => e.url === emoji);
        if (ce && confirm(`Delete custom emoji "${ce.name}"?`)) deleteCustomEmoji(ce.id);
      });
      btn.appendChild(del);
    }

    container.appendChild(btn);
  });
}

function showCategory(index) {
  const picker = document.getElementById("emojiPicker");
  if (!picker) return;

  const gridArea = picker.querySelector(".ep-grid-area");
  gridArea.innerHTML = "";
  picker.querySelector(".ep-search").value = "";

  const cat = EMOJI_CATEGORIES[index];

  const label = document.createElement("div");
  label.className = "ep-cat-label";
  label.textContent = cat.name;
  gridArea.appendChild(label);

  // Recent category pulls from localStorage
  let emojis = cat.emojis;
  if (cat.name === "Recent") {
    emojis = getRecentEmojis();
    if (emojis.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "12px";
      empty.style.color = "#949ba4";
      empty.style.fontSize = "13px";
      empty.textContent = "No recently used emojis";
      gridArea.appendChild(empty);
      return;
    }
  }

  const isCustom = cat.name === "Custom";
  const grid = document.createElement("div");
  grid.className = isCustom ? "ep-custom-grid ep-grid" : "ep-grid";
  renderEmojiGrid(grid, emojis, isCustom);
  gridArea.appendChild(grid);

  // Show admin bar on Custom tab
  const adminBar = picker.querySelector(".ep-admin-bar");
  if (adminBar) adminBar.style.display = (isCustom && userPermissions.manage_roles) ? "flex" : "none";
}

function filterEmojis(query) {
  const picker = document.getElementById("emojiPicker");
  if (!picker) return;
  const gridArea = picker.querySelector(".ep-grid-area");
  gridArea.innerHTML = "";

  if (!query) {
    const activeTab = picker.querySelector(".ep-tab.active");
    const idx = activeTab ? parseInt(activeTab.dataset.catIndex) : 1;
    showCategory(idx);
    return;
  }

  const results = [];
  EMOJI_CATEGORIES.forEach(cat => {
    if (cat.name === "Recent" || cat.name === "Custom") return;
    cat.emojis.forEach(emoji => {
      if (emoji.includes(query)) results.push(emoji);
    });
  });

  const label = document.createElement("div");
  label.className = "ep-cat-label";
  label.textContent = `Results for "${query}"`;
  gridArea.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "ep-grid";
  renderEmojiGrid(grid, results);
  gridArea.appendChild(grid);
}

function openEmojiPicker(messageId, x, y) {
  currentPickerMessageId = messageId;
  const picker = document.getElementById("emojiPicker");
  if (!pickerBuilt) buildEmojiPicker();

  // Update admin bar visibility whenever opened
  const adminBar = picker.querySelector(".ep-admin-bar");
  if (adminBar) {
    const activeTab = picker.querySelector(".ep-tab.active");
    const isCustom = activeTab && EMOJI_CATEGORIES[parseInt(activeTab.dataset.catIndex)]?.name === "Custom";
    adminBar.style.display = (isCustom && userPermissions.manage_roles) ? "flex" : "none";
  }

  // Position with screen boundary detection
  picker.style.display = "flex";
  const pw = 320, ph = 380;
  let left = x, top = y;
  if (left + pw > window.innerWidth) left = x - pw;
  if (top + ph > window.innerHeight) top = y - ph;
  if (left < 0) left = 4;
  if (top < 0) top = 4;
  picker.style.left = left + "px";
  picker.style.top = top + "px";
}

// Recent emoji helpers
function getRecentEmojis() {
  try { return JSON.parse(localStorage.getItem("recentEmojis") || "[]"); }
  catch { return []; }
}
function saveRecentEmoji(emoji) {
  let recent = getRecentEmojis().filter(e => e !== emoji);
  recent.unshift(emoji);
  recent = recent.slice(0, 36);
  localStorage.setItem("recentEmojis", JSON.stringify(recent));
  EMOJI_CATEGORIES[0].emojis = recent;
}

// ======================== CUSTOM EMOJI MANAGEMENT ========================
async function addCustomEmoji() {
  if (!userPermissions.manage_roles) return;
  const name = prompt("Custom emoji name (e.g. 'tadacat'):");
  if (!name || !name.trim()) return;

  const useUrl = confirm("Click OK to paste an image URL, or Cancel to upload a file.");
  let url = null;

  if (useUrl) {
    url = prompt("Paste image URL:");
    if (!url || !url.trim()) {
      alert("❌ URL is required for URL-based emojis.");
      return;
    }
    url = url.trim();
  } else {
    url = await uploadCustomEmojiFile();
    if (!url) {
      // User cancelled file selection - give them feedback
      alert("ℹ️ File upload was cancelled. No emoji was added.");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("custom_emojis")
    .insert({ name: name.trim().toLowerCase(), url, created_by: username, server_id: currentServerId });

  if (error) {
    alert("❌ Failed to add custom emoji: " + error.message);
  } else {
    await loadCustomEmojis();
    alert("✅ Custom emoji added successfully!");
  }
}

async function uploadCustomEmojiFile() {
  return new Promise((resolve) => {
    // 1. Create the input element
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";

    // 2. Append it to the body (required for some browsers to allow programmatic click)
    document.body.appendChild(fileInput);

    // 3. Define the change handler BEFORE clicking
    fileInput.onchange = async () => {
      const file = fileInput.files[0];

      // Clean up: remove the input from DOM
      document.body.removeChild(fileInput);

      if (!file) {
        console.log("🚫 File upload cancelled by user.");
        resolve(null);
        return;
      }

      // Validate file size
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_SIZE) {
        alert("❌ File too large. Max 10MB allowed.");
        resolve(null);
        return;
      }

      // Show loading state
      const uploadBtn = document.getElementById("uploadBtn");
      if (uploadBtn) {
        uploadBtn.textContent = "⏳";
        uploadBtn.disabled = true;
      }

      try {
        // 4. Generate unique filename
        const timestamp = Date.now();
        const fileName = `emoji_$${timestamp}_$${file.name.replace(/\s+/g, "_")}`;

        console.log("📤 Uploading file:", fileName);

        // 5. Upload to Supabase Storage
        const { error: uploadError } = await supabaseClient.storage
          .from("emoji-files")
          .upload(fileName, file);

        if (uploadError) {
          console.error("❌ Upload error:", uploadError);
          alert("❌ Upload failed: " + uploadError.message);
          resolve(null);
          return;
        }

        // 6. Get public URL
        const { data: urlData } = supabaseClient.storage
          .from("emoji-files")
          .getPublicUrl(fileName);

        console.log("✅ Upload successful. URL:", urlData.publicUrl);
        resolve(urlData.publicUrl);

      } catch (err) {
        console.error("❌ Unexpected error:", err);
        alert("❌ Unexpected error: " + err.message);
        resolve(null);
      } finally {
        if (uploadBtn) {
          uploadBtn.textContent = "📎";
          uploadBtn.disabled = false;
        }
      }
    };

    // 7. Trigger the click
    console.log("🖱️ Triggering file picker click...");
    fileInput.click();

    // Optional: Auto-remove if user doesn't interact for 30s (cleanup safety)
    setTimeout(() => {
      if (document.body.contains(fileInput)) {
        document.body.removeChild(fileInput);
      }
    }, 30000);
  });
}

async function deleteCustomEmoji(id) {
  const { error } = await supabaseClient.from("custom_emojis").delete().eq("id", id);
  if (error) { alert("❌ " + error.message); return; }
  await loadCustomEmojis();
}

// ------------------------ ADMIN MENU FUNCTIONS ------------------------

// Reply
// Report message (with EmailJS)
async function reportMessage(messageId) {
  // Check permissions
  if (currentSystemRole === "SysManager") {
    // SysManager can only report in servers they are not invited to
    const { data: member } = await supabaseClient
      .from("server_members")
      .select("id")
      .eq("server_id", currentServerId)
      .eq("username", username)
      .maybeSingle();
    if (member) {
      alert("❌ SysManagers can only report in servers they haven't been invited to.");
      return;
    }
  } else if (currentSystemRole !== "SysAdmin" && !userPermissions.manage_roles) {
    alert("❌ You don't have permission to report messages.");
    return;
  }

  try {

    const reason = prompt("Why are you reporting this message?");
    if (!reason) return;

    const { data, error } = await supabaseClient
      .from("messages")
      .select("*")
      .eq("channel_id", currentChannelId)
      .eq("id", messageId)
      .maybeSingle();

    if (error) throw error;

   const reportData = {
  reporter: username,
  reported_user: data.username,
  content: data.content,
  reason: reason,
  message_id: messageId
};

    // store in database
    await supabaseClient
      .from("reports")
      .insert([reportData]);

    // send email via EmailJS
    await emailjs.send(
      "service_8a92zsj",     // replace
      "template_y386ub2",    // replace
      {
        reporter: reportData.reporter,
        offender: reportData.reported_user,
        message: reportData.content,
        reason: reportData.reason,
        message_id: reportData.message_id,
        time: new Date().toLocaleString()
      },
      "_ruE2WKFK8bLzX42w"      // replace
    );

    alert("✅ Report submitted.");

  } catch (err) {
    console.error("Report failed", err);
    alert("❌ Failed to send report.");
  }
}


// Pin message
async function pinMessage(messageId) {
  try {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("is_pinned")
      .eq("id", messageId)
      .maybeSingle();

    if (error) throw error;

    await supabaseClient
      .from("messages")
      .update({ is_pinned: !data.is_pinned })
      .eq("id", messageId);

  } catch (err) {
    console.error("Pin failed", err);
  }
}

// Delete Message
async function deleteMessage(messageId) {
  if (!confirm("Delete this message?")) return;

  const li = messagesMap.get(Number(messageId));
  const author = li ? li.dataset.user : null;
  const messageTable = currentConversationType === "dm" ? "dm_messages" : "messages";
  const canDeleteOwnDmMessage = currentConversationType === "dm" && author === username;

  if (!userPermissions.manage_roles && !(currentRole === "Manager" && author === username) && !canDeleteOwnDmMessage) {
    alert("❌ Access Denied: You can only delete your own messages.");
    return;
  }

  try {
    // 🧠 1. Get message FIRST (so we know if it has a file)
    const { data: msg, error: fetchError } = await supabaseClient
      .from(messageTable)
      .select("content")
      .eq("id", messageId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const content = msg.content;

    // 📦 2. Check if it's a file message
    const fileMatch = content.match(/\[📄 (.*?)\]\((.*?)\)/);

    if (fileMatch) {
      const fileUrl = fileMatch[2];

      // 🔍 3. Extract file path from URL
      const urlParts = fileUrl.split("/chat-files/");
      if (urlParts.length > 1) {
        const filePath = urlParts[1].split("?")[0];

        console.log("Deleting file:", filePath);

        // 🗑️ 4. Delete from Supabase Storage
        const { error: storageError } = await supabaseClient.storage
          .from("chat-files")
          .remove([filePath]);

        if (storageError) {
          console.warn("⚠️ File delete failed:", storageError.message);
        } else {
          console.log("✅ File deleted from storage");
        }
      }
    }

    // 🧨 5. Delete message from DB
    const { data, error } = await supabaseClient
      .from(messageTable)
      .delete()
      .eq("id", messageId)
      .select();

    if (error) throw error;

    if (data && data.length > 0) {
      alert("✅ Message + file deleted");

      if (li) {
        li.remove();
        messagesMap.delete(Number(messageId));
      }
    } else {
      alert("⚠️ Delete blocked (RLS probably)");
    }

  } catch (err) {
    console.error("Delete failed:", err);
    alert("❌ Delete failed: " + err.message);
  }
}


// Mute user (per-server only)
async function muteUser(user) {
  if (!currentServerId) {
    alert("❌ Muting is only available inside a server.");
    return;
  }
  const minutes = parseInt(prompt(`Mute ${user} in this server for how many minutes?`));
  if (!minutes || minutes <= 0) return;

  const muteUntil = new Date(Date.now() + minutes * 60000).toISOString();

  const { error } = await supabaseClient
    .from("server_members")
    .update({ muted_until: muteUntil })
    .eq("server_id", currentServerId)
    .eq("username", user);

  if (error) {
    console.error("Mute failed:", error);
    alert("❌ Mute failed: " + error.message);
    return;
  }

  alert(`${user} muted in this server for ${minutes} minutes.`);
}


// Block user (per-server only)
async function blockUser(user) {
  if (!currentServerId) {
    alert("❌ Blocking is only available inside a server.");
    return;
  }
  if (!confirm(`Block ${user} in this server?`)) return;

  try {
    const { error } = await supabaseClient
      .from("server_members")
      .update({ blocked: true })
      .eq("server_id", currentServerId)
      .eq("username", user);

    if (error) throw error;
    alert(`${user} blocked in this server.`);

  } catch (err) {
    console.error("Block failed", err);
    alert("❌ Block failed: " + err.message);
  }
}


// Optional unblock helper (per-server only)
async function unblockUser(user) {
  if (!currentServerId) {
    alert("❌ Unblocking is only available inside a server.");
    return;
  }
  try {
    const { error } = await supabaseClient
      .from("server_members")
      .update({ blocked: false, muted_until: null })
      .eq("server_id", currentServerId)
      .eq("username", user);

    if (error) throw error;
    alert(`${user} unblocked in this server.`);

  } catch (err) {
    console.error("Unblock failed", err);
    alert("❌ Unblock failed: " + err.message);
  }
}

// Delete all messages containing a keyword
async function deleteKeyword() {
  if (!currentServerId) {
    alert("❌ No server selected.");
    return;
  }

  const keyword = prompt("Delete all messages containing keyword:");
  if (!keyword) return;
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return;
  if (!confirm(`Delete all messages in this server containing "${keyword}"?`)) return;

  try {
    const serverChannelIds = channels
      .filter((channel) => channel.server_id === currentServerId)
      .map((channel) => channel.id);

    if (serverChannelIds.length === 0) {
      alert("No channels found for this server.");
      return;
    }

    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, content")
      .in("channel_id", serverChannelIds);

    if (error) throw error;

    const matches = data.filter((message) =>
      String(message.content || "").toLowerCase().includes(normalizedKeyword)
    );
    if (matches.length === 0) {
      alert("No messages found with that keyword in this server.");
      return;
    }

    const ids = matches.map((message) => message.id);
    const { error: delError } = await supabaseClient
      .from("messages")
      .delete()
      .in("id", ids);

    if (delError) throw delError;

    ids.forEach(id => {
      const li = messagesMap.get(Number(id));
      if (li) { li.remove(); messagesMap.delete(Number(id)); }
    });

    alert(`✅ Deleted ${ids.length} message(s) containing "${keyword}" in this server.`);
  } catch (err) {
    console.error("deleteKeyword failed", err);
    alert("❌ Failed: " + err.message);
  }
}

// Delete a user and all their messages
async function deleteUser(author) {
  if (!confirm(`Delete user "${author}" and ALL their messages? This cannot be undone.`)) return;

  try {
    const aliases = [...new Set([
      String(author || "").trim(),
      "Frenchwizz",
      "frenchwizz",
      "FRENCHWIZZ"
    ].filter(Boolean))];

    const { error: msgError } = await supabaseClient
      .from("messages")
      .delete()
      .in("username", aliases);

    if (msgError) throw msgError;

    const { error: reactionsError } = await supabaseClient
      .from("reactions")
      .delete()
      .in("username", aliases);
    if (reactionsError) throw reactionsError;

    const { error: membersError } = await supabaseClient
      .from("server_members")
      .delete()
      .in("username", aliases);
    if (membersError) throw membersError;

    const { error: presenceError } = await supabaseClient
      .from("channel_presence")
      .delete()
      .in("username", aliases);
    if (presenceError) throw presenceError;

    const { error: typingError } = await supabaseClient
      .from("typing")
      .delete()
      .in("username", aliases);
    if (typingError) throw typingError;

    const { error: pushError } = await supabaseClient
      .from("push_subscriptions")
      .delete()
      .in("username", aliases);
    if (pushError) throw pushError;

    const { error: reportsByError } = await supabaseClient
      .from("reports")
      .delete()
      .in("reporter", aliases);
    if (reportsByError) throw reportsByError;

    const { error: reportsAgainstError } = await supabaseClient
      .from("reports")
      .delete()
      .in("reported_user", aliases);
    if (reportsAgainstError) throw reportsAgainstError;

    const { error: userError } = await supabaseClient
      .from("users")
      .delete()
      .in("username", aliases);

    if (userError) throw userError;

    messagesMap.forEach((li, id) => {
      if (aliases.includes(li.dataset.user)) { li.remove(); messagesMap.delete(id); }
    });

    // Refresh member list in case this user existed in the current server.
    await loadServerMembers();

    alert(`✅ Deleted user aliases (${aliases.join(", ")}) and related data.`);
  } catch (err) {
    console.error("deleteUser failed", err);
    alert("❌ Failed: " + err.message);
  }
}

async function kickMemberFromCurrentServer(targetMember) {
  if (!targetMember?.username || !currentServerId) return;
  if (!confirm(`Kick "${targetMember.username}" from this server?`)) return;

  const q = supabaseClient
    .from("server_members")
    .delete()
    .eq("server_id", currentServerId)
    .eq("username", targetMember.username);
  const { error } = targetMember.id ? await q.eq("id", targetMember.id) : await q;

  if (error) {
    alert("❌ Failed to kick member: " + error.message);
    return;
  }

  if (targetMember.id) {
    await supabaseClient
      .from("server_member_roles")
      .delete()
      .eq("server_id", currentServerId)
      .eq("member_id", targetMember.id);
  }

  await loadServerMembers();
  alert(`✅ Kicked ${targetMember.username} from this server.`);
}

// Show info about a user
async function userInfo(author) {
  try {
    const { data, error } = await supabaseClient
      .from("users")
      .select("*")
      .eq("username", author)
      .maybeSingle();

    if (error) throw error;

    const { data: msgData } = await supabaseClient
      .from("messages")
      .select("id")
      .eq("username", author);

    const msgCount = msgData ? msgData.length : "?";

    // Look up per-server block/mute status (block & mute are now scoped to a
    // single server rather than global on the users table).
    let serverStatusLine = "";
    if (currentServerId) {
      try {
        const { data: memberRow } = await supabaseClient
          .from("server_members")
          .select("blocked, muted_until")
          .eq("server_id", currentServerId)
          .eq("username", author)
          .maybeSingle();
        if (memberRow) {
          serverStatusLine =
            `🚫 Blocked (this server): ${memberRow.blocked ? "Yes" : "No"}\n` +
            `🔇 Muted Until (this server): ${memberRow.muted_until || "Not muted"}\n`;
        } else {
          serverStatusLine = "ℹ️ Not a member of this server\n";
        }
      } catch (statusErr) {
        console.warn("⚠️ Failed to load per-server status:", statusErr.message);
      }
    }

    // IP lives on the messages rows, not the users row — grab it from the most recent message
    let lastIp = "Unknown";
    const { data: ipRow } = await supabaseClient
      .from("messages")
      .select("ip")
      .eq("username", author)
      .not("ip", "is", null)
      .neq("ip", "unknown")
      .order("inserted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ipRow?.ip) lastIp = ipRow.ip;

    alert(
      `👤 User: ${author}\n` +
      `🎭 System Role: ${data.system_role || "User"}\n` +
      serverStatusLine +
      `🌐 Last IP: ${lastIp}\n` +
      `💬 Messages: ${msgCount}`
    );
  } catch (err) {
    console.error("userInfo failed", err);
    alert("❌ Could not fetch user info: " + err.message);
  }
}

// Export chat as a text file
async function exportChat() {
  try {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("*")
      .order("inserted_at", { ascending: true });

    if (error) throw error;

    const lines = data.map(m =>
      `[${new Date(m.inserted_at).toLocaleString()}] ${m.username} (${m.role}): ${m.content}`
    );

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("exportChat failed", err);
    alert("❌ Export failed: " + err.message);
  }
}



async function promote(author) {
  try {
    const { data, error } = await supabaseClient
      .from("server_members")
      .select("role")
      .eq("server_id", currentServerId)
      .eq("username", author)
      .maybeSingle();

    if (error) throw error;

    const currentUserRole = normalizeServerRole(data?.role || "User");
    const newRole = prompt(`Current role for "${author}" in this server: ${currentUserRole}\n\nEnter new role (User / Manager / Admin):`);
    if (!newRole) return;

    const allowedRoles = ["User", "Manager", "Admin"];
    const trimmedRole = normalizeServerRole(newRole, "");
    if (!trimmedRole || !allowedRoles.includes(trimmedRole)) {
      alert('❌ Invalid role. Must be "User", "Manager", or "Admin".\n\nSysManager and SysAdmin roles can only be assigned from the database.');
      return;
    }

    const { error: updateError } = await supabaseClient
      .from("server_members")
      .update({})
      .eq("server_id", currentServerId)
      .eq("username", author);

    if (updateError) throw updateError;

    alert(`✅ "${author}" is now a ${trimmedRole} in this server.`);
    loadServerMembers();
  } catch (err) {
    console.error("promote failed", err);
    alert("❌ Failed: " + err.message);
  }
}

// Transfer server ownership to another user
async function transferOwnership() {
  if (!isServerOwner()) {
    alert("You must be the server owner to transfer ownership.");
    return;
  }

  const server = servers.find(s => s.id === currentServerId);
  if (!server) {
    alert("Server not found.");
    return;
  }

  const newOwner = prompt(`Transfer ownership of "${server.name}" to which username?`);
  if (!newOwner) return;

  const trimmedOwner = String(newOwner || "").trim();
  if (!trimmedOwner) {
    alert("Invalid username.");
    return;
  }

  if (trimmedOwner.toLowerCase() === username.toLowerCase()) {
    alert("You already own this server.");
    return;
  }

  if (!confirm(`Are you sure you want to transfer ownership of "${server.name}" to "${trimmedOwner}"?\n\nThis action cannot be undone!`)) {
    return;
  }

  try {
    // Check if the new owner exists
    const { data: userExists, error: userError } = await supabaseClient
      .from("users")
      .select("username")
      .eq("username", trimmedOwner)
      .maybeSingle();

    if (userError) throw userError;
    if (!userExists) {
      alert(`User "${trimmedOwner}" does not exist.`);
      return;
    }

    // Ensure the new owner is a server member
    const { data: memberData, error: memberError } = await supabaseClient
      .from("server_members")
      .select("id")
      .eq("server_id", currentServerId)
      .eq("username", trimmedOwner)
      .maybeSingle();

    if (memberError) throw memberError;

    if (!memberData) {
      // Add the new owner as a server member
      const { error: addMemberError } = await supabaseClient
        .from("server_members")
        .insert({
          server_id: currentServerId,
          username: trimmedOwner,
          role: "Admin",
          joined_at: new Date().toISOString()
        });

      if (addMemberError) throw addMemberError;
    }

    // Transfer ownership
    const { error: transferError } = await supabaseClient
      .from("servers")
      .update({ owner_username: trimmedOwner })
      .eq("id", currentServerId);

    if (transferError) throw transferError;

    // Update local server data
    server.owner_username = trimmedOwner;

    alert(`Ownership of "${server.name}" has been transferred to "${trimmedOwner}".`);

    // Refresh server data
    await loadServers();
  } catch (err) {
    console.error("transferOwnership failed", err);
    alert("Failed to transfer ownership: " + err.message);
  }
}

// Force logout a user
async function forceLogout(author) {
  if (!confirm(`Force logout "${author}"?`)) return;

  try {
    const { error } = await supabaseClient
      .from("users")
      .update({ forceLogout: true })
      .eq("username", author);

    if (error) throw error;

    alert(`✅ Force logout triggered for "${author}".`);
  } catch (err) {
    console.error("forceLogout failed", err);
    alert("❌ Failed: " + err.message);
  }
}

// ======================== DISCORD STYLE FEATURES ========================


// ---------------- EDIT MESSAGE ----------------
async function editMessage(messageId) {
  if (isUserBlockedOrMutedSync()) {
  alert("❌ You cannot edit messages.");
  return;
}
  const msg = messageDataMap.get(Number(messageId));
  if (!msg) return;

  const newText = prompt("Edit message:", msg.content);
  if (!newText || newText === msg.content) return;

  const { error } = await supabaseClient
    .from("messages")
    .update({ content: newText })
    .eq("id", messageId)
    .select(); // 🔥 IMPORTANT

  if (error) {
    console.error("Edit failed", error);
    alert("❌ Edit failed: " + error.message);
  }
}

// ---------------- REACTION BUBBLES ----------------
async function addReaction(messageId, emoji) {
  if (isUserBlockedOrMutedSync()) {
  alert("❌ You are muted.");
  return;
}
  try {
    const normalizedMessageId = Number(messageId);
    let existing = findMyReactionIds(normalizedMessageId, emoji).map((id) => ({ id }));

    if (existing.length === 0 && !reactionSummaryByMessage.has(normalizedMessageId)) {
      const { data, error } = await supabaseClient
        .from("reactions")
        .select("id")
        .eq("message_id", normalizedMessageId)
        .eq("username", username)
        .eq("emoji", emoji);

      if (error) throw error;
      existing = data || [];
    }

    if (existing && existing.length > 0) {
      const removedRecords = existing
        .map((record) => reactionDetailsMap.get(record.id))
        .filter(Boolean);
      existing.forEach((record) => removeReactionRecordById(record.id));
      const existingLi = messagesMap.get(normalizedMessageId);
      if (existingLi) renderReactions(normalizedMessageId, existingLi);

      // ❌ REMOVE ALL matching reactions (fixes duplicates too)
      const ids = existing.map(r => r.id);

      const { error: deleteError } = await supabaseClient
        .from("reactions")
        .delete()
        .in("id", ids);

      if (deleteError) {
        removedRecords.forEach((record) => upsertReactionRecord(record));
        if (existingLi) renderReactions(normalizedMessageId, existingLi);
        console.error("❌ Delete reaction failed:", deleteError);
        alert(`Could not remove reaction: ${deleteError.message}`);
        return;
      }

    } else {
      const tempId = `pending:${normalizedMessageId}:${emoji}:${username}:${Date.now()}`;
      const pendingKey = getPendingReactionKey(normalizedMessageId, emoji);
      pendingReactionInsertMap.set(pendingKey, tempId);
      upsertReactionRecord({
        id: tempId,
        message_id: normalizedMessageId,
        username,
        emoji
      });
      const existingLi = messagesMap.get(normalizedMessageId);
      if (existingLi) renderReactions(normalizedMessageId, existingLi);

      // ✅ ADD reaction
      const { error: insertError } = await supabaseClient
        .from("reactions")
        .insert({
          message_id: normalizedMessageId,
          username: username,
          emoji: emoji
        });

      if (insertError) {
        pendingReactionInsertMap.delete(pendingKey);
        removeReactionRecordById(tempId);
        if (existingLi) renderReactions(normalizedMessageId, existingLi);
        throw insertError;
      }
    }

  } catch (err) {
    console.error("Reaction error", err);
  }
}

// ------------------------ Reactions ------------------------
async function renderReactions(messageId, li) {
  const normalizedMessageId = Number(messageId);
  const reactionsContainer = ensureReactionContainer(li);
  if (!reactionsContainer) return;

  reactionsContainer.innerHTML = "";

  try {
    if (!reactionSummaryByMessage.has(normalizedMessageId)) {
      const { data: reactions, error } = await supabaseClient
        .from("reactions")
        .select("*")
        .eq("message_id", normalizedMessageId);

      if (error) {
        console.error("❌ Error fetching reactions:", error);
        return;
      }

      setReactionSnapshot(normalizedMessageId, reactions || []);
    }

    const summary = reactionSummaryByMessage.get(normalizedMessageId);
    if (!summary || summary.size === 0) return;

    Array.from(summary.entries()).forEach(([emoji, info]) => {
      const iMine = findMyReactionIds(normalizedMessageId, emoji).length > 0;
      const bubble = document.createElement("span");
      bubble.className = "reactionBubble";
      const isUrl = emoji.startsWith("http") || emoji.startsWith("data:");
      if (isUrl) {
        const img = document.createElement("img");
        img.src = emoji;
        img.style.width = "18px";
        img.style.height = "18px";
        img.style.verticalAlign = "middle";
        img.style.objectFit = "contain";
        const ceName = customEmojis.find(e => e.url === emoji)?.name || "custom";
        img.alt = ceName;
        bubble.appendChild(img);
        bubble.appendChild(document.createTextNode(` ${info.count}`));
        bubble.title = `${ceName} — ${info.users.join(", ")}`;
      } else {
        bubble.textContent = `${emoji} ${info.count}`;
        bubble.title = info.users.join(", ");
      }
      if (iMine) bubble.classList.add("mine");

      bubble.onclick = async (e) => {
        e.stopPropagation();
        bubble.style.opacity = "0.5";
        bubble.style.pointerEvents = "none";
        await addReaction(messageId, emoji);
        // Re-render is handled by the realtime subscription — no manual call needed
      };

      reactionsContainer.appendChild(bubble);
    });
  } catch (err) {
    console.error("Failed to load reactions:", err);
  }
}


// ---------------- REPLIES ----------------

let replyingTo = null;

function clearReply() {
  replyingTo = null;
  document.getElementById("replyBanner").style.display = "none";
  input.placeholder = "Message #general";
}

async function startReply(messageId) {
  if (isUserBlockedOrMutedSync()) {
  alert("❌ You are muted.");
  return;
}
  replyingTo = messageId;

  const li = messagesMap.get(Number(messageId));
  if (!li) return;

  const author = li.dataset.user === "Frenchwizz" ? "Takeo" : li.dataset.user;
  const content = li.querySelector(".content")?.textContent || "";

  document.getElementById("replyBannerText").textContent =
    `Replying to ${author}: ${content.substring(0, 50)}${content.length > 50 ? "…" : ""}`;
  document.getElementById("replyBanner").style.display = "flex";
  input.placeholder = `Replying to ${author}…`;
  input.focus();
}

// Cancel button and Escape key
document.getElementById("cancelReplyBtn").addEventListener("click", clearReply);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    clearReply();
  }
});



async function sendReply(content) {

  if (!replyingTo) return;

  await supabaseClient
    .from("messages")
    .insert({
      username: username,
      content: content,
      role: currentRole,
      reply_to: replyingTo
    });

  replyingTo = null;

}



// ---------------- RENDER REPLY PREVIEW ----------------

function renderReply(msg, li) {

  if (!msg.reply_to) return;

  const original = messagesMap.get(msg.reply_to);
  if (!original) return;

  const preview = document.createElement("div");
  preview.className = "replyPreview";

  const name = original.dataset.user;
  const text = original.querySelector(".content")?.innerHTML || "";

  preview.textContent = `Replying to ${name}: ${text.substring(0,40)}...`;

  li.prepend(preview);

}



// ---------------- TYPING INDICATOR ----------------

// Initialize once
const typingChannel = supabaseClient.channel('typing-indicator')
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "typing" }, () => {
    updateTypingUI();
  })
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "typing" }, () => {
    updateTypingUI();
  })
  .subscribe();

// Simplified input handler
input.addEventListener("input", async () => {
  if (!username) return;

  // Debounce locally before sending to DB
  clearTimeout(typingTimeout);

  // Send "typing" status
  await supabaseClient.from("typing").upsert({
    username: username,
    typing: true,
    updated_at: new Date()
  });

  typingTimeout = setTimeout(async () => {
    await supabaseClient.from("typing").update({ typing: false })
      .eq("username", username);
  }, 2000);
});




// ---------------- HOVER CONTROLS ----------------

function attachHoverControls(li, msg) {
  const controls = document.createElement("div");
  controls.className = "hoverControls";

  const replyBtn = document.createElement("button");
  replyBtn.textContent = "↩";
  replyBtn.title = "Reply";
  replyBtn.onclick = () => startReply(msg.id);

  if (currentConversationType === "channel") {
    const reactBtn = document.createElement("button");
    reactBtn.textContent = "😀";
    reactBtn.className = "emoji-trigger";
    reactBtn.title = "React";
    reactBtn.onclick = (e) => {
      e.stopPropagation();
      const rect = reactBtn.getBoundingClientRect();
      openEmojiPicker(msg.id, rect.left, rect.bottom + 4);
    };
    controls.appendChild(reactBtn);
  }
  controls.appendChild(replyBtn);

  li.style.position = "relative";
  li.appendChild(controls);
}


// ---------------- PATCH INTO MESSAGE RENDER ----------------

// call this inside renderMessage AFTER message content is created

function enhanceMessage(li, msg) {

  attachHoverControls(li, msg);

  // renderReply is now handled in renderMessage with replyContext for Discord-style
  // renderReply(msg, li);

}


// ======================== THREAD SYSTEM ========================

function displayName(u) {
  return getEffectiveDisplayName(u);
}


// ===================== Force Logout Logic =====================
function watchForceLogout(currentUsername) {
  supabaseClient
    .channel('force-logout')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `username=eq.${currentUsername}`
      },
      (payload) => {
        if (payload.new.forceLogout) {
          handleForcedLogout();
        }
      }
    )
    .subscribe();
}

function handleForcedLogout() {
  console.log("💀 You have been force logged out");

  // 🔥 Clear EVERYTHING
  localStorage.clear();
  sessionStorage.clear();

  // Optional: clear cookies too
  document.cookie.split(";").forEach(c => {
    document.cookie = c
      .replace(/^ +/, "")
      .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });

  // Supabase logout
  supabaseClient.auth.signOut();

  alert("You have been logged out by an admin.");

  // Reload or redirect
  location.reload() // or just location.reload()
}

// ======================== FILE UPLOAD ========================
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");

// Open file picker when upload button is clicked
uploadBtn.addEventListener("click", () => {
  if (currentConversationType === "channel" && !canPostImagesInChannel()) {
    alert("❌ Only Managers, Admins, and SysAdmins can post images.");
    return;
  }
  fileInput.click();
});

// Handle file selection
fileInput.addEventListener("change", async (e) => {
  if (isUserBlockedOrMutedSync()) {
  alert("❌ You cannot upload files.");
  return;
}
  const file = e.target.files[0];
  if (!file) return;

  // Validate file size (e.g., max 10MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    alert("❌ File too large. Max 10MB allowed.");
    fileInput.value = "";
    return;
  }

  // Show loading state
  uploadBtn.textContent = "⏳";
  uploadBtn.disabled = true;

  try {
    // 1. Generate unique filename
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name.replace(/\s+/g, "_")}`;

    // 2. Upload to Supabase Storage
    const { error: uploadError } = await supabaseClient.storage
  .from("chat-files")
  .upload(fileName, file);

    if (uploadError) throw uploadError;

    // 3. Get public URL
    const { data: urlData } = supabaseClient.storage
      .from("chat-files")
      .getPublicUrl(fileName);

    // 4. Send message with file link
    const fileLink = urlData.publicUrl;
    const messageContent = `[📄 ${file.name}](${fileLink})`;

    // Insert message directly (bypassing normal input flow)
    const messageData = {
      username,
      content: messageContent,
      role: currentRole,
      is_pinned: false,
      ip: "unknown" // You could fetch IP here if needed
    };

    if (replyingTo) {
      messageData.reply_to = replyingTo;
    }

    let insertError = null;
    if (currentConversationType === "dm") {
      messageData.conversation_id = currentDmConversationId;
      ({ error: insertError } = await supabaseClient
        .from("dm_messages")
        .insert([messageData]));
    } else {
      messageData.channel_id = currentChannelId;
      ({ error: insertError } = await supabaseClient
        .from("messages")
        .insert([messageData]));
    }

    if (insertError) throw insertError;

    // Reset UI
    input.value = "";
    fileInput.value = "";
    replyingTo = null;
    uploadBtn.textContent = "📎";
    uploadBtn.disabled = false;

    console.log("✅ File uploaded successfully");

  } catch (err) {
    console.error("Upload failed:", err);
    alert("❌ Upload failed: " + err.message);
    uploadBtn.textContent = "📎";
    uploadBtn.disabled = false;
    fileInput.value = "";
  }
});

function updateTypingUI() {
  const box = document.getElementById("typingIndicator");
  if (!box) return;

  supabaseClient
    .from("typing")
    .select("username, updated_at, typing")
    .eq("typing", true)
    .then(({ data }) => {
      if (!data) {
        box.textContent = "";
        return;
      }

      const now = Date.now();

      const typingUsers = data
        .filter(u => 
          u.username !== username &&
          now - new Date(u.updated_at).getTime() < 5000 // ignore stale
        )
        .map(u => u.username);

      const dots = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
      if (typingUsers.length === 0) {
        box.innerHTML = "";
      } else if (typingUsers.length === 1) {
        box.innerHTML = `<strong>${typingUsers[0]}</strong> is typing${dots}`;
      } else if (typingUsers.length === 2) {
        box.innerHTML = `<strong>${typingUsers[0]}</strong> and <strong>${typingUsers[1]}</strong> are typing${dots}`;
      } else {
        box.innerHTML = `<strong>${typingUsers[0]}</strong> and <strong>${typingUsers.length - 1}</strong> others are typing${dots}`;
      }
    });
}

function getFileType(url) {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];

    const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
    if (!match) return "unknown";

    const ext = match[1].toLowerCase();

    if (["png","jpg","jpeg","gif","webp","bmp","svg"].includes(ext)) return "image";
    if (["mp4","webm","ogg","mov"].includes(ext)) return "video";
    if (["mp3","wav","ogg"].includes(ext)) return "audio";
    if (["pdf","txt","doc","docx"].includes(ext)) return "document";

    return "unknown";
  } catch {
    return "unknown";
  }
}

// ======================== DISCORD-STYLE LIGHTBOX ========================

function openLightbox(src) {
  const existing = document.getElementById("lightboxOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "lightboxOverlay";

  const imgWrap = document.createElement("div");
  imgWrap.className = "lightbox-img-wrap";
  const img = document.createElement("img");
  img.src = src;
  imgWrap.appendChild(img);

  const closeBtn = document.createElement("button");
  closeBtn.className = "lightbox-close";
  closeBtn.textContent = "✕";
  closeBtn.title = "Close (ESC)";
  closeBtn.onclick = (e) => { e.stopPropagation(); closeLightbox(overlay); };

  const toolbar = document.createElement("div");
  toolbar.className = "lightbox-toolbar";

  const openLink = document.createElement("a");
  openLink.href = src;
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.textContent = "⧉  Open in browser";
  openLink.onclick = (e) => e.stopPropagation();

  const dlLink = document.createElement("a");
  dlLink.href = src;
  dlLink.download = src.split("/").pop().split("?")[0] || "image";
  dlLink.textContent = "⬇  Download";
  dlLink.onclick = (e) => e.stopPropagation();

  toolbar.appendChild(openLink);
  toolbar.appendChild(dlLink);

  overlay.appendChild(closeBtn);
  overlay.appendChild(imgWrap);
  overlay.appendChild(toolbar);
  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add("visible"));
  });

  // Click backdrop to close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target === imgWrap) closeLightbox(overlay);
  });
}

function closeLightbox(overlay) {
  overlay.classList.remove("visible");
  setTimeout(() => overlay.remove(), 160);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const overlay = document.getElementById("lightboxOverlay");
    if (overlay) closeLightbox(overlay);
  }
});

document.addEventListener("click", (e) => {
  if (e.target.tagName !== "IMG") return;

  // Always open lightbox for uploaded message images
  if (e.target.classList.contains("msg-image")) {
    openLightbox(e.target.src);
    return;
  }

  // Skip emoji/icon areas for everything else
  const skip = e.target.closest(
    ".reactionBubble, .reactionBar, .hoverControls, .server-icon, .emoji-trigger"
  );
  if (skip) return;

  // Use rendered size (reliable even before naturalWidth resolves)
  const rect = e.target.getBoundingClientRect();
  if (rect.width < 60 || rect.height < 60) return;

  openLightbox(e.target.src);
});

// ======================== SCROLL-TO-BOTTOM BUTTON ========================

(function initScrollBottomBtn() {
  const btn = document.getElementById("scrollBottomBtn");
  if (!btn) return;

  messagesList.addEventListener("scroll", () => {
    const distFromBottom = messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight;
    if (distFromBottom > 200) {
      btn.classList.add("visible");
    } else {
      btn.classList.remove("visible");
    }
  });

  btn.addEventListener("click", () => {
    messagesList.scrollTo({ top: messagesList.scrollHeight, behavior: "smooth" });
  });
})();

function handleReaction(messageId, emoji) {
  const li = messagesMap.get(Number(messageId));
  if (!li) return;

  // Trigger the database update
  addReaction(messageId, emoji);

  // Immediately re-render to show the change
  renderReactions(messageId, li);
}

function formatMessageContent(content, role) {
  // Handle extremely long messages by truncating them
  const MAX_MESSAGE_LENGTH = 10000; // 10k characters limit
  if (content.length > MAX_MESSAGE_LENGTH) {
    content = content.substring(0, MAX_MESSAGE_LENGTH) + "...";
  }

  // Detect triple backtick code block
  const codeBlockMatch = content.match(/```([\s\S]*?)```/);

  if (codeBlockMatch) {
    const code = codeBlockMatch[1];
    return `<pre class="code-block"><code>${escapeHTML(code)}</code></pre>`;
  }

  // If admin → allow raw HTML
  if (role === "Admin") {
    // For admins, we still want to process channel mentions for consistency
    // But we must be careful not to break their raw HTML.
    // We'll process mentions first, then let raw HTML pass through if not in a code block.
    // Note: This is a simplified approach. A robust parser would be better.
    let processed = content;
    // Replace #channel with styled span
    processed = processed.replace(/#([a-zA-Z0-9_-]+)/g, (match, channelName) => {
      return `<span class="channel-mention" data-channel="${channelName}">#${escapeHTML(channelName)}</span>`;
    });
    return processed;
  }

  // If user → escape everything first
  let escaped = escapeHTML(content);

  // Now replace #channel patterns in the escaped string
  // The pattern looks for # followed by alphanumeric/underscore/hyphen
  // We need to be careful not to match inside HTML entities if we had any, but escapeHTML handles that.
  escaped = escaped.replace(/#([a-zA-Z0-9_-]+)/g, (match, channelName) => {
    return `<span class="channel-mention" data-channel="${channelName}">#${channelName}</span>`;
  });

  // Handle very long words that could break layout
  escaped = escaped.replace(/(\S{50,})/g, (match, longWord) => {
    // Insert zero-width spaces every 20 characters to allow word breaking
    return longWord.replace(/(.{20})/g, '$1\u200B');
  });

  return escaped;
}

function executeScripts(container) {
  const scripts = container.querySelectorAll("script");

  scripts.forEach(oldScript => {
    const newScript = document.createElement("script");

    // 1. Copy all attributes EXCEPT 'defer' (which is useless for dynamic scripts)
    for (let attr of oldScript.attributes) {
      if (attr.name !== "defer") {
        newScript.setAttribute(attr.name, attr.value);
      }
    }

    // 2. Handle Inline Scripts
    if (!oldScript.src) {
      newScript.textContent = oldScript.textContent;
      // Inline scripts MUST be replaced in place to run
      oldScript.parentNode.replaceChild(newScript, oldScript);
    } 
    // 3. Handle External Scripts (GoFundMe, etc.)
    else {
      // A. Create a clone to track if it loads
      const tempScript = newScript.cloneNode();
      
      // B. Set up success/failure handlers BEFORE appending
      tempScript.onload = () => {
        console.log(`✅ External script loaded: ${oldScript.src}`);
        // Optional: Remove the temporary tracking script if you want
        // tempScript.remove(); 
      };
      tempScript.onerror = (e) => {
        console.error(`❌ External script failed: ${oldScript.src}`, e);
        // If you have an admin console, log it there too
        if (typeof appendLine === 'function' && typeof activeFilters !== 'undefined') {
           appendLine(adminConsoleOutput, activeFilters, { 
             type: "ERROR", 
             parts: [`💥 GoFundMe/External Script Failed: ${oldScript.src}`], 
             raw: e 
           });
        }
      };

      // C. Append the NEW script to the body (triggers network request)
      document.body.appendChild(tempScript);

      // D. CRITICAL: Remove the OLD script tag immediately to prevent conflicts
      // If we don't remove this, the browser might think the script is "already there"
      // or the widget logic might fail to find the container.
      oldScript.remove(); 
    }
  });
}


function showMentionToast(msg) {
  const toast = document.createElement("div");
  toast.textContent = /@(everyone|here)\b/i.test(String(msg.content || ""))
    ? `📣 ${msg.username} pinged everyone`
    : `📣 ${msg.username} mentioned you`;

  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.background = "#5865f2";
  toast.style.color = "white";
  toast.style.padding = "10px 15px";
  toast.style.borderRadius = "8px";
  toast.style.zIndex = "9999";

  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

function startMuteCountdownUI() {
  const input = document.getElementById("messageInput");

  if (muteInterval) return;

  muteInterval = setInterval(() => {
    const diff = new Date(mutedUntil) - new Date();

    if (diff <= 0) {
      clearInterval(muteInterval);
      muteInterval = null;

      mutedUntil = null;
      applyMuteBlockUI();
      return;
    }

    const seconds = Math.ceil(diff / 1000);
    input.placeholder = `🔇 Muted (${seconds}s)`;
  }, 1000);
}

function stopMuteCountdownUI() {
  if (muteInterval) {
    clearInterval(muteInterval);
    muteInterval = null;
  }
}

async function updateMuteUI() {
  const el = document.getElementById("muteTimer");
  if (!el) return;

  if (!currentServerId || !username) {
    el.style.display = "none";
    return;
  }

  const { data } = await supabaseClient
    .from("server_members")
    .select("muted_until")
    .eq("server_id", currentServerId)
    .eq("username", username)
    .maybeSingle();

  if (!data || !data.muted_until) {
    el.style.display = "none";
    return;
  }

  const interval = setInterval(() => {
    const now = new Date();
    const end = new Date(data.muted_until);
    const diff = end - now;

    if (diff <= 0) {
      el.style.display = "none";
      clearInterval(interval);
      return;
    }

    const seconds = Math.floor(diff / 1000);
    el.style.display = "block";
    el.textContent = `🔇 Muted for ${seconds}s`;
  }, 1000);
}

// ===== Per-server block/mute state subscription =====
var _ownServerStatusSub = null;

async function refreshOwnServerMemberStatus() {
  // Reset state when leaving any server context.
  if (!currentServerId || !username) {
    isBlocked = false;
    mutedUntil = null;
    applyMuteBlockUI();
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("server_members")
      .select("blocked, muted_until")
      .eq("server_id", currentServerId)
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    isBlocked = data?.blocked || false;
    mutedUntil = data?.muted_until || null;
  } catch (err) {
    console.warn("⚠️ Failed to load own server-member status:", err.message);
    isBlocked = false;
    mutedUntil = null;
  }

  applyMuteBlockUI();
}

function subscribeToOwnServerStatus(serverId) {
  if (_ownServerStatusSub) {
    try { _ownServerStatusSub.unsubscribe(); } catch {}
    _ownServerStatusSub = null;
  }
  if (!serverId || !username) return;

  _ownServerStatusSub = supabaseClient
    .channel(`own-server-status-${serverId}-${username}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "server_members",
        filter: `server_id=eq.${serverId}`
      },
      (payload) => {
        const row = payload.new;
        if (!row || row.username !== username) return;
        isBlocked = row.blocked || false;
        mutedUntil = row.muted_until || null;
        applyMuteBlockUI();
      }
    )
    .subscribe();
}

// Legacy hook kept so existing callers don't break; per-server status is now
// wired up inside switchServer() via refreshOwnServerMemberStatus().
function subscribeToUserStatus() {
  // no-op: replaced by per-server subscription set up in switchServer().
}

function applyMuteBlockUI() {
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendButton");
  if (!input) return;

  const reason = muteReason();
  // Update the small mute pill on the user panel any time the UI refreshes.
  updateSelfMuteBadge();

  if (reason === "self") {
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    input.placeholder = "🔇 You muted yourself — tap the mic icon to unmute";
    stopMuteCountdownUI();
    return;
  }

  if (reason === "global") {
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    startGlobalMuteCountdownUI();
    return;
  }

  if (reason === "blocked") {
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    input.placeholder = "🚫 You are blocked in this server";
    stopMuteCountdownUI();
    return;
  }

  if (reason === "server") {
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    startMuteCountdownUI();
    return;
  }

  input.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  input.placeholder = "Type a message...";
  stopMuteCountdownUI();
}

function startGlobalMuteCountdownUI() {
  const input = document.getElementById("messageInput");
  if (muteInterval) return;
  muteInterval = setInterval(() => {
    if (!isGlobalMuteActive()) {
      clearInterval(muteInterval);
      muteInterval = null;
      globalMutedUntil = null;
      applyMuteBlockUI();
      return;
    }
    const seconds = Math.ceil((new Date(globalMutedUntil) - new Date()) / 1000);
    input.placeholder = `🔇 Globally muted by an administrator (${seconds}s)`;
  }, 1000);
  // Run once immediately so placeholder updates without 1s delay.
  const seconds = Math.ceil((new Date(globalMutedUntil) - new Date()) / 1000);
  input.placeholder = `🔇 Globally muted by an administrator (${seconds}s)`;
}

// Self-mute toggle (saved in localStorage; user can clear it any time).
function toggleSelfMute() {
  selfMuted = !selfMuted;
  localStorage.setItem("chatSelfMuted", selfMuted ? "true" : "false");
  applyMuteBlockUI();
  // Also push the voice mic mute state if user is in voice.
  try {
    if (typeof updateVoiceMuteFromSelf === "function") updateVoiceMuteFromSelf();
  } catch {}
}

function updateSelfMuteBadge() {
  const btn = document.getElementById("selfMuteBtn");
  if (!btn) return;
  btn.classList.toggle("active", !!selfMuted);
  btn.title = selfMuted ? "Unmute yourself" : "Mute yourself";
  btn.setAttribute("aria-pressed", selfMuted ? "true" : "false");
  btn.textContent = selfMuted ? "🔇" : "🎤";
}

// ======================== CREATE CHANNEL MODAL LOGIC (FIXED) ========================
(function () {
  const createChannelBtn = document.getElementById("createChannelBtn");
  const modal = document.getElementById("createChannelModal");
  const nameInput = document.getElementById("createChannelNameInput");
  const categorySelect = document.getElementById("createChannelCategorySelect");
  const confirmBtn = document.getElementById("confirmCreateChannelBtn");
  const cancelBtn = document.getElementById("cancelCreateChannelBtn");
  const closeBtn = document.getElementById("closeCreateChannelModal");
  const errorEl = document.getElementById("createChannelError");

  // Helper: Populate Category Dropdown
  function populateCategories() {
    if (!categorySelect || !currentServerId) return;

    // Clear existing options except the first placeholder
    categorySelect.innerHTML = '<option value="">Select a category...</option>';

    const serverCats = categories.filter(c => c.server_id === currentServerId);

    if (serverCats.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No categories available (Create one first)";
      opt.disabled = true;
      categorySelect.appendChild(opt);
      return;
    }

    serverCats.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      categorySelect.appendChild(opt);
    });
  }

  // Helper: Open Modal
  function openCreateChannelModal() {
    if (!userPermissions.manage_roles) {
      alert("You don't have permission to create channels.");
      return;
    }

    populateCategories();

    // Reset Form
    nameInput.value = "";
    errorEl.style.display = "none";
    errorEl.textContent = "";

    modal.style.display = "flex";
    setTimeout(() => nameInput.focus(), 100);
  }

  // Helper: Close Modal
  function closeCreateChannelModal() {
    modal.style.display = "none";
  }

  // Event: Open Modal
  if (createChannelBtn) {
    createChannelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Create Channel Button Clicked!"); 
      openCreateChannelModal();
    });
  } else {
    console.error("❌ #createChannelBtn not found in DOM!");
  }

  // Event: Confirm Create (UPDATED WITH VOICE CHANNEL SUPPORT)
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const categoryId = categorySelect.value;

      // 🔥 NEW: Get Selected Channel Type (Text or Voice)
      const typeRadio = document.querySelector('input[name="channelType"]:checked');
      const channelType = typeRadio ? typeRadio.value : 'text';

      // Validation
      if (!name) {
        errorEl.textContent = "❌ Channel name is required.";
        errorEl.style.display = "block";
        return;
      }

      if (!categoryId) {
        errorEl.textContent = "❌ Please select a category.";
        errorEl.style.display = "block";
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = "⏳ Creating...";
      errorEl.style.display = "none";

      try {
        // Create Channel
        const trimmedName = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

        const { data, error } = await supabaseClient
          .from("channels")
          .insert({
            name: trimmedName,
            created_by: username,
            sort_order: channels.filter(c => c.server_id === currentServerId).length,
            server_id: currentServerId,
            category_id: categoryId,
            channel_type: channelType // 🔥 CRITICAL: Save the type
          })
          .select()
          .single();

        if (error) throw error;

        // Success
        channels.push(data);
        renderChannelList();
        closeCreateChannelModal();

        // Optional: Switch to new channel immediately (except for voice)
        if (channelType === 'text') {
          switchChannel(data.id);
        }

      } catch (err) {
        console.error("Create channel failed:", err);
        errorEl.textContent = "❌ " + (err.message || "Failed to create channel");
        errorEl.style.display = "block";
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Create Channel";
      }
    });
  }

  // Event: Cancel / Close
  if (cancelBtn) cancelBtn.addEventListener("click", closeCreateChannelModal);
  if (closeBtn) closeBtn.addEventListener("click", closeCreateChannelModal);

  // Close on backdrop click
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCreateChannelModal();
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display === "flex") {
      closeCreateChannelModal();
    }
  });

})();

async function loadDefaultChannel() {
  console.log("📡 loadDefaultChannel() called. Channels length:", channels.length);

  if (channels.length === 0) {
    console.error("❌ Channels array is empty! Cannot select default.");
    return;
  }

  const generalChannel = channels.find(ch => String(ch.name || "").toLowerCase() === "general");
  const targetChannelId = generalChannel ? generalChannel.id : channels[0].id;

  console.log("🎯 Target channel ID:", targetChannelId);

  // 🔥 Call switchChannel which handles everything
  switchChannel(targetChannelId);

  setTimeout(() => {
    waitForImagesBeforeScroll();
  }, 200);
}

async function ensureGeneralCategoryAndFixOrphans(serverId, options = {}) {
  const createGeneralChannelIfMissing = options.createGeneralChannelIfMissing !== false;
  if (!serverId) return { changed: false };

  let changed = false;

  const { data: serverCategories, error: catErr } = await supabaseClient
    .from("categories")
    .select("id, name, sort_order, server_id")
    .eq("server_id", serverId)
    .order("sort_order", { ascending: true });
  if (catErr) {
    console.warn("⚠️ Could not read categories:", catErr.message);
    return { changed: false };
  }

  let generalCategory = (serverCategories || []).find(c => String(c.name || "").toLowerCase() === "general");
  if (!generalCategory) {
    const nextSort = Math.max(0, ...(serverCategories || []).map(c => Number(c.sort_order) || 0)) + 1;
    const { data: createdCategory, error: createCatErr } = await supabaseClient
      .from("categories")
      .insert({ name: "General", sort_order: nextSort, created_by: username, server_id: serverId })
      .select("id, name, sort_order, server_id")
      .maybeSingle();
    if (createCatErr) {
      console.warn("⚠️ Could not create General category:", createCatErr.message);
      return { changed: false };
    }
    generalCategory = createdCategory;
    changed = true;
  }

  const { data: serverChannels, error: chErr } = await supabaseClient
    .from("channels")
    .select("id, name, category_id, sort_order, server_id")
    .eq("server_id", serverId)
    .order("sort_order", { ascending: true });
  if (chErr) {
    console.warn("⚠️ Could not read channels:", chErr.message);
    return { changed };
  }

  const orphanIds = (serverChannels || [])
    .filter(ch => !ch.category_id)
    .map(ch => ch.id);
  if (orphanIds.length) {
    const { error: moveErr } = await supabaseClient
      .from("channels")
      .update({ category_id: generalCategory.id })
      .in("id", orphanIds);
    if (!moveErr) changed = true;
    else console.warn("⚠️ Could not move orphan channels:", moveErr.message);
  }

  if (createGeneralChannelIfMissing && (!serverChannels || serverChannels.length === 0)) {
    const { error: newGeneralErr } = await supabaseClient.from("channels").insert({
      name: "general",
      created_by: username,
      sort_order: 0,
      server_id: serverId,
      category_id: generalCategory.id
    });
    if (!newGeneralErr) changed = true;
    else console.warn("⚠️ Could not create #general channel:", newGeneralErr.message);
  }

  return { changed, generalCategoryId: generalCategory.id };
}

initSpotifyPresence();