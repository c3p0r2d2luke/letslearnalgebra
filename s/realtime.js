// ------------------------ Realtime ------------------------
let channel = null;
// ======================== REALTIME MANAGER ========================
let activeMessageChannel = null; // Tracks the current realtime subscription
let activeDmMessageChannel = null;
const SERVER_ORDER_STORAGE_PREFIX = "serverOrder:";
let persistedServerOrderIds = [];
let suppressChannelClickUntil = 0;
let suppressServerClickUntil = 0;

function initRealtime() {
  console.log("📡 Realtime manager initialized.");
  // We don't subscribe here anymore. We subscribe dynamically in switchChannel.
}

function subscribeToDirectMessages() {
  if (dmMembershipSubscription) {
    try { dmMembershipSubscription.unsubscribe(); } catch {}
    dmMembershipSubscription = null;
  }
  if (dmRealtimeSubscription) {
    try { dmRealtimeSubscription.unsubscribe(); } catch {}
    dmRealtimeSubscription = null;
  }
  if (!username) return;

  dmMembershipSubscription = supabaseClient
    .channel(`dm-memberships-${username}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "direct_conversation_members",
        filter: `username=eq.${username}`
      },
      async () => {
        await loadDirectConversations();
      }
    )
    .subscribe();

  dmRealtimeSubscription = supabaseClient
    .channel(`dm-list-updates-${username}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "dm_messages"
      },
      async () => {
        await loadDirectConversations();
      }
    )
    .subscribe();
}

// Helper to unsubscribe from old channel and subscribe to new one
async function subscribeToCurrentChannel() {
  if (!currentChannelId) {
    console.log("⚠️ No channel selected. Unsubscribing from messages.");
    if (activeMessageChannel) {
      await activeMessageChannel.unsubscribe();
      activeMessageChannel = null;
    }
    return;
  }

  console.log(`🔄 Subscribing to messages for channel ID: ${currentChannelId}`);

  // 1. Unsubscribe from previous channel if exists
  if (activeMessageChannel) {
    await activeMessageChannel.unsubscribe();
    activeMessageChannel = null;
  }

  // 2. Subscribe to the NEW channel with a filter
  activeMessageChannel = supabaseClient
    .channel(`messages-channel-${currentChannelId}`)
    .on(
      "postgres_changes",
      { 
        event: "*", 
        schema: "public", 
        table: "messages",
        filter: `channel_id=eq.${currentChannelId}` // 🔥 CRITICAL FILTER
      },
      (payload) => {
        console.log("📩 Realtime message event:", payload.eventType);
        const msg = payload.eventType === "DELETE" ? payload.old : (payload.new || payload.old);
        handleRealtimeMessage(msg, payload.eventType);
      }
    )
    .subscribe((status) => {
      console.log(`Realtime status for channel ${currentChannelId}:`, status);
    });
}

supabaseClient
  .channel("reactions-channel")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "reactions" },
    payload => {
      let msgId = payload.new?.message_id ?? payload.old?.message_id;

      if (payload.eventType === "INSERT" && payload.new) {
        const pendingKey = getPendingReactionKey(payload.new.message_id, payload.new.emoji, payload.new.username);
        const pendingId = pendingReactionInsertMap.get(pendingKey);
        if (pendingId) {
          removeReactionRecordById(pendingId);
          pendingReactionInsertMap.delete(pendingKey);
        }
        upsertReactionRecord(payload.new);
        msgId = payload.new.message_id;
      } else if (payload.eventType === "UPDATE") {
        if (payload.old?.id) removeReactionRecordById(payload.old.id);
        if (payload.new) {
          upsertReactionRecord(payload.new);
          msgId = payload.new.message_id;
        }
      } else if (payload.old?.id) {
        const existing = reactionDetailsMap.get(payload.old.id);
        msgId = msgId ?? existing?.message_id ?? reactionMessageMap.get(payload.old.id);
        removeReactionRecordById(payload.old.id);
      }

      const li = messagesMap.get(Number(msgId));
      if (li && msgId) renderReactions(msgId, li);
    }
  )
  .subscribe();

const channelList = document.getElementById("channelList");

function getServerOrderStorageKey() {
  return `${SERVER_ORDER_STORAGE_PREFIX}${username || "guest"}`;
}

async function loadPersistedServerOrder() {
  persistedServerOrderIds = [];
  try {
    const { data, error } = await supabaseClient
      .from("user_server_order")
      .select("server_id, sort_order")
      .eq("username", username)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    persistedServerOrderIds = (data || []).map((row) => row.server_id).filter(Boolean);
  } catch (error) {
    console.warn("⚠️ Failed to load persisted server order:", error);
  }
}

async function saveServerOrder() {
  const orderedServerIds = servers.map((server) => server.id);
  persistedServerOrderIds = [...orderedServerIds];

  try {
    localStorage.setItem(getServerOrderStorageKey(), JSON.stringify(orderedServerIds));
  } catch (error) {
    console.warn("⚠️ Failed to save local server order:", error);
  }

  if (!username || orderedServerIds.length === 0) return;

  try {
    const payload = orderedServerIds.map((serverId, index) => ({
      username,
      server_id: serverId,
      sort_order: index
    }));

    const { error } = await supabaseClient
      .from("user_server_order")
      .upsert(payload, { onConflict: "username,server_id" });

    if (error) throw error;
  } catch (error) {
    console.warn("⚠️ Failed to save persisted server order:", error);
  }
}

function applyStoredServerOrder() {
  try {
    if (!Array.isArray(servers) || servers.length === 0) return;
    const localRaw = localStorage.getItem(getServerOrderStorageKey());
    const localOrder = localRaw ? JSON.parse(localRaw) : [];
    const order = persistedServerOrderIds.length > 0 ? persistedServerOrderIds : localOrder;
    if (!Array.isArray(order) || order.length === 0) return;
    const rank = new Map(order.map((id, index) => [id, index]));
    servers.sort((a, b) => {
      const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    });
  } catch (error) {
    console.warn("⚠️ Failed to apply stored server order:", error);
  }
}

function shouldSuppressClick(untilTs) {
  return Date.now() < untilTs;
}

function getCurrentConversationLabel() {
  if (currentConversationType === "dm") {
    const activeDm = directConversations.find((conversation) => conversation.id === currentDmConversationId);
    return activeDm ? `@${activeDm.otherUsername}` : "Direct Messages";
  }

  const activeChannel = channels.find((channelItem) => channelItem.id === currentChannelId);
  return activeChannel ? `# ${activeChannel.name}` : "# general";
}

function updateConversationHeaderAndInput() {
  document.body.classList.toggle("dm-mode", currentConversationType === "dm");

  const headerEl = document.getElementById("currentChannelName");
  if (headerEl) headerEl.textContent = getCurrentConversationLabel();

  const createBtn = document.getElementById("createChannelBtn");
  if (createBtn) {
    createBtn.style.display = currentConversationType === "dm"
      ? "none"
      : userPermissions.manage_roles ? "inline-block" : "none";
  }

  if (!input) return;
  if (currentConversationType === "dm") {
    const activeDm = directConversations.find((conversation) => conversation.id === currentDmConversationId);
    input.placeholder = activeDm ? `Message @${activeDm.otherUsername}` : "Message...";
  } else {
    const activeChannel = channels.find((channelItem) => channelItem.id === currentChannelId);
    input.placeholder = activeChannel ? `Message #${activeChannel.name}` : "Message...";
  }
  // Re-apply per-server block/mute UI so DMs aren't locked by a server block.
  if (typeof applyMuteBlockUI === "function") applyMuteBlockUI();
}

function sortDirectConversations() {
  directConversations.sort((a, b) => {
    const aTime = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

function renderDmList() {
  const dmSection = document.querySelector('.dm-section');
  if (dmSection) {
    // Only show the channel-sidebar DM section when in DM mode
    dmSection.style.display = currentConversationType === 'dm' ? 'block' : 'none';
  }

  if (!dmListEl) return;

  if (!directConversations.length) {
    dmListEl.innerHTML = `<div class="dm-empty-state">No DMs yet</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  directConversations.forEach((conversation) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `dm-item${currentConversationType === "dm" && conversation.id === currentDmConversationId ? " active" : ""}`;
    item.dataset.conversationId = conversation.id;
    item.addEventListener("click", () => {
      openDirectConversation(conversation.id);
      if (window.innerWidth <= 768) closeSidebar();
    });

    // Avatar on the left (render profile pic)
    let avatarNode = null;
    try {
      avatarNode = buildAvatarElement(conversation.otherUsername, 'dm-avatar');
    } catch (e) {
      avatarNode = document.createElement('div');
      avatarNode.className = 'dm-avatar';
      avatarNode.textContent = conversation.otherUsername.charAt(0).toUpperCase();
    }

    const nameEl = document.createElement("span");
    nameEl.className = "dm-name";
    nameEl.textContent = `@${conversation.otherUsername}`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "dm-delete-btn";
    deleteBtn.title = `Delete DM with ${conversation.otherUsername}`;
    deleteBtn.setAttribute("aria-label", `Delete DM with ${conversation.otherUsername}`);
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteDirectConversation(conversation.id, conversation.otherUsername);
    });

    item.appendChild(avatarNode);
    item.appendChild(nameEl);
    item.appendChild(deleteBtn);
    fragment.appendChild(item);
  });

  dmListEl.innerHTML = "";
  dmListEl.appendChild(fragment);
}

async function loadDirectConversations() {
  if (!username) return;

  try {
    const { data: memberships, error: membershipsError } = await supabaseClient
      .from("direct_conversation_members")
      .select("conversation_id, joined_at")
      .eq("username", username);

    if (membershipsError) throw membershipsError;

    const conversationIds = (memberships || []).map((membership) => membership.conversation_id).filter(Boolean);
    if (conversationIds.length === 0) {
      directConversations = [];
      renderDmList();
      updateConversationHeaderAndInput();
      return;
    }

    const [{ data: members, error: membersError }, { data: messages, error: messagesError }] = await Promise.all([
      supabaseClient
        .from("direct_conversation_members")
        .select("conversation_id, username")
        .in("conversation_id", conversationIds),
      supabaseClient
        .from("dm_messages")
        .select("conversation_id, username, content, inserted_at")
        .in("conversation_id", conversationIds)
        .order("inserted_at", { ascending: false })
    ]);

    if (membersError) throw membersError;
    if (messagesError) throw messagesError;

    const membersByConversation = new Map();
(members || []).forEach((member) => {
  const key = member.conversation_id;
  if (!membersByConversation.has(key)) membersByConversation.set(key, []);

  membersByConversation.get(key).push({
    username: member.username,
    displayName: getDisplayName(member)
  });
});

    const lastMessageByConversation = new Map();
    (messages || []).forEach((message) => {
      if (!lastMessageByConversation.has(message.conversation_id)) {
        lastMessageByConversation.set(message.conversation_id, message);
      }
    });

    directConversations = (memberships || []).map((membership) => {
      const participants =
  membersByConversation.get(membership.conversation_id) || [];

const otherUser =
  participants.find((participant) => participant.username !== username);

const otherUsername =
  otherUser?.displayName || otherUser?.username || "Unknown";
      const lastMessage = lastMessageByConversation.get(membership.conversation_id);
      return {
        id: membership.conversation_id,
        otherUsername,
        createdAt: membership.joined_at,
        lastMessageAt: lastMessage?.inserted_at || membership.joined_at,
        lastMessagePreview: lastMessage?.content || ""
      };
    }).filter((conversation) => conversation.otherUsername && conversation.otherUsername !== "Unknown");

    await loadAvatarMapForUsernames(directConversations.map((conversation) => conversation.otherUsername));
    sortDirectConversations();
    renderDmList();
    updateConversationHeaderAndInput();
  } catch (error) {
    console.error("❌ Failed to load direct conversations:", error);
    if (dmListEl) dmListEl.innerHTML = `<div class="dm-empty-state">DMs unavailable</div>`;
  }
}

async function deleteDirectConversation(conversationId, otherUsername = "this user") {
  if (!conversationId) return;
  const confirmed = confirm(`Delete your DM with ${otherUsername}?\n\nThis will remove the conversation and all its messages.`);
  if (!confirmed) return;

  try {
    const { error } = await supabaseClient
      .from("direct_conversations")
      .delete()
      .eq("id", conversationId);

    if (error) throw error;

    directConversations = directConversations.filter((conversation) => conversation.id !== conversationId);
    renderDmList();

    if (currentConversationType === "dm" && currentDmConversationId === conversationId) {
      currentConversationType = "channel";
      currentDmConversationId = null;
      await subscribeToCurrentDmConversation(null);
      if (currentServerId && channels.length > 0) {
        await loadDefaultChannel();
      } else {
        messagesList.innerHTML = "";
        messagesMap.clear();
        messageDataMap.clear();
        updateConversationHeaderAndInput();
      }
    }

    await loadDirectConversations();
  } catch (error) {
    console.error("❌ Failed to delete DM:", error);
    alert(`❌ Could not delete DM: ${error.message}`);
  }
}

async function ensureDirectConversation(otherUsername) {
  const normalizedTarget = String(otherUsername || "").trim();
  if (!normalizedTarget) return null;

  const { data: existingMemberships, error: existingMembershipsError } = await supabaseClient
    .from("direct_conversation_members")
    .select("conversation_id, username")
    .in("username", [username, normalizedTarget]);

  if (existingMembershipsError) throw existingMembershipsError;

  const conversationMatches = new Map();
  (existingMemberships || []).forEach((membership) => {
    const key = membership.conversation_id;
    if (!conversationMatches.has(key)) conversationMatches.set(key, new Set());
    conversationMatches.get(key).add(membership.username);
  });

  for (const [conversationId, participants] of conversationMatches.entries()) {
    if (participants.has(username) && participants.has(normalizedTarget) && participants.size === 2) {
      return conversationId;
    }
  }

  const { data: conversation, error: conversationError } = await supabaseClient
    .from("direct_conversations")
    .insert([{}])
    .select("id")
    .single();
  if (conversationError) throw conversationError;

  const { error: memberInsertError } = await supabaseClient
    .from("direct_conversation_members")
    .insert([
      { conversation_id: conversation.id, username },
      { conversation_id: conversation.id, username: normalizedTarget }
    ]);
  if (memberInsertError) throw memberInsertError;

  return conversation.id;
}

async function openDirectConversation(conversationId) {
  const activeDm = directConversations.find((conversation) => conversation.id === conversationId);
  currentConversationType = "dm";
  currentDmConversationId = conversationId;
  currentChannelId = null;
  hideMentionSuggestions();
  clearReactionCaches();
  await subscribeToCurrentChannel();
  renderChannelList();
  renderDmList();
  updateConversationHeaderAndInput();
  if (replyingTo) clearReply();

  const memberList = document.getElementById("memberList");
  if (memberList) memberList.classList.remove("open");

  messagesList.innerHTML = "";
  messagesMap.clear();
  messageDataMap.clear();

  if (!activeDm) {
    await loadDirectConversations();
  }

  await loadDirectMessages(conversationId);
  await subscribeToCurrentDmConversation(conversationId);
}

async function promptForDirectMessage() {
  const target = prompt("Start a DM with which username?");
  if (!target) return;

  const targetUsername = target.trim();
  if (!targetUsername) return;
  if (targetUsername.toLowerCase() === String(username || "").toLowerCase()) {
    alert("❌ You cannot DM yourself.");
    return;
  }

  const { data: userRow, error } = await supabaseClient
    .from("users")
    .select("username")
    .eq("username", targetUsername)
    .maybeSingle();

  if (error) {
    alert(`❌ Could not start DM: ${error.message}`);
    return;
  }
  if (!userRow?.username) {
    alert("❌ That user does not exist.");
    return;
  }

  try {
    const conversationId = await ensureDirectConversation(userRow.username);
    await loadDirectConversations();
    await openDirectConversation(conversationId);
  } catch (dmError) {
    console.error("❌ Failed to start DM:", dmError);
    alert(`❌ Could not start DM: ${dmError.message}`);
  }
}

async function loadDirectMessages(conversationId = currentDmConversationId) {
  if (!conversationId) return;

  messagesList.innerHTML = '<div class="loading-shimmer"></div>';
  messagesMap.clear();
  messageDataMap.clear();
  clearReactionCaches();

  const { data, error } = await supabaseClient
    .from("dm_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("inserted_at", { ascending: true });

  if (error) {
    messagesList.innerHTML = `<li class="error">Error: ${error.message}</li>`;
    return;
  }

  await loadAvatarMapForUsernames((data || []).map((msg) => msg.username));
  messagesList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  (data || []).forEach((msg) => {
    const li = createMessageElement(msg);
    messagesMap.set(msg.id, li);
    messageDataMap.set(msg.id, msg);
    fragment.appendChild(li);
  });
  messagesList.appendChild(fragment);
  applyMessageSearchFilter();
  await waitForImagesBeforeScroll();
}

async function subscribeToCurrentDmConversation(conversationId = currentDmConversationId) {
  if (!conversationId) {
    if (activeDmMessageChannel) {
      await activeDmMessageChannel.unsubscribe();
      activeDmMessageChannel = null;
    }
    return;
  }

  if (activeDmMessageChannel) {
    await activeDmMessageChannel.unsubscribe();
    activeDmMessageChannel = null;
  }

  activeDmMessageChannel = supabaseClient
    .channel(`dm-messages-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "dm_messages",
        filter: `conversation_id=eq.${conversationId}`
      },
      async (payload) => {
        const msg = payload.eventType === "DELETE" ? payload.old : (payload.new || payload.old);
        await handleRealtimeDmMessage(msg, payload.eventType);
      }
    )
    .subscribe();
}

function getPendingReactionKey(messageId, emoji, reactingUser = username) {
  return `${messageId}:${emoji}:${reactingUser}`;
}

function clearReactionCacheForMessage(messageId) {
  const normalizedMessageId = Number(messageId);
  const ids = reactionIdsByMessage.get(normalizedMessageId);
  if (ids) {
    ids.forEach((id) => {
      reactionDetailsMap.delete(id);
      reactionMessageMap.delete(id);
    });
  }
  reactionIdsByMessage.delete(normalizedMessageId);
  reactionSummaryByMessage.delete(normalizedMessageId);
}

function clearReactionCaches() {
  reactionIdsByMessage.clear();
  reactionDetailsMap.clear();
  reactionSummaryByMessage.clear();
  reactionMessageMap.clear();
  pendingReactionInsertMap.clear();
}

function upsertReactionRecord(record) {
  if (!record?.id || !record?.message_id || !record?.emoji) return;

  removeReactionRecordById(record.id);

  const normalizedMessageId = Number(record.message_id);
  const normalizedRecord = { ...record, message_id: normalizedMessageId };
  reactionDetailsMap.set(record.id, normalizedRecord);
  reactionMessageMap.set(record.id, normalizedMessageId);

  let ids = reactionIdsByMessage.get(normalizedMessageId);
  if (!ids) {
    ids = new Set();
    reactionIdsByMessage.set(normalizedMessageId, ids);
  }
  ids.add(record.id);

  let summary = reactionSummaryByMessage.get(normalizedMessageId);
  if (!summary) {
    summary = new Map();
    reactionSummaryByMessage.set(normalizedMessageId, summary);
  }

  let entry = summary.get(record.emoji);
  if (!entry) {
    entry = { count: 0, users: [] };
    summary.set(record.emoji, entry);
  }

  entry.count += 1;
  if (record.username && !entry.users.includes(record.username)) {
    entry.users.push(record.username);
  }
}

function removeReactionRecordById(reactionId) {
  const existing = reactionDetailsMap.get(reactionId);
  if (!existing) {
    reactionMessageMap.delete(reactionId);
    return null;
  }

  const normalizedMessageId = Number(existing.message_id);
  const ids = reactionIdsByMessage.get(normalizedMessageId);
  if (ids) {
    ids.delete(reactionId);
    if (ids.size === 0) reactionIdsByMessage.delete(normalizedMessageId);
  }

  const summary = reactionSummaryByMessage.get(normalizedMessageId);
  if (summary) {
    const entry = summary.get(existing.emoji);
    if (entry) {
      entry.count = Math.max(0, entry.count - 1);
      if (existing.username) {
        const stillPresent = Array.from(ids || []).some((id) => {
          const record = reactionDetailsMap.get(id);
          return record?.emoji === existing.emoji && record?.username === existing.username;
        });
        if (!stillPresent) {
          entry.users = entry.users.filter((name) => name !== existing.username);
        }
      }
      if (entry.count === 0) summary.delete(existing.emoji);
    }
    if (summary.size === 0) reactionSummaryByMessage.delete(normalizedMessageId);
  }

  reactionDetailsMap.delete(reactionId);
  reactionMessageMap.delete(reactionId);
  return existing;
}

function setReactionSnapshot(messageId, reactions = []) {
  const normalizedMessageId = Number(messageId);
  clearReactionCacheForMessage(normalizedMessageId);
  reactions.forEach((reaction) => upsertReactionRecord({ ...reaction, message_id: normalizedMessageId }));
  if (!reactionSummaryByMessage.has(normalizedMessageId)) {
    reactionSummaryByMessage.set(normalizedMessageId, new Map());
  }
}

function findMyReactionIds(messageId, emoji) {
  const ids = reactionIdsByMessage.get(Number(messageId));
  if (!ids) return [];
  return Array.from(ids).filter((id) => {
    const reaction = reactionDetailsMap.get(id);
    return reaction?.emoji === emoji && reaction?.username === username;
  });
}

function ensureReactionContainer(li) {
  const messageBody = li.querySelector(".message-body");
  if (!messageBody) return null;

  let reactionsContainer = messageBody.querySelector(":scope > .reactionBar");
  if (!reactionsContainer) {
    reactionsContainer = document.createElement("div");
    reactionsContainer.className = "reactionBar";
    messageBody.appendChild(reactionsContainer);
  }
  return reactionsContainer;
}

async function loadCategories() {
  let q = supabaseClient.from("categories").select("*").order("sort_order");
  if (currentServerId) q = q.eq("server_id", currentServerId);
  const { data, error } = await q;
  if (!error && data) {
    categories = data;
  }
}

async function loadChannels() {
  // If we're in DM "server" view or no server selected, don't load server channels
  if (!currentServerId) {
    channels = [];
    categories = [];
    renderChannelList();
    console.log("📋 Skipping channel load — in DM view or no server selected.");
    return;
  }

  let channelQuery = supabaseClient.from("channels").select("*").order("sort_order");
  if (currentServerId) channelQuery = channelQuery.eq("server_id", currentServerId);
  const [{ data: categoryData, error: categoriesError }, { data, error }] = await Promise.all([
    supabaseClient.from("categories").select("*").eq("server_id", currentServerId).order("sort_order"),
    channelQuery
  ]);

  if (!categoriesError && categoryData) {
    categories = categoryData;
  }

  if (error) {
    console.error("❌ loadChannels error:", error);
    return;
  }

  channels = data;
  await loadChannelPermissionsForServer();
  renderChannelList();
  console.log("📋 Channels loaded. Total:", channels.length);
}

let _sortableInstances = [];
let _serverSortableInstance = null;

function renderChannelList() {
  _sortableInstances.forEach(s => { try { s.destroy(); } catch {} });
  _sortableInstances = [];

  const fragment = document.createDocumentFragment();

  // Group channels by category
  const grouped = {};
  channels.forEach(ch => {
    const cat = categories.find(c => c.id === ch.category_id);
    const catName = cat ? cat.name : "General";
    if (!grouped[catName]) grouped[catName] = [];
    grouped[catName].push(ch);
  });

  const sortedCategories = [...categories].sort((a, b) => {
    const orderDiff = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  });
  const catNames = sortedCategories.map(cat => cat.name);
  const uncategorizedNames = Object.keys(grouped).filter(name => !categories.some(c => c.name === name));
  catNames.push(...uncategorizedNames);

  catNames.forEach(catName => {
    const catChannels = grouped[catName] || [];
    const isCollapsed = collapsedCategories.has(catName);

    const block = document.createElement("div");
    block.className = "category-block";
    block.dataset.categoryName = catName;

    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <span class="cat-arrow">${isCollapsed ? "▸" : "▾"}</span>
      <span class="cat-name">${catName.toUpperCase()}</span>
      <span style="flex:1"></span>
      <span class="cat-drag-handle">☰</span>
    `;

    header.querySelector(".cat-arrow").onclick = (e) => {
      e.stopPropagation();
      const nowCollapsed = !collapsedCategories.has(catName);
      if (nowCollapsed) collapsedCategories.add(catName);
      else collapsedCategories.delete(catName);
      localStorage.setItem("collapsedCategories", JSON.stringify([...collapsedCategories]));
      renderChannelList();
    };

    if (userPermissions.manage_roles) {
      header.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCategoryContextMenu(catName, e.clientX, e.clientY);
      };
    }

    block.appendChild(header);

    const itemsContainer = document.createElement("div");
    itemsContainer.className = "channel-items";
    itemsContainer.dataset.categoryName = catName;
    itemsContainer.style.display = isCollapsed ? "none" : "block";

    catChannels
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach(ch => {
        const div = document.createElement("div");
        // Add a class for voice channels to style differently if needed
        div.className = `channel ${ch.id === currentChannelId ? "active" : ""} ${ch.channel_type === 'voice' ? 'voice-channel' : ''}`;
        div.dataset.id = ch.id;

        const label = document.createElement("span");
        label.className = "channel-label";

        // --- VOICE CHANNEL ICON ---
        if (ch.channel_type === 'voice') {
          label.innerHTML = `🎤 ${ch.name}`; // Microphone icon
        } else {
          label.textContent = "# " + ch.name;
        }
        // --------------------------

        div.appendChild(label);

        // Drag handle for admins
        if (userPermissions.manage_roles) {
          const dragHandle = document.createElement("span");
          dragHandle.className = "cat-drag-handle";
          dragHandle.textContent = "⋮⋮";
          dragHandle.title = "Drag to reorder";
          dragHandle.setAttribute("aria-label", "Drag to reorder channel");
          div.appendChild(dragHandle);
        }

        // --- CLICK HANDLER ---
        div.onclick = () => {
          if (shouldSuppressClick(suppressChannelClickUntil)) return;

          if (ch.channel_type === 'voice') {
            joinVoiceChannel(ch.id); // Call new function
          } else {
            switchChannel(ch.id);
          }
          if (window.innerWidth <= 768) closeSidebar();
        };
        // ---------------------

        itemsContainer.appendChild(div);
      });

    block.appendChild(itemsContainer);
    fragment.appendChild(block);
  });

  channelList.innerHTML = "";
  channelList.appendChild(fragment);

  // Re-init Sortable if admin
  if (userPermissions.manage_roles && typeof Sortable !== "undefined") {
    initSortables();
  }
}

function initSortables() {
  const onTouchDevice = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  // Category Sortable — drag the whole category block by its ☰ handle.
  const outerSort = Sortable.create(channelList, {
    handle: ".category-header .cat-drag-handle",
    animation: 150,
    draggable: ".category-block",
    forceFallback: onTouchDevice,
    fallbackOnBody: true,
    fallbackTolerance: 6,
    onEnd: async () => {
      const categoryBlocks = Array.from(channelList.querySelectorAll(".category-block"));
      const updates = categoryBlocks.map((block, index) => {
        const catName = block.dataset.categoryName;
        const category = categories.find(c => c.name === catName);
        return category
          ? supabaseClient.from("categories").update({ sort_order: index }).eq("id", category.id)
          : null;
      }).filter(Boolean);

      await Promise.all(updates);
    }
  });
  _sortableInstances.push(outerSort);

  // Channels Sortable — drag a channel by its ☰ handle. Tapping the row
  // anywhere else still selects the channel (no long-press needed).
  document.querySelectorAll(".channel-items").forEach(container => {
    const innerSort = Sortable.create(container, {
      group: "channels",
      animation: 150,
      draggable: ".channel",
      handle: ".cat-drag-handle",
      // No long-press delay: the ☰ handle alone is what initiates the drag,
      // so tapping the channel still works for selection.
      delay: 0,
      touchStartThreshold: 4,
      fallbackTolerance: 6,
      forceFallback: onTouchDevice,
      fallbackOnBody: true,
      onEnd: async (evt) => {
        suppressChannelClickUntil = Date.now() + 500;
        const channelId = parseInt(evt.item.dataset.id, 10);
        const newCatName = evt.to.dataset.categoryName;
        const updates = [];

        const newCat = categories.find(c => c.name === newCatName);
        const newCatId = newCat ? newCat.id : null;

        updates.push(supabaseClient.from("channels").update({ category_id: newCatId }).eq("id", channelId));

        const items = channelList.querySelectorAll(".channel");
        items.forEach((el, i) => {
          updates.push(supabaseClient.from("channels").update({ sort_order: i }).eq("id", parseInt(el.dataset.id, 10)));
        });

        await Promise.all(updates);
      }
    });
    _sortableInstances.push(innerSort);
  });
}

function buildChannelItem(ch) {
  const div = document.createElement("div");
  div.textContent = "# " + ch.name;
  div.className = "channel";
  div.dataset.id = ch.id;
  if (ch.id === currentChannelId) div.classList.add("active");
  div.addEventListener("click", () => {
    if (shouldSuppressClick(suppressChannelClickUntil)) return;
    switchChannel(ch.id);
  });
  return div;
}

