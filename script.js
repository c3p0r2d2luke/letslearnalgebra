/* global Sortable, requestAnimationFrame, localStorage, console, alert, prompt, confirm, fetch, document, window, Date, Blob, URL, Notification, emailjs, TextEncoder, crypto */

const input = document.getElementById("messageInput");

input.addEventListener("input", () => {
  sendTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTyping(false);
  }, 2000);
});

document.getElementById("createChannelBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  tryCreateChannel();
});

const channelSidebar = document.querySelector(".channel-sidebar");
const categoryMenu = document.getElementById("categoryMenu");

// Close category menu on click-away (channelMenu is handled in the shared click handler below)
document.addEventListener("click", () => {
  if (categoryMenu) categoryMenu.style.display = "none";
});

document.addEventListener("contextmenu", (e) => {
  // 🔥 FIX: Look for the closest LI with data-id, even if clicked on a child
  const message = e.target.closest("li[data-id]"); 

  if (!message) return; // Only trigger on messages

  e.preventDefault();

  const menu = document.getElementById("adminMenu");
  if (!menu) {
    console.error("❌ #adminMenu not found in DOM!");
    return;
  }

  menu.innerHTML = "";

  const messageId = message.dataset.id;
  const author = message.dataset.user;

  let currentSection = menu;

  const addButton = (label, action) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.padding = "6px";
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.cursor = "pointer";
    btn.style.color = "white";
    btn.style.textAlign = "left";
    btn.style.fontSize = "13px";

    btn.onmouseenter = () => btn.style.background = "#40444b";
    btn.onmouseleave = () => btn.style.background = "transparent";

    btn.onclick = (event) => {
      event.stopPropagation();
      action();
      menu.style.display = "none";
    };

    currentSection.appendChild(btn);
  };

  const addSection = (title) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";

    const header = document.createElement("div");
    header.textContent = title + " ▶";
    header.style.fontSize = "12px";
    header.style.padding = "6px";
    header.style.cursor = "pointer";
    header.style.color = "white";

    header.onmouseenter = () => header.style.background = "#40444b";
    header.onmouseleave = () => header.style.background = "transparent";

    const sub = document.createElement("div");
    sub.style.position = "absolute";
    sub.style.left = "100%";
    sub.style.top = "0";
    sub.style.background = "#2f3136";
    sub.style.border = "1px solid #444";
    sub.style.display = "none";
    sub.style.minWidth = "180px";

    wrapper.onmouseenter = () => sub.style.display = "block";
    wrapper.onmouseleave = () => sub.style.display = "none";

    wrapper.appendChild(header);
    wrapper.appendChild(sub);
    menu.appendChild(wrapper);

    currentSection = sub;
  };

  // ================= BASE ACTIONS =================
  addButton("Reply", () => startReply(messageId));
//  addButton("Reply in Thread", () => startThread(messageId));

  addButton("React", () => {
    openEmojiPicker(messageId, e.clientX + 10, e.clientY + 10);
  });

  addButton("Report", () => reportMessage(messageId));

  // ================= ROLE-BASED =================
  if (currentRole === "Manager" && author === username) {
    addSection("Manager");
    addButton("Delete My Message", () => deleteMessage(messageId));
  }

  if (userPermissions.manage_roles) {
    addSection("Delete");
    addButton("Delete", () => deleteMessage(messageId));
    addButton("Delete By Keyword", () => deleteKeyword());
    addButton("Delete User + Messages", () => deleteUser(author));

    addSection("Info");
    addButton("User Info", () => userInfo(author));
    addButton("Export Chat", () => exportChat());

    addSection("Edit");
    addButton("Edit Message", () => editMessage(messageId));
    addButton("Pin / Unpin", () => pinMessage(messageId));
    addButton("Change Name", () => changeName(author));
    addButton("Promote / Demote", () => promote(author));
    addButton("Create Custom Role", createCustomRole);
    addButton("Give Custom Role", () => giveCustomRole(author));
    addButton("Mute User", () => muteUser(author));
    addButton("Block User", () => blockUser(author));
    addButton("Unblock User", () => unblockUser(author));
    addButton("Force Logout", () => forceLogout(author));
  }

  // ================= SCREEN BOUNDARY DETECTION =================
  const menuWidth = 200; 
  const menuHeight = 300; 

  let leftPos = e.clientX + 10;
  let topPos = e.clientY + 10;

  if (leftPos + menuWidth > window.innerWidth) leftPos = e.clientX - menuWidth - 10;
  if (topPos + menuHeight > window.innerHeight) topPos = e.clientY - menuHeight - 10;
  if (leftPos < 0) leftPos = 10;
  if (topPos < 0) topPos = 10;

  // ================= SHOW MENU =================
  menu.style.position = "fixed";
  menu.style.left = leftPos + "px";
  menu.style.top = topPos + "px";
  menu.style.background = "#2f3136";
  menu.style.border = "1px solid #444";
  menu.style.padding = "4px";
  menu.style.display = "block";

  // 🔥 DEBUG: Log if we got here
  console.log("✅ Context menu opened for message:", messageId);
});

// 🔐 SHA-256 hash function
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// 🔑 CHANGE THIS to your hashed password
const CORRECT_HASH = "22c932242295554614d1b3f90e13aee6efc317c3e044999664d8157d8ea53ca0";

// ✅ Check if already logged in (RUN ON PAGE LOAD)
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("isAuthenticated") === "true") {
    document.getElementById("passwordGate").style.display = "none";
    document.getElementById("appContent").style.display = "block";
    loadUser();
  }
});

// Handle login
document.getElementById("passwordBtn").addEventListener("click", async () => {
  const input = document.getElementById("passwordInput").value;
  const hashed = await hashPassword(input);

  if (hashed === CORRECT_HASH) {
    // ✅ Save login state
    localStorage.setItem("isAuthenticated", "true");

    document.getElementById("passwordGate").style.display = "none";
    document.getElementById("appContent").style.display = "block";
    loadUser();
  } else {
    alert("❌ Wrong password");
  }
});

let isTyping = false;
let channels = [];
let categories = [];
let collapsedCategories = new Set();
try { collapsedCategories = new Set(JSON.parse(localStorage.getItem("collapsedCategories") || "[]")); } catch {}
let currentChannelId = null;
let isBlocked = false;
let mutedUntil = null;
let muteInterval = null;
const messageDataMap = new Map(); // id → full message object
const NO_EMBED_PHRASE = "potatoheadman";
const button = document.getElementById("sendButton");
const messagesList = document.getElementById("messages");

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const namePrompt = document.getElementById("namePrompt");
const nameInput = document.getElementById("nameInput");
const saveNameBtn = document.getElementById("saveNameButton");

// ------------------------ Supabase Setup ------------------------
const supabaseUrl = "https://qjajtkdchvapthnidtwj.supabase.co";
const supabaseKey = "sb_publishable_1HWGEhoX-b4jj05hDKsGYw_H004LgVz"; 
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// ------------------------ User data ------------------------
let username = localStorage.getItem("chatUsername") || "";
let currentRole = "User";
let userPermissions = {};

async function loadUserPermissions(roleName) {

  const { data, error } = await supabaseClient
    .from("roles")
    .select("permissions")
    .eq("name", roleName)
    .maybeSingle();

  if (error) {
    console.error("❌ Failed to load role permissions:", error);
    userPermissions = {};
    return;
  }

  userPermissions = data.permissions || {};
  console.log("🔐 Permissions loaded:", userPermissions);
}const messagesMap = new Map();
const reactionMessageMap = new Map(); // reaction id → message id (for DELETE realtime lookup)
let typingTimeout = null;

// ------------------------ Name Lock ------------------------
function updateMessageLock() {
  const hasName = nameInput.value.trim().length > 0;
  input.disabled = !hasName;
  button.disabled = !hasName;
}
nameInput.addEventListener("input", updateMessageLock);
updateMessageLock();


// ------------------------ Realtime ------------------------
let channel = null;
// ======================== REALTIME MANAGER ========================
let activeMessageChannel = null; // Tracks the current realtime subscription

function initRealtime() {
  console.log("📡 Realtime manager initialized.");
  // We don't subscribe here anymore. We subscribe dynamically in switchChannel.
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
        handleRealtimeMessage(payload.new || payload.old, payload.eventType);
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
      // Keep the local map up-to-date for future DELETE lookups
      if (payload.new?.id && payload.new?.message_id) {
        reactionMessageMap.set(payload.new.id, payload.new.message_id);
      }

      // INSERT/UPDATE: payload.new has full row including message_id
      // DELETE: payload.old only has the primary key (id) by default —
      //         look up the message_id from our local map instead.
      let msgId = payload.new?.message_id ?? payload.old?.message_id;
      if (!msgId && payload.old?.id) {
        msgId = reactionMessageMap.get(payload.old.id);
        reactionMessageMap.delete(payload.old.id);
      }
      const li = messagesMap.get(Number(msgId));
      if (li) renderReactions(msgId, li);
    }
  )
  .subscribe();

const channelList = document.getElementById("channelList");

async function loadCategories() {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("*")
    .order("sort_order");
  if (!error && data) categories = data;
}

async function loadChannels() {
  await loadCategories();
  const { data, error } = await supabaseClient
    .from("channels")
    .select("*")
    .order("sort_order");

  if (error) {
    console.error("❌ loadChannels error:", error);
    return;
  }

  channels = data;
  renderChannelList();
  console.log("📋 Channels loaded. Total:", channels.length);
}

let _sortableInstances = [];

function renderChannelList() {
  // Destroy old SortableJS instances
  _sortableInstances.forEach(s => { try { s.destroy(); } catch {} });
  _sortableInstances = [];

  channelList.innerHTML = "";

  // Group channels by category text field
  const grouped = {};
  channels.forEach(ch => {
    const cat = ch.category || "General";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(ch);
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

  // Build ordered list of category names: DB-ordered categories first, then any orphan names
  const catNames = categories.map(c => c.name);
  Object.keys(grouped).forEach(cat => { if (!catNames.includes(cat)) catNames.push(cat); });
  // Always include "General" if no categories at all
  if (catNames.length === 0) catNames.push("General");

  catNames.forEach(catName => {
    const catChannels = grouped[catName] || [];
    const isCollapsed = collapsedCategories.has(catName);

    const block = document.createElement("div");
    block.className = "category-block";
    block.dataset.categoryName = catName;

    // Header
    const header = document.createElement("div");
    header.className = "category-header";

    const arrow = document.createElement("span");
    arrow.className = "cat-arrow";
    arrow.textContent = isCollapsed ? "▸" : "▾";

    const nameSpan = document.createElement("span");
    nameSpan.className = "cat-name";
    nameSpan.textContent = catName.toUpperCase();

    const spacer = document.createElement("span");
    spacer.style.flex = "1";

    const dragHandle = document.createElement("span");
    dragHandle.className = "cat-drag-handle";
    dragHandle.innerHTML = "&#8942;";
    dragHandle.title = "Drag to reorder";

    header.appendChild(arrow);
    header.appendChild(nameSpan);
    header.appendChild(spacer);
    if (userPermissions.manage_roles) header.appendChild(dragHandle);

    header.addEventListener("click", (e) => {
      if (e.target === dragHandle) return;
      const nowCollapsed = !collapsedCategories.has(catName);
      if (nowCollapsed) collapsedCategories.add(catName);
      else collapsedCategories.delete(catName);
      localStorage.setItem("collapsedCategories", JSON.stringify([...collapsedCategories]));
      arrow.textContent = nowCollapsed ? "▸" : "▾";
      itemsContainer.style.display = nowCollapsed ? "none" : "block";
    });

    if (userPermissions.manage_roles) {
      header.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCategoryContextMenu(catName, e.clientX, e.clientY);
      });
    }

    block.appendChild(header);

    // Channel items container
    const itemsContainer = document.createElement("div");
    itemsContainer.className = "channel-items";
    itemsContainer.dataset.categoryName = catName;
    itemsContainer.style.display = isCollapsed ? "none" : "block";

    catChannels.forEach(ch => {
      itemsContainer.appendChild(buildChannelItem(ch));
    });

    block.appendChild(itemsContainer);
    channelList.appendChild(block);
  });

  // Init SortableJS for admins
  if (userPermissions.manage_roles && typeof Sortable !== "undefined") {
    // Outer: reorder category blocks by dragging their drag handle
    const outerSort = Sortable.create(channelList, {
      handle: ".cat-drag-handle",
      animation: 150,
      draggable: ".category-block",
      onEnd: async () => {
        const blocks = channelList.querySelectorAll(".category-block");
        const updates = [];
        blocks.forEach((block, i) => {
          const cat = categories.find(c => c.name === block.dataset.categoryName);
          if (cat && cat.sort_order !== i) {
            cat.sort_order = i;
            updates.push(supabaseClient.from("categories").update({ sort_order: i }).eq("id", cat.id));
          }
        });
        await Promise.all(updates);
      }
    });
    _sortableInstances.push(outerSort);

    // Inner: reorder and move channels between categories
    document.querySelectorAll(".channel-items").forEach(container => {
      const innerSort = Sortable.create(container, {
        group: "channels",
        animation: 150,
        draggable: ".channel",
        onEnd: async (evt) => {
          const channelId = parseInt(evt.item.dataset.id, 10);
          const newCatName = evt.to.dataset.categoryName;
          const ch = channels.find(c => c.id === channelId);
          const updates = [];

          if (ch && ch.category !== newCatName) {
            ch.category = newCatName;
            updates.push(
              supabaseClient.from("channels").update({ category: newCatName }).eq("id", channelId)
            );
          }

          // Update sort_order for all channels in destination container
          const items = evt.to.querySelectorAll(".channel");
          items.forEach((el, i) => {
            const id = parseInt(el.dataset.id, 10);
            const c = channels.find(x => x.id === id);
            if (c) c.sort_order = i;
            updates.push(supabaseClient.from("channels").update({ sort_order: i }).eq("id", id));
          });

          // Also update source container if different
          if (evt.from !== evt.to) {
            const srcItems = evt.from.querySelectorAll(".channel");
            srcItems.forEach((el, i) => {
              const id = parseInt(el.dataset.id, 10);
              const c = channels.find(x => x.id === id);
              if (c) c.sort_order = i;
              updates.push(supabaseClient.from("channels").update({ sort_order: i }).eq("id", id));
            });
          }

          await Promise.all(updates);
        }
      });
      _sortableInstances.push(innerSort);
    });
  }
}

function buildChannelItem(ch) {
  const div = document.createElement("div");
  div.textContent = "# " + ch.name;
  div.className = "channel";
  div.dataset.id = ch.id;
  if (ch.id === currentChannelId) div.classList.add("active");
  div.addEventListener("click", () => switchChannel(ch.id));
  return div;
}

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
    { label: "Rename Channel", color: "white", action: () => openInlineRow("channel-rename", ch.name, channelId) },
    { label: "Delete Channel", color: "#ed4245", action: () => showInlineDelete("channel", channelId, ch.name) }
  ]);
});

// Close channel/category menus on any click
document.addEventListener("click", () => {
  document.getElementById("channelMenu").style.display = "none";
  const cm = document.getElementById("categoryMenu");
  if (cm) cm.style.display = "none";
});

function showContextMenu(menuEl, x, y, items) {
  menuEl.innerHTML = "";
  items.forEach(({ label, color, action }) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      display: "block", width: "100%", padding: "7px 10px",
      border: "none", background: "transparent", cursor: "pointer",
      color: color || "white", textAlign: "left", fontSize: "13px", borderRadius: "3px"
    });
    btn.onmouseenter = () => btn.style.background = "#40444b";
    btn.onmouseleave = () => btn.style.background = "transparent";
    btn.onclick = (ev) => { ev.stopPropagation(); menuEl.style.display = "none"; action(); };
    menuEl.appendChild(btn);
  });

  const mw = 160, mh = items.length * 34;
  let left = x + 4, top = y + 4;
  if (left + mw > window.innerWidth) left = x - mw;
  if (top + mh > window.innerHeight) top = y - mh;
  menuEl.style.left = left + "px";
  menuEl.style.top = top + "px";
  menuEl.style.display = "block";
}

function showCategoryContextMenu(catName, x, y) {
  const menu = document.getElementById("categoryMenu");
  showContextMenu(menu, x, y, [
    { label: "Rename Category", color: "white", action: () => openInlineRow("category-rename", catName, null) },
    { label: "Delete Category", color: "#ed4245", action: () => showInlineDeleteCategory(catName) }
  ]);
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
    "channel-create": "New channel:",
    "channel-rename": "Rename channel:",
    "category-create": "New category:",
    "category-rename": "Rename category:"
  };
  label.textContent = labels[mode] || "";
  inp.value = prefill || "";
  inp.placeholder = mode.includes("channel") ? "channel-name" : "category-name";

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
async function performCreateChannel(name) {
  const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!trimmed) return;

  const { data, error } = await supabaseClient
    .from("channels")
    .insert({ name: trimmed, created_by: username, category: "General", sort_order: channels.length })
    .select()
    .maybeSingle();

  if (error) { console.error("❌ Create channel:", error.message); return; }
  if (data) {
    channels.push(data);
    renderChannelList();
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
  await supabaseClient.from("messages").delete().eq("channel_id", channelId);
  const { error } = await supabaseClient.from("channels").delete().eq("id", channelId);
  if (error) { console.error("❌ Delete channel:", error.message); return; }

  channels = channels.filter(c => c.id !== channelId);
  renderChannelList();
  if (currentChannelId === channelId && channels.length > 0) switchChannel(channels[0].id);
}

// ---- Category CRUD ----
async function performCreateCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const sortOrder = categories.length;
  const { data, error } = await supabaseClient
    .from("categories")
    .insert({ name: trimmed, sort_order: sortOrder, created_by: username })
    .select()
    .maybeSingle();

  if (error) { console.error("❌ Create category:", error.message); return; }
  if (data) { categories.push(data); renderChannelList(); }
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

  // Update all channels in this category
  await supabaseClient.from("channels").update({ category: trimmed }).eq("category", oldName);
  channels.filter(c => c.category === oldName).forEach(c => c.category = trimmed);
  renderChannelList();
}

async function performDeleteCategory(catName) {
  const cat = categories.find(c => c.name === catName);
  if (cat) {
    await supabaseClient.from("categories").delete().eq("id", cat.id);
    categories = categories.filter(c => c.id !== cat.id);
  }
  // Move channels in deleted category to "General"
  await supabaseClient.from("channels").update({ category: "General" }).eq("category", catName);
  channels.filter(c => c.category === catName).forEach(c => c.category = "General");
  // Ensure "General" is in categories
  if (!categories.find(c => c.name === "General")) {
    const { data } = await supabaseClient
      .from("categories")
      .insert({ name: "General", sort_order: 0, created_by: username })
      .select()
      .maybeSingle();
    if (data) categories.push(data);
  }
  renderChannelList();
}

async function deleteChannel(channelId, channelName) {
  // Legacy compat — just call the inline delete show
  showInlineDelete("channel", channelId, channelName);
  return; // old code below kept as dead code just in case

}

async function tryCreateChannel() {
  console.log("🔥 create channel clicked");

  // ✅ Admin check
  if (!currentRole || currentRole.toLowerCase() !== "admin") {
    alert("❌ Only admins can create channels");
    return;
  }

  const btn = document.getElementById("addServerBtn");

  // ✅ 1. Get name
  const name = prompt("Enter new channel name:");
  if (!name || !name.trim()) return;

  // ✅ 2. DEFINE trimmedName (THIS is what you're missing)
  const trimmedName = name.trim();

  // ✅ 3. Get category
  const category = prompt("Enter category (e.g. Text, Voice, School):");

  if (btn) {
    btn.textContent = "⏳";
    btn.disabled = true;
  }

  try {
    // ✅ 4. USE trimmedName AFTER defining it
    const { data, error } = await supabaseClient
      .from("channels")
      .insert({
        name: trimmedName,
        created_by: username,
        category: category || "General"
      })
      .select()
      .maybeSingle();

    if (error) {
      alert("❌ Failed: " + error.message);
      console.error(error);
      return;
    }

    await loadChannels();
    switchChannel(data.id);

  } catch (err) {
    alert("❌ Unexpected: " + err.message);
  } finally {
    if (btn) {
      btn.textContent = "+";
      btn.disabled = false;
    }
  }
}

function switchChannel(channelId) {
  // 🔥 CRITICAL: Set this IMMEDIATELY
  currentChannelId = channelId;
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

  // 🔥 CLEAR AND LOAD MESSAGES
  messagesList.innerHTML = "";
  messagesMap.clear();

  // 🔥 Call loadMessages
  loadMessages();

  // 🔥 CRITICAL: Subscribe to realtime for THIS specific channel
  subscribeToCurrentChannel();

  // 🔥 Force scroll to bottom
  setTimeout(() => {
    messagesList.scrollTop = messagesList.scrollHeight;
  }, 100);
}
// ------------------------ Load Messages ------------------------
async function loadMessages() {
  // 🔥 CHECK AGAIN: If still null, something is very wrong
  if (!currentChannelId) {
    console.error("❌ CRITICAL ERROR: currentChannelId is still NULL in loadMessages!");
    messagesList.innerHTML = "<li style='color:red;'>⚠️ Critical Error: No channel selected. Check console.</li>";
    return;
  }

  // Show loading indicator
  messagesList.innerHTML = "<li style='color:#aaa;'>⏳ Loading messages...</li>";

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("channel_id", currentChannelId)
    .order("inserted_at", { ascending: true });

  if (error) {
    messagesList.innerHTML = "<li style='color:red;'>❌ Error loading messages: " + error.message + "</li>";
    console.error("Supabase Error:", error);
    return;
  }

  // Clear loading and show messages
  messagesList.innerHTML = "";
  data.forEach(msg => renderMessage(msg));

  // Force reflow
  void messagesList.offsetWidth;

  // Scroll to bottom
  setTimeout(() => {
    messagesList.scrollTop = messagesList.scrollHeight;
  }, 100);
}


// ======================== FULL FIXED loadUser FUNCTION ========================
async function loadUser() {
  console.log("🚀 loadUser() STARTED");

  const storedName = localStorage.getItem("chatUsername");
  console.log("📝 Stored name:", storedName);

  // 1. Handle Name Prompt if no name is saved
  if (!storedName) {
    console.log("⚠️ No stored name - showing name prompt");
    namePrompt.style.display = "block";
    input.disabled = true;
    button.disabled = true;

    // 🔥 CRITICAL FIX: Even if no name, we MUST load channels so the UI doesn't break
    // We do this asynchronously so it doesn't block the name prompt
    loadChannels().then(() => {
      console.log("✅ Channels loaded in background for name prompt.");
      // If we have channels, try to set a default so the header isn't empty
      if (channels.length > 0) {
        // We can't fully load messages without a user, but we can set the channel ID
        // to prevent the "No channel selected" error if the user clicks something
        currentChannelId = channels[0].id; 
        document.getElementById("currentChannelName").textContent = "# " + channels[0].name;
        // Highlight the first channel
        const firstChannelEl = document.querySelector(`[data-id="${channels[0].id}"]`);
        if(firstChannelEl) firstChannelEl.classList.add("active");
      }
    });

    return Promise.resolve(); // Return early, but channels are loading in background
  }

  // 2. Set up UI for logged-in user
  username = storedName; // 🔥 CRITICAL: Set username variable
  nameInput.value = storedName;
  namePrompt.style.display = "none";
  const controls = document.getElementById("controls");
  controls.classList.add("visible");
  input.disabled = false;
  button.disabled = false;

  // 3. Fetch User Role & Status
  try {
    console.log("🔍 Fetching user role...");
    const { data, error } = await supabaseClient
      .from("users")
      .select("role, blocked, muted_until")
      .eq("username", storedName)
      .maybeSingle();

    isBlocked = data?.blocked || false;
    mutedUntil = data?.muted_until || null;

    if (error) {
      console.error("Failed to fetch user role:", error);
      currentRole = "User";
      localStorage.setItem("chatRole", "User");
    } else {
      currentRole = data?.role || "User";
      localStorage.setItem("chatRole", currentRole);
      await loadUserPermissions(currentRole);
    }
    console.log("✅ User role:", currentRole);
  } catch (err) {
    console.error("Exception fetching user:", err);
    currentRole = "User";
    localStorage.setItem("chatRole", "User");
  }

  // Show create-channel and create-category buttons for admins only
  const createChannelBtn = document.getElementById("createChannelBtn");
  const createCategoryBtnEl = document.getElementById("createCategoryBtn");
  if (createChannelBtn) createChannelBtn.style.display = userPermissions.manage_roles ? "inline-block" : "none";
  if (createCategoryBtnEl) createCategoryBtnEl.style.display = userPermissions.manage_roles ? "inline-block" : "none";

  // 4. CRITICAL SEQUENCE: Load Channels FIRST
  console.log("📂 Loading channels...");
  await loadChannels(); // Wait for channels to populate
  console.log("✅ Channels loaded. Count:", channels.length);
  console.log("📋 Channels array:", channels);

  // 5. Initialize Realtime Manager (BEFORE loading default channel)
  console.log("📡 Initializing realtime manager...");
  initRealtime();
  subscribeToTyping();

  // 6. THEN Load Default Channel (which triggers switchChannel -> loadMessages -> subscribeToCurrentChannel)
  if (channels.length > 0) {
    console.log("📡 Loading default channel...");
    await loadDefaultChannel(); // This sets currentChannelId and loads messages
    console.log("✅ Default channel loaded.");
  } else {
    console.warn("⚠️ No channels found. Creating 'general'...");
    // Create 'general' if it doesn't exist
    const { error } = await supabaseClient.from("channels").insert([{ name: "general", created_by: username }]);
    if (!error) {
      await loadChannels(); // Reload to get the new channel
      await loadDefaultChannel();
    } else {
      console.error("Failed to create 'general' channel:", error);
      alert("❌ Failed to create default channel. Please contact admin.");
    }
  }

  // 7. Initialize Other Listeners (AFTER channels/messages/realtime are ready)
  watchForceLogout(storedName);
  subscribeToUserStatus();
  applyMuteBlockUI();
  loadCustomEmojis();

  console.log("🎉 loadUser() completed successfully.");
  return Promise.resolve();
}

// ------------------------ Save Name ------------------------
async function saveName() {
  const name = nameInput.value.trim();
  if (!name) return alert("❌ Enter a name first!");

  username = name;
  localStorage.setItem("chatUsername", name);

  try {
    const { data: existingUser, error: checkError } = await supabaseClient
      .from("users")
      .select("role")
      .eq("username", name)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("Check error:", checkError);
    }

    const { data, error } = await supabaseClient
      .from("users")
      .upsert({ 
        username: name,
        role: existingUser?.role || "User"
      }, { 
        onConflict: ["username"]
      })
      .select("role");

    if (error) {
      console.error("Failed to save user:", error);
      currentRole = "User";
    } else {
      currentRole = data?.[0]?.role || "User";
    }

    localStorage.setItem("chatRole", currentRole);

  } catch (err) {
    console.error("Exception saving user:", err);
    currentRole = "User";
    localStorage.setItem("chatRole", "User");
  }

  namePrompt.style.display = "none";
  const controls = document.getElementById("controls");
  controls.classList.add("visible");
  input.disabled = false;
  button.disabled = false;

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

function isUserBlockedOrMutedSync() {
  if (isBlocked) return true;

  if (mutedUntil) {
    return new Date(mutedUntil) > new Date();
  }

  return false;
}

// ------------------------ Send Message ------------------------
async function sendMessage() {

  if (!userPermissions.send_messages) {
  alert("❌ You don't have permission to send messages.");
  return;
}

  let content = input.value.trim();
  if (!content || !username) return;

if (isUserBlockedOrMutedSync()) {
  alert("❌ You cannot send messages.");
  return;
}

  if (!userPermissions.manage_roles && containsPlainTextUrl(content)) {
    alert("❌ Only admins are allowed to send links.");
    return;
  }

  let ip = "unknown";
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    ip = data.ip || "unknown";
  } catch {}

  try {
const messageData = {
  username,
  content,
  role: currentRole,
  is_pinned: false,
  ip,
  channel_id: currentChannelId // 🔥 IMPORTANT
};
    if (replyingTo) {
      messageData.reply_to = replyingTo;
    }

    const { error } = await supabaseClient.from("messages").insert([messageData]);
    if (!error) {
      input.value = "";
      console.log("✅ Message sent to Supabase");

    // 🔥 ADD THIS - Scroll to bottom after sending
    setTimeout(() => {
      messagesList.scrollTop = messagesList.scrollHeight;
    }, 100);

      if (replyingTo) {
  clearReply();
}

      // --- Push Notification Logic (Admin Broadcast) ---
      const isImportant = userPermissions.manage_roles && content.includes("!important!");
      fetch("https://qjajtkdchvapthnidtwj.supabase.co/functions/v1/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // FIXED TYPO HERE
        body: JSON.stringify({
          title: isImportant ? "🚨 IMPORTANT ANNOUNCEMENT" : "New message",
          body: `${username}: ${content.replace("!important!", "")}`,
          important: isImportant
        })
      });

      // --- Mention Processing (NEW) ---
      // Moved inside the success block so it only runs if message was sent
      await processMentions(content);

    }
  } catch (e) {
    console.error("❌ Failed to send message", e);
  }
}

// Add this near your sendMessage function
async function processMentions(content) {
  const mentionRegex = /@(\w+)/g;

  const mentionedUsers = [...content.matchAll(mentionRegex)]
    .map(m => m[1].toLowerCase())
    .filter((u, i, arr) => arr.indexOf(u) === i);

  if (mentionedUsers.length === 0) return;

  // Get valid users
  const { data: users } = await supabaseClient
    .from("users")
    .select("username")
    .in("username", mentionedUsers);

  if (!users) return;

  const validUsers = users.map(u => u.username);

  // Get subscriptions
  const { data: subs } = await supabaseClient
    .from("push_subscriptions")
    .select("*")
    .in("username", validUsers);

  if (!subs) return;

  // Send push
  for (const sub of subs) {
    try {
      await fetch("https://qjajtkdchvapthnidtwj.supabase.co/functions/v1/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `@${username} mentioned you`,
          body: content.substring(0, 100),
          subscription: sub.subscription,
          mention: true,
          important: true
        })
      });
    } catch (e) {
      console.error("Push failed:", e);
    }
  }
}

// ------------------------ Link Preview ------------------------
async function buildLinkPreview(url) {
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
    const { data } = await res.json();
    if (!data) return null;

    return `
      <div class="link-preview">
        ${data.image ? `<img src="${data.image.url}">` : ""}
        <div class="lp-text">
          <div class="lp-title">${data.title || url}</div>
          <div class="lp-desc">${data.description || ""}</div>
          <a href="${url}" target="_blank">${url}</a>
        </div>
      </div>
    `;
  } catch (e) {
    console.warn("Preview failed for", url, e);
    return null;
  }
}

// ------------------------ Render Message ------------------------
async function renderMessage(msg) {
  messageDataMap.set(msg.id, msg);

  let li = messagesMap.get(msg.id);
  if (!li) {
    li = document.createElement("li");
    messagesMap.set(msg.id, li);
    if (msg.reply_to) {
      const parentLi = messagesMap.get(msg.reply_to);
      if (parentLi && parentLi.parentNode === messagesList) {
        parentLi.insertAdjacentElement("afterend", li);
      } else {
        messagesList.appendChild(li);
      }
    } else {
      messagesList.appendChild(li);
    }
  }

  li.innerHTML = "";
  li.className = "";
  li.dataset.id = msg.id;
  li.dataset.user = msg.username;
  if (msg.role === "Admin") li.classList.add("admin");
  else if (msg.role === "Manager") li.classList.add("manager");
  li.dataset.pinned = msg.is_pinned ? "true" : "false";
  li.style.border = msg.is_pinned ? "2px solid red" : "";

   // --- Username + Timestamp Row ---
  const uname = document.createElement("div");
  uname.className = "username";
  uname.textContent = msg.username === "Frenchwizz" ? "Takeo" : msg.username;

  const ts = document.createElement("span");
  ts.className = "msg-timestamp";
  if (msg.inserted_at) {
    const d = new Date(msg.inserted_at);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    ts.textContent = isToday
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  uname.appendChild(ts);
  li.appendChild(uname);

  // --- Content ---
  const contentDiv = document.createElement("div");
  contentDiv.className = "content";

  const wrapper = document.createElement("div");
  const cleanContent = msg.content.replaceAll(NO_EMBED_PHRASE, "");

  // --- FILE / LINK PARSING ---
  const fileMatch = cleanContent.match(/\[📄 (.*?)\]\((.*?)\)/);
if (fileMatch) {
  const fileName = fileMatch[1];
  const url = fileMatch[2].trim();
  const type = getFileType(url);

  if (type === "image") {
    const imgEl = document.createElement("img");
    imgEl.src = url;
    imgEl.className = "msg-image";
    imgEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(url);
    });
    wrapper.appendChild(imgEl);
  } else if (type === "video") {
    wrapper.innerHTML = `
      <video controls style="max-width:300px;border-radius:8px;">
        <source src="${url}">
      </video>
    `;
  } else if (type === "audio") {
    wrapper.innerHTML = `
      <audio controls>
        <source src="${url}">
      </audio>
    `;
  } else {
    wrapper.innerHTML = `
      <a href="${url}" target="_blank">📄 ${fileName}</a>
    `;
  }
} else {
wrapper.innerHTML = formatMessageContent(cleanContent, msg.role);

const urlMatch = cleanContent.match(/https?:\/\/[^\s]+/);

if (urlMatch && !msg.content.includes(NO_EMBED_PHRASE)) {
  const preview = await buildLinkPreview(urlMatch[0]);
  if (preview) {
    const previewDiv = document.createElement("div");
    previewDiv.innerHTML = preview;
    wrapper.appendChild(previewDiv);
  }
}

// Admin-only script execution stays separate
if (msg.role === "Admin") {
  executeScripts(wrapper);
}
}


  contentDiv.appendChild(wrapper);

  // --- Mention Styling — convert @name to colored pill spans ---
  if (!fileMatch && msg.role !== "Admin") {
    wrapper.innerHTML = wrapper.innerHTML.replace(
      /@(\w+)/g,
      (match, name) => {
        const cls = name === username ? "mention mine" : "mention";
        return `<span class="${cls}">@${name}</span>`;
      }
    );
  }

  li.appendChild(contentDiv);

  // --- Reactions ---
  renderReactions(msg.id, li);

  // --- Hover Controls & Enhancements ---
  requestAnimationFrame(() => enhanceMessage(li, msg));

  // --- Admin / Manager Controls Containers ---
  const adminDiv = document.createElement("div");
  adminDiv.className = "adminControls";
  adminDiv.style.display = "none";

  const managerDiv = document.createElement("div");
  managerDiv.className = "managerControls";
  managerDiv.style.display = "none";

  if (userPermissions.manage_roles) li.appendChild(adminDiv);
  else if (currentRole === "Manager") li.appendChild(managerDiv);

  if (msg.reply_to) {
  li.classList.add("is-reply");
}
}

// ------------------------ Realtime Handler ------------------------
function handleRealtimeMessage(newMsg, eventType) {
  if (newMsg.channel_id !== currentChannelId) return;
  if (!newMsg) return;

  if (eventType === "INSERT") {
    messageDataMap.set(newMsg.id, newMsg);
    renderMessage(newMsg);
    // 🔥 ADD THIS - Scroll to bottom for new messages
    setTimeout(() => {
      messagesList.scrollTop = messagesList.scrollHeight;
    }, 100);

    if (newMsg.content.includes(`@${username}`)) {
  showMentionToast(newMsg);

  const el = messagesMap.get(newMsg.id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.background = "#3a3d44";
  }
}
  }

  else if (eventType === "UPDATE") {
    messageDataMap.set(newMsg.id, newMsg);
    renderMessage(newMsg);
    if (newMsg.content.includes(`@${username}`)) {
  showMentionToast(newMsg);

  const el = messagesMap.get(newMsg.id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.background = "#3a3d44";
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
  }
}

// ------------------------ Send / Name Handlers ------------------------
saveNameBtn.addEventListener("click", saveName);
button.addEventListener("click", sendMessage);
input.addEventListener("keydown", e => { if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});

// Secret sign-out shortcut
document.addEventListener("keydown", e => {
  if(e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase()==="t"){
    e.preventDefault();
    localStorage.removeItem("chatUsername");
    localStorage.removeItem("chatRole");
    alert("👋 You have been signed out!");
    namePrompt.style.display = "block";
    input.disabled = true;
    button.disabled = true;
    nameInput.value = "";
    currentRole = null;
    const cb = document.getElementById("createChannelBtn");
    if (cb) cb.style.display = "none";
    const catb = document.getElementById("createCategoryBtn");
    if (catb) catb.style.display = "none";
    updateMessageLock();
    saveNameBtn.onclick = saveName;
  }
});

// ------------------------ Push ------------------------
const VAPID_PUBLIC_KEY = "BASYo0tS0nRAG504ReCj95aY9QacgW9vPLQKkMJRU8LXPDMtYIg-oeA__TvgyDJlop9mQqeRC1j_7ydtlKCk0zA";
async function enablePush() {
  if(!("serviceWorker" in navigator)) return;
  const permission = await Notification.requestPermission();
  if(permission!=="granted") return;
  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: VAPID_PUBLIC_KEY });
  await supabaseClient.from("push_subscriptions").upsert({ username, subscription });
  console.log("🔔 Push enabled");
}
enablePush();

document.addEventListener("click", () => {
  const menu = document.getElementById("adminMenu");
  if (menu) menu.style.display = "none";
});

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

let customEmojis = []; // { id, name, url }
let pickerBuilt = false;
let currentPickerMessageId = null;

async function loadCustomEmojis() {
  const { data, error } = await supabaseClient
    .from("custom_emojis")
    .select("*")
    .order("name");
  if (!error && data) {
    customEmojis = data;
    const cat = EMOJI_CATEGORIES.find(c => c.name === "Custom");
    if (cat) cat.emojis = data.map(e => e.url);
    if (pickerBuilt) rebuildCustomGrid();
  }
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
    if (!url || !url.trim()) return;
    url = url.trim();
  } else {
    url = await uploadCustomEmojiFile();
    if (!url) return;
  }

  const { error } = await supabaseClient
    .from("custom_emojis")
    .insert({ name: name.trim().toLowerCase(), url, created_by: username });

  if (error) {
    alert("❌ Failed to add custom emoji: " + error.message);
  } else {
    await loadCustomEmojis();
  }
}

async function uploadCustomEmojiFile() {
  return new Promise((resolve) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) { resolve(null); return; }
      const fileName = `emoji_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const { error } = await supabaseClient.storage.from("emoji-files").upload(fileName, file);
      if (error) { alert("❌ Upload failed: " + error.message); resolve(null); return; }
      const { data } = supabaseClient.storage.from("emoji-files").getPublicUrl(fileName);
      resolve(data.publicUrl);
    };
    fileInput.click();
  });
}

async function deleteCustomEmoji(id) {
  const { error } = await supabaseClient.from("custom_emojis").delete().eq("id", id);
  if (error) { alert("❌ " + error.message); return; }
  await loadCustomEmojis();
}

// Subscribe to custom_emojis table for real-time updates
supabaseClient
  .channel("custom-emojis-channel")
  .on("postgres_changes", { event: "*", schema: "public", table: "custom_emojis" }, () => {
    loadCustomEmojis();
  })
  .subscribe();

// ------------------------ ADMIN MENU FUNCTIONS ------------------------

// Reply
// Report message (with EmailJS)
async function reportMessage(messageId) {
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

  if (!userPermissions.manage_roles && !(currentRole === "Manager" && author === username)) {
    alert("❌ Access Denied: You can only delete your own messages.");
    return;
  }

  try {
    // 🧠 1. Get message FIRST (so we know if it has a file)
    const { data: msg, error: fetchError } = await supabaseClient
      .from("messages")
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
      .from("messages")
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


// Mute user
async function muteUser(user) {
  const minutes = parseInt(prompt("Mute user for how many minutes?"));
  if (!minutes || minutes <= 0) return;

  const muteUntil = new Date(Date.now() + minutes * 60000).toISOString();

  const { error } = await supabaseClient
    .from("users")
    .update({ muted_until: muteUntil })
    .eq("username", user);

  if (error) {
    console.error("Mute failed:", error);
    alert("❌ Mute failed: " + error.message);
    return;
  }

  alert(`${user} muted for ${minutes} minutes.`);
}


// Block user
async function blockUser(user) {
  if (!confirm(`Block ${user}?`)) return;

  try {

    await supabaseClient
      .from("users")
      .update({ blocked: true })
      .eq("username", user);

    alert(`${user} blocked.`);

  } catch (err) {
    console.error("Block failed", err);
  }
}


// Optional unblock helper
async function unblockUser(user) {
  try {

    await supabaseClient
      .from("users")
      .update({ blocked: false })
      .eq("username", user);

    alert(`${user} unblocked.`);

  } catch (err) {
    console.error("Unblock failed", err);
  }
}

// Delete all messages containing a keyword
async function deleteKeyword() {
  const keyword = prompt("Delete all messages containing keyword:");
  if (!keyword) return;
  if (!confirm(`Delete ALL messages containing "${keyword}"?`)) return;

  try {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, content");

    if (error) throw error;

    const matches = data.filter(m => m.content.toLowerCase().includes(keyword.toLowerCase()));
    if (matches.length === 0) {
      alert("No messages found with that keyword.");
      return;
    }

    const ids = matches.map(m => m.id);
    const { error: delError } = await supabaseClient
      .from("messages")
      .delete()
      .in("id", ids);

    if (delError) throw delError;

    ids.forEach(id => {
      const li = messagesMap.get(Number(id));
      if (li) { li.remove(); messagesMap.delete(Number(id)); }
    });

    alert(`✅ Deleted ${ids.length} message(s) containing "${keyword}".`);
  } catch (err) {
    console.error("deleteKeyword failed", err);
    alert("❌ Failed: " + err.message);
  }
}

// Delete a user and all their messages
async function deleteUser(author) {
  if (!confirm(`Delete user "${author}" and ALL their messages? This cannot be undone.`)) return;

  try {
    const { error: msgError } = await supabaseClient
      .from("messages")
      .delete()
      .eq("username", author);

    if (msgError) throw msgError;

    const { error: userError } = await supabaseClient
      .from("users")
      .delete()
      .eq("username", author);

    if (userError) throw userError;

    messagesMap.forEach((li, id) => {
      if (li.dataset.user === author) { li.remove(); messagesMap.delete(id); }
    });

    alert(`✅ User "${author}" and their messages have been deleted.`);
  } catch (err) {
    console.error("deleteUser failed", err);
    alert("❌ Failed: " + err.message);
  }
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

    alert(
      `👤 User: ${author}\n` +
      `🎭 Role: ${data.role || "User"}\n` +
      `🚫 Blocked: ${data.blocked ? "Yes" : "No"}\n` +
      `🔇 Muted Until: ${data.muted_until || "Not muted"}\n` +
      `🌐 Last IP: ${data.ip || "Unknown"}\n` +
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

// Change a user's display name
async function changeName(author) {
  const newName = prompt(`Change name for "${author}" to:`);
  if (!newName || newName.trim() === author) return;
  const trimmed = newName.trim();

  if (!confirm(`Rename "${author}" to "${trimmed}"?`)) return;

  try {
    const { error: userError } = await supabaseClient
      .from("users")
      .update({ username: trimmed })
      .eq("username", author);

    if (userError) throw userError;

    const { error: msgError } = await supabaseClient
      .from("messages")
      .update({ username: trimmed })
      .eq("username", author);

    if (msgError) throw msgError;

    alert(`✅ Renamed "${author}" to "${trimmed}".`);
  } catch (err) {
    console.error("changeName failed", err);
    alert("❌ Failed: " + err.message);
  }
}

// Promote or demote a user
async function promote(author) {
  try {
    const { data, error } = await supabaseClient
      .from("users")
      .select("role")
      .eq("username", author)
      .maybeSingle();

    if (error) throw error;

    const currentUserRole = data?.role || "User";
    const newRole = prompt(`Current role for "${author}": ${currentUserRole}\n\nEnter new role (User / Manager / Admin):`);
    if (!newRole) return;

    const trimmedRole = newRole.trim();
    if (!["User", "Manager", "Admin"].includes(trimmedRole)) {
      alert('❌ Invalid role. Must be "User", "Manager", or "Admin".');
      return;
    }

    const { error: updateError } = await supabaseClient
      .from("users")
      .update({ role: trimmedRole })
      .eq("username", author);

    if (updateError) throw updateError;

    alert(`✅ "${author}" is now a ${trimmedRole}.`);
  } catch (err) {
    console.error("promote failed", err);
    alert("❌ Failed: " + err.message);
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
    // 1️⃣ Get ALL matching reactions (not maybeSingle)
    const { data: existing, error } = await supabaseClient
      .from("reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("username", username)
      .eq("emoji", emoji);

    if (error) throw error;

    if (existing && existing.length > 0) {
      // ❌ REMOVE ALL matching reactions (fixes duplicates too)
      const ids = existing.map(r => r.id);

      const { error: deleteError } = await supabaseClient
        .from("reactions")
        .delete()
        .in("id", ids);

      if (deleteError) {
        console.error("❌ Delete reaction failed:", deleteError);
        alert(`Could not remove reaction: ${deleteError.message}`);
        return;
      }

    } else {
      // ✅ ADD reaction
      await supabaseClient
        .from("reactions")
        .insert({
          message_id: messageId,
          username: username,
          emoji: emoji
        });
    }

  } catch (err) {
    console.error("Reaction error", err);
  }
}

// ------------------------ Reactions ------------------------
async function renderReactions(messageId, li) {
  let reactionsContainer = li.querySelector(".reactionBar");
  if (!reactionsContainer) {
    reactionsContainer = document.createElement("div");
    reactionsContainer.className = "reactionBar";
    li.appendChild(reactionsContainer);
  }

  reactionsContainer.innerHTML = "";

  try {
    const { data: reactions, error } = await supabaseClient
      .from("reactions")
      .select("*")
      .eq("message_id", messageId);

    if (error) {
      console.error("❌ Error fetching reactions:", error);
      return;
    }

    if (!reactions || reactions.length === 0) return;

    const grouped = {};
    reactions.forEach(r => {
      // Keep a local map so DELETE realtime events (which carry only the reaction id) can
      // still find the right message to re-render.
      reactionMessageMap.set(r.id, r.message_id);

      if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, myId: null, users: [] };
      grouped[r.emoji].count++;
      grouped[r.emoji].users.push(r.username);
      if (r.username === username) grouped[r.emoji].myId = r.id;
    });

    Object.entries(grouped).forEach(([emoji, info]) => {
      const iMine = info.myId !== null;
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

  const reactBtn = document.createElement("button");
  reactBtn.textContent = "😀";
  reactBtn.className = "emoji-trigger";
  reactBtn.title = "React";
  reactBtn.onclick = (e) => {
    e.stopPropagation();
    const rect = reactBtn.getBoundingClientRect();
    openEmojiPicker(msg.id, rect.left, rect.bottom + 4);
  };

  const replyBtn = document.createElement("button");
  replyBtn.textContent = "↩";
  replyBtn.title = "Reply";
  replyBtn.onclick = () => startReply(msg.id);

  controls.appendChild(reactBtn);
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
  return u === "Frenchwizz" ? "Takeo" : u;
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
uploadBtn.addEventListener("click", () => fileInput.click());

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
      ip: "unknown", // You could fetch IP here if needed
      channel_id: currentChannelId
    };

    if (replyingTo) {
      messageData.reply_to = replyingTo;
    }

    const { error: insertError } = await supabaseClient
      .from("messages")
      .insert([messageData]);

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
  // Detect triple backtick code block
  const codeBlockMatch = content.match(/```([\s\S]*?)```/);

  if (codeBlockMatch) {
    const code = codeBlockMatch[1];

    return `<pre class="code-block"><code>${
      escapeHTML(code)
    }</code></pre>`;
  }

  // If admin → allow raw HTML
  if (role === "Admin") {
    return content;
  }

  // If user → escape everything
  return escapeHTML(content);
}

function executeScripts(container) {
  const scripts = container.querySelectorAll("script");

  scripts.forEach(oldScript => {
    const newScript = document.createElement("script");

    // Copy attributes (like src)
    for (let attr of oldScript.attributes) {
      newScript.setAttribute(attr.name, attr.value);
    }

    // Copy inline script content
    newScript.textContent = oldScript.textContent;

    // Replace old script with new one (this executes it)
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}


function showMentionToast(msg) {
  const toast = document.createElement("div");
  toast.textContent = `📣 ${msg.username} mentioned you`;

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

  const { data } = await supabaseClient
    .from("users")
    .select("muted_until")
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

function subscribeToUserStatus() {
  supabaseClient
    .channel("user-status-" + username)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "users",
        filter: `username=eq.${username}`
      },
      (payload) => {
        const data = payload.new;

        isBlocked = data.blocked;
        mutedUntil = data.muted_until;

        applyMuteBlockUI();
      }
    )
    .subscribe();
}

function applyMuteBlockUI() {
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendButton");

  const muted = mutedUntil && new Date(mutedUntil) > new Date();

  if (isBlocked) {
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    input.placeholder = "🚫 You are blocked";
    return;
  }

  if (muted) {
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

// ======================== CHANNEL HEADER BUTTONS + INLINE ROW ========================
(function () {
  const createChannelBtn = document.getElementById("createChannelBtn");
  const createCategoryBtn = document.getElementById("createCategoryBtn");
  const row = document.getElementById("newChannelRow");
  const inp = document.getElementById("newChannelInput");
  const confirmBtn = document.getElementById("newChannelConfirm");
  const cancelBtn = document.getElementById("newChannelCancel");

  createChannelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInlineRow("channel-create", "", null);
  });

  createCategoryBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInlineRow("category-create", "", null);
  });

  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeInlineRow();
  });

  async function dispatch() {
    const mode = row.dataset.mode;
    const val = inp.value.trim();
    if (!val) { closeInlineRow(); return; }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "⏳";

    try {
      if (mode === "channel-create") {
        await performCreateChannel(val);
        closeInlineRow();
      } else if (mode === "channel-rename") {
        const id = parseInt(row.dataset.targetId, 10);
        await performRenameChannel(id, val);
        closeInlineRow();
      } else if (mode === "category-create") {
        await performCreateCategory(val);
        closeInlineRow();
      } else if (mode === "category-rename") {
        const oldName = row.dataset.targetName;
        await performRenameCategory(oldName, val);
        closeInlineRow();
      }
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "✓";
    }
  }

  confirmBtn.addEventListener("click", (e) => { e.stopPropagation(); dispatch(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); dispatch(); }
    else if (e.key === "Escape") { closeInlineRow(); }
  });
})();

async function loadDefaultChannel() {
  console.log("📡 loadDefaultChannel() called. Channels length:", channels.length);

  if (channels.length === 0) {
    console.error("❌ Channels array is empty! Cannot select default.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("channels")
    .select("*")
    .eq("name", "general")
    .maybeSingle();

  let targetChannelId;

  if (error) {
    console.warn("⚠️ 'general' not found. Using first channel.");
    targetChannelId = channels[0].id;
  } else {
    targetChannelId = data.id;
  }

  console.log("🎯 Target channel ID:", targetChannelId);

  // 🔥 Call switchChannel which handles everything
  switchChannel(targetChannelId);

  // 🔥 Force scroll to bottom after a slight delay
  setTimeout(() => {
    messagesList.scrollTop = messagesList.scrollHeight;
  }, 200);
}


// ======================== REALTIME FOR CHANNELS & CATEGORIES ========================

// Refetch both categories and channels from DB, then re-render.
// Called by both realtime handlers so every client always has the authoritative order.
async function reloadChannelsRealtime(deletedChannelId = null) {
  await loadCategories();
  const { data, error } = await supabaseClient
    .from("channels")
    .select("*")
    .order("sort_order");
  if (error) return;
  channels = data;
  renderChannelList();

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

supabaseClient
  .channel("channels-realtime")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "channels" },
    (payload) => {
      const deletedId = payload.eventType === "DELETE" ? payload.old?.id : null;
      reloadChannelsRealtime(deletedId);
    }
  )
  .subscribe();

supabaseClient
  .channel("categories-realtime")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "categories" },
    () => reloadChannelsRealtime()
  )
  .subscribe();

async function giveCustomRole(targetUser) {

  const roleName = prompt("Enter role name to give:");

  if (!roleName) return;

  const { error } = await supabaseClient
    .from("users")
    .update({ role: roleName })
    .eq("username", targetUser);

  if (error) {
    alert("❌ Failed to assign role");
    console.error(error);
    return;
  }

  alert("✅ Role assigned to " + targetUser);
}

async function createCustomRole() {

  const roleName = prompt("Role name?");
  if (!roleName) return;

  const permissions = {
    read_messages: confirm("Can read messages?"),
    send_messages: confirm("Can send messages?"),
    delete_messages: confirm("Can delete messages?"),
    rename_channels: confirm("Can rename channels?"),
    create_channels: confirm("Can create channels?"),
    manage_roles: confirm("Can manage roles?"),
    mute_users: confirm("Can mute users?")
  };

  const { error } = await supabaseClient
    .from("roles")
    .insert([{ name: roleName, permissions }]);

  if (error) {
    alert("❌ Failed to create role");
    console.error(error);
    return;
  }

  alert("✅ Role created!");
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
  supabaseClient
    .channel("typing-channel")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "typing" },
      () => {
        updateTypingUI();
      }
    )
    .subscribe();
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