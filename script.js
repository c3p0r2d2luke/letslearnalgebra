/* global AbortController, URLSearchParams, Sortable, requestAnimationFrame, localStorage, console, alert, prompt, confirm, fetch, document, window, Date, Blob, URL, Notification, emailjs */

document.addEventListener("DOMContentLoaded", () => {
  const confirmBtn = document.getElementById("newChannelConfirm");
  const cancelBtn = document.getElementById("newChannelCancel");
  const input = document.getElementById("newChannelInput");

  if (confirmBtn) {
    confirmBtn.addEventListener("click", handleInlineConfirm);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeInlineRow);
  }

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleInlineConfirm();
      if (e.key === "Escape") closeInlineRow();
    });
  }
});

// Add this near the top with your other constants
const PREVIEW_CACHE_KEY = "linkPreviewsCache_v2";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cache helpers
function getPreviewCache() {
  try {
    const cached = localStorage.getItem(PREVIEW_CACHE_KEY);
    if (!cached) return {};
    const parsed = JSON.parse(cached);
    // Prune expired entries
    const now = Date.now();
    const fresh = {};
    Object.entries(parsed).forEach(([url, data]) => {
      if (now - data.timestamp < CACHE_TTL) {
        fresh[url] = data;
      }
    });
    localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return {};
  }
}

function setPreviewCache(url, data) {
  const cache = getPreviewCache();
  cache[url] = { data, timestamp: Date.now() };
  localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(cache));
}

const input = document.getElementById("messageInput");

input.addEventListener("input", () => {
  sendTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTyping(false);
  }, 2000);
});

// Channel creation is handled by the IIFE below (openInlineRow)

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
    addButton("Give Custom Role", () => giveCustomRole(author));
    addButton("Mute User", () => muteUser(author));
    addButton("Block User", () => blockUser(author));
    addButton("Unblock User", () => unblockUser(author));
    addButton("Force Logout", () => forceLogout(author));

    addSection("Server");
    addButton("Generate Invite Link", () => generateInvite());
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

// ======================== SUPABASE AUTH ========================

function showAuthGate() {
  document.getElementById("authGate").style.display = "flex";
  document.getElementById("appContent").style.display = "none";
}

function hideAuthGate() {
  document.getElementById("authGate").style.display = "none";
  document.getElementById("appContent").style.display = "block";
}

// In your auth section

async function handleAuthSuccess(user) {
  const authId = user.id;
  console.log("🔑 Auth Success. Fetching profile for auth_id:", authId);

  // 1. Fetch the linked username from your 'users' table
  const { data: userData, error: fetchError } = await supabaseClient
    .from("users")
    .select("username, sys_admin, sys_manager, blocked, muted_until")
    .eq("auth_id", authId)
    .maybeSingle();

  if (fetchError) {
    console.error("❌ DB Error fetching profile:", fetchError);
    alert("Database error. Please try again.");
    return;
  }

  if (!userData) {
    console.error("❌ Profile not found for auth_id:", authId);
    alert("Profile not linked. Please try signing up again.");
    return;
  }

  // 2. CRITICAL: Set Global State & Save to LocalStorage IMMEDIATELY
  username = userData.username;
  localStorage.setItem("chatUsername", username); // <--- This is the key

  // Store flags
  localStorage.setItem("chatSysAdmin", userData.sys_admin ? "true" : "false");
  localStorage.setItem("chatSysManager", userData.sys_manager ? "true" : "false");

  // 3. Update Local Mute/Block State
  isBlocked = userData.blocked || false;
  mutedUntil = userData.muted_until || null;

  // 4. Hide Auth Gate
  hideAuthGate();

  console.log("✅ Logged in as:", username);

  // 5. Load the App (This will now see the username in localStorage)
  await loadUser(); 
}

async function doSignUp() {
  const usernameVal = document.getElementById("signUpUsername").value.trim();
  const email = document.getElementById("signUpEmail").value.trim();
  const password = document.getElementById("signUpPassword").value;
  const errorEl = document.getElementById("signUpError");
  errorEl.style.display = "none";

  if (!usernameVal || !email || !password) {
    errorEl.textContent = "❌ Please fill in all fields.";
    errorEl.style.display = "block";
    return;
  }

  // 1. Check if username exists
  const { data: existingUser } = await supabaseClient
    .from("users")
    .select("username")
    .eq("username", usernameVal)
    .maybeSingle();

  if (existingUser) {
    errorEl.textContent = "❌ Username already taken.";
    errorEl.style.display = "block";
    return;
  }

  // 2. Create Auth User
  const { data: authData, error: authError } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { username: usernameVal } }
  });

  if (authError) {
    errorEl.textContent = "❌ " + authError.message;
    errorEl.style.display = "block";
    return;
  }

  const userId = authData.user.id;

  // 3. CRITICAL: Create Public Profile with auth_id
  const { error: profileError } = await supabaseClient
    .from("users")
    .insert({
      username: usernameVal,
      auth_id: userId, 
      sys_admin: false,
      sys_manager: false,
      blocked: false,
      forceLogout: false
    });

  if (profileError) {
    console.error("Profile creation failed:", profileError);
    // Optional: Cleanup auth user if profile fails
    // await supabaseClient.auth.admin.deleteUser(userId); 
    errorEl.textContent = "❌ Failed to create profile. Check console.";
    errorEl.style.display = "block";
    return;
  }

  // 4. Auto Sign In
  const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (signInError) {
    console.error("Auto-signin failed:", signInError);
    errorEl.textContent = "❌ Account created, but login failed.";
    errorEl.style.display = "block";
    return;
  }

  // 5. Success
  await handleAuthSuccess(signInData.user);
}

// ✅ Check for existing session on page load
document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await handleAuthSuccess(session.user);
  } else {
    showAuthGate();
  }
});

// Toggle between sign in / sign up views
document.getElementById("toSignUp").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("signInView").style.display = "none";
  document.getElementById("signUpView").style.display = "block";
  document.getElementById("signInError").style.display = "none";
  document.getElementById("signUpError").style.display = "none";
});

document.getElementById("toSignIn").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("signUpView").style.display = "none";
  document.getElementById("signInView").style.display = "block";
  document.getElementById("signInError").style.display = "none";
  document.getElementById("signUpError").style.display = "none";
});

// Sign In
async function doSignIn() {
  const email = document.getElementById("signInEmail").value.trim();
  const password = document.getElementById("signInPassword").value;
  const errorEl = document.getElementById("signInError");
  errorEl.style.display = "none";

  if (!email || !password) {
    errorEl.textContent = "❌ Please fill in all fields.";
    errorEl.style.display = "block";
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = "❌ " + error.message;
    errorEl.style.display = "block";
    return;
  }
  await handleAuthSuccess(data.user);
}

document.getElementById("signInBtn").addEventListener("click", doSignIn);
document.getElementById("signInPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSignIn();
});

document.getElementById("signUpBtn").addEventListener("click", doSignUp);
document.getElementById("signUpPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSignUp();
});

let isTyping = false;
let channels = [];
let categories = [];
let collapsedCategories = new Set();
try { collapsedCategories = new Set(JSON.parse(localStorage.getItem("collapsedCategories") || "[]")); } catch {}
let categoryOrder = [];
try { categoryOrder = JSON.parse(localStorage.getItem("categoryOrder") || "[]"); } catch {}
let currentChannelId = null;
let currentServerId = null;
let servers = [];
let serverMembers = [];
let presenceSubscription = null;
let memberRefreshInterval = null;
let isBlocked = false;
let mutedUntil = null;
let muteInterval = null;
const messageDataMap = new Map(); // id → full message object
const NO_EMBED_PHRASE = "potatoheadman";
let unreadMentions = JSON.parse(localStorage.getItem('unreadMentions') || '{}');
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
let currentRole = localStorage.getItem("chatRole") || "User";
let currentSystemRole = localStorage.getItem("chatSysAdmin") === "true"
  ? "SysAdmin"
  : localStorage.getItem("chatSysManager") === "true"
    ? "SysManager"
    : "User";
let userPermissions = {};

function loadUserPermissions(roleName) {
  const name = (roleName || "user").toLowerCase();
  switch (name) {
    case "admin":
      userPermissions = {
        read_messages: true, send_messages: true, delete_messages: true,
        rename_channels: true, create_channels: true, manage_roles: true,
        mute_users: true, manage_messages: true, manage_reports: true
      };
      break;
    case "teacher":
    case "moderator":
    case "mod":
      userPermissions = {
        read_messages: true, send_messages: true, delete_messages: true,
        rename_channels: false, create_channels: false, manage_roles: false,
        mute_users: true, manage_messages: true, manage_reports: true
      };
      break;
    default:
      userPermissions = {
        read_messages: true, send_messages: true, delete_messages: false,
        rename_channels: false, create_channels: false, manage_roles: false,
        mute_users: false, manage_messages: false, manage_reports: false
      };
  }
}
const messagesMap = new Map();
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
  let q = supabaseClient.from("categories").select("*").order("sort_order");
  if (currentServerId) q = q.eq("server_id", currentServerId);
  const { data, error } = await q;
  if (!error && data) {
    categories = data;
    // Update categoryOrder based on database order
    categoryOrder = categories.map(c => c.name);
    localStorage.setItem("categoryOrder", JSON.stringify(categoryOrder));
  }
}

async function loadChannels() {
  await loadCategories();
  let q = supabaseClient.from("channels").select("*").order("sort_order");
  if (currentServerId) q = q.eq("server_id", currentServerId);
  const { data, error } = await q;

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

  // Group channels by category_id → resolved category name
  const grouped = {};
  channels.forEach(ch => {
    const cat = categories.find(c => c.id === ch.category_id);
    const catName = cat ? cat.name : "General";
    if (!grouped[catName]) grouped[catName] = [];
    grouped[catName].push(ch);
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

  // Build ordered list of category names by saved order, then any uncategorised orphans
  const catNames = categories.map(c => c.name);
  Object.keys(grouped).forEach(cat => { if (!catNames.includes(cat)) catNames.push(cat); });
  if (catNames.length === 0) catNames.push("General");

  // Sort categories based on saved order
  catNames.sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a);
    const bIndex = categoryOrder.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

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
    arrow.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "cat-name";
    nameSpan.textContent = catName.toUpperCase();

    const spacer = document.createElement("span");
    spacer.style.flex = "1";

    const dragHandle = document.createElement("span");
    dragHandle.className = "cat-drag-handle";
    dragHandle.innerHTML = "☰";
    dragHandle.title = "Drag to reorder category";
    dragHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    header.appendChild(arrow);
    header.appendChild(nameSpan);
    header.appendChild(spacer);
    header.appendChild(dragHandle);

    arrow.addEventListener("click", () => {
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
  console.log("Checking sortable init:", { currentSystemRole, currentRole, Sortable: typeof Sortable });
  if (typeof Sortable !== "undefined") {
    console.log("Creating category sortable");
    // Outer: reorder category blocks by dragging their drag handle
    const outerSort = Sortable.create(channelList, {
      handle: ".category-header",
      animation: 150,
      draggable: ".category-block",
      onEnd: async () => {
        console.log("Category drag end triggered");
        // Save category order to localStorage and database
        const categoryBlocks = Array.from(channelList.querySelectorAll('.category-block'));
        const newOrder = categoryBlocks.map(block => block.dataset.categoryName);
        
        // Update localStorage
        localStorage.setItem('categoryOrder', JSON.stringify(newOrder));
        
        // Update database sort_order for each category
        const updates = [];
        newOrder.forEach((catName, index) => {
          const category = categories.find(c => c.name === catName);
          if (category) {
            updates.push(
              supabaseClient.from('categories').update({ sort_order: index }).eq('id', category.id)
            );
          }
        });
        
        if (updates.length > 0) {
          try {
            await Promise.all(updates);
          } catch (error) {
            console.log("Failed to update category order in database:", error);
          }
        }
        
        // Trigger real-time update for other users
        console.log('Category order updated:', newOrder);
      }
    });
    console.log("Category sortable created:", outerSort);
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

          const newCat = categories.find(c => c.name === newCatName);
          const newCatId = newCat ? newCat.id : null;
          const oldCat = categories.find(c => c.id === ch?.category_id);
          if (ch && (oldCat?.name || "General") !== newCatName) {
            ch.category_id = newCatId;
            updates.push(
              supabaseClient.from("channels").update({ category_id: newCatId }).eq("id", channelId)
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
async function performCreateChannel(name, categoryName) {
  const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!trimmed) return;

  if (!currentServerId) {
    console.error("❌ No server selected");
    return;
  }

  // Find or create category
  let cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase() && c.server_id === currentServerId);
  if (!cat) {
    // Create new category
    const sortOrder = categories.filter(c => c.server_id === currentServerId).length;
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

  const sortOrder = channels.filter(
    c => c.server_id === currentServerId && c.category_id === cat.id
  ).length;

  const { data, error } = await supabaseClient
    .from("channels")
    .insert({
      name: trimmed,
      created_by: username,
      sort_order: sortOrder,
      server_id: currentServerId,
      category_id: cat.id
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Create channel:", error.message);
    return;
  }

  channels.push(data);
  renderChannelList();
  switchChannel(data.id);
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

  if (!currentServerId) {
    console.error("❌ No server selected");
    return;
  }

  const sortOrder = categories.filter(c => c.server_id === currentServerId).length;

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
    const { data: genData } = await supabaseClient
      .from("categories")
      .insert({ name: "General", sort_order: 0, created_by: username, server_id: currentServerId })
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

  // Update channel presence for member list
  updateChannelPresence(channelId);

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

  // 1. Get username from LocalStorage (Set by handleAuthSuccess or Session Restore)
  const storedName = localStorage.getItem("chatUsername");

  if (!storedName) {
    // This should ONLY happen if the user is NOT logged in (no session)
    // But if we are here, it means the session check passed but localStorage is missing.
    // This implies a bug in handleAuthSuccess or the session restore.
    console.error("⚠️ No username found in localStorage despite being authenticated.");
    // Force logout to be safe
    await supabaseClient.auth.signOut();
    location.reload();
    return;
  }

  username = storedName;
  console.log("📝 Loaded username:", username);

  // 2. Set up UI for logged-in user
  nameInput.value = username;
  // HIDE the name prompt if it exists (it shouldn't be visible anyway)
  if (namePrompt) namePrompt.style.display = "none";

  const controls = document.getElementById("controls");
  if (controls) controls.classList.add("visible");

  input.disabled = false;
  button.disabled = false;

  // 3. Fetch sys role, blocked, and muted status from DB (new schema uses boolean flags)
  try {
    console.log("📡 Fetching user data from users table for:", username);
    const { data, error } = await supabaseClient
      .from("users")
      .select("sys_admin, sys_manager, blocked, muted_until, auth_id")
      .eq("username", username)
      .maybeSingle();
    
    console.log("   User data:", data);
    console.log("   Error:", error);
    
    if (!data) {
      console.warn("⚠️ User record not found in database! Creating one...");
      // Create user record if it doesn't exist
      const authId = (await supabaseClient.auth.getUser())?.data?.user?.id;
      if (authId) {
        await supabaseClient.from("users").insert({
          username,
          auth_id: authId,
          sys_admin: false,
          sys_manager: false
        });
        console.log("✅ Created user record");
      }
    }
    
    isBlocked = data?.blocked || false;
    mutedUntil = data?.muted_until || null;
    
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
    
    localStorage.setItem("chatSysAdmin", currentSystemRole === "SysAdmin" ? "true" : "false");
    localStorage.setItem("chatSysManager", currentSystemRole === "SysManager" ? "true" : "false");
    console.log("🔐 System role set to:", currentSystemRole);
  } catch (err) {
    console.error("❌ Error fetching user data:", err);
  }

  // 4. Default per-server permissions until refreshServerRole() runs after switchServer
  currentRole = "User";
  loadUserPermissions("user");

  // 6. Initialize Realtime & Typing
  initRealtime();
  subscribeToTyping();

  // 7. Load Servers (This triggers switchServer -> refreshServerRole -> loadChannels)
  initServerModals();
  await loadServers();
  updateServerBadges();
  await checkInviteOnLoad();

  // 8. Initialize Other Listeners
  subscribeToUserStatus();
  applyMuteBlockUI();

  // Handle URL params for jumping to server/channel
  const urlParams = new URLSearchParams(window.location.search);
  const serverSlug = urlParams.get('server');
  const channelParam = urlParams.get('channel');
  if (serverSlug && channelParam) {
    const server = servers.find(s => s.slug === serverSlug);
    if (server) {
      await switchServer(server.id, false);
      if (channels.find(c => c.id === channelParam)) {
        switchChannel(channelParam);
      }
    }
  }

  console.log("🎉 loadUser() completed successfully.");
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
        username: name
      }, {
        onConflict: ["username"]
      })
      .select("system_role");

    if (error) {
      console.error("Failed to save user:", error);
      currentRole = "User";
    } else {
      currentRole = data?.[0]?.system_role || "User";
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

  let serverName = "Unknown";
  let channelName = "general";
  if (currentServerId) {
    const srv = servers.find(s => s.id === currentServerId);
    if (srv) serverName = srv.name;
  }
  if (currentChannelId) {
    const ch = channels.find(c => c.id === currentChannelId);
    if (ch) channelName = ch.name;
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
          body: `${serverName} #${channelName}: ${content.replace("!important!", "")}`,
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

  const mentionSet = new Set(mentionedUsers);
  const everyoneMentioned = mentionSet.has("everyone");

  const canUseEveryone = currentSystemRole === "SysAdmin" || currentRole === "Admin";
  if (everyoneMentioned && !canUseEveryone) {
    alert("Only server Admins / SysAdmins can use @everyone.");
    mentionSet.delete("everyone");
  }

  const notifyUsernames = new Set();

  // If @everyone is allowed, notify all members of the current server (except sender)
  if (everyoneMentioned && canUseEveryone && currentServerId) {
    const { data: allMembers, error: allError } = await supabaseClient
      .from("server_members")
      .select("username")
      .eq("server_id", currentServerId);

    if (!allError && Array.isArray(allMembers)) {
      allMembers.forEach(m => {
        if (m.username && m.username !== username) {
          notifyUsernames.add(m.username);
        }
      });
    }
  }

  // Add explicit user mentions (never includes @everyone here)
  mentionSet.forEach(name => {
    if (name === "everyone") return;
    notifyUsernames.add(name);
  });

  if (notifyUsernames.size === 0) return;

  // Get server and channel names
  let serverName = "Unknown Server";
  let serverSlug = "";
  let channelName = "general";
  if (currentServerId) {
    const { data: srv } = await supabaseClient.from("servers").select("name, slug").eq("id", currentServerId).single();
    if (srv) {
      serverName = srv.name;
      serverSlug = srv.slug;
    }
  }
  if (currentChannelId) {
    const ch = channels.find(c => c.id === currentChannelId);
    if (ch) channelName = ch.name;
  }

  // Validate users and fetch subscriptions for everyone in notifyUsernames
  const targetUsers = Array.from(notifyUsernames);
  const { data: users } = await supabaseClient
    .from("users")
    .select("username")
    .in("username", targetUsers);

  if (!users) return;

  const validUsers = users.map(u => u.username);

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
          important: true,
          serverId: currentServerId,
          channelId: currentChannelId,
          serverName,
          channelName,
          serverSlug
        })
      });
    } catch (e) {
      console.error("Push failed:", e);
    }
  }
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn("⚠️ Link preview fetch failed with HTTP status", res.status);
      return null;
    }

    const json = await res.json();

    if (!json || !json.data) {
      console.warn("⚠️ Link preview response missing data for", url);
      return null;
    }

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
    alert(`Link preview failed for ${url}: ${e.message || e}`);
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
  // Normalize role to lowercase to prevent case mismatches
  const roleLower = (msg.role || "").toLowerCase();

  if (roleLower === "admin") li.classList.add("admin");
  else if (roleLower === "manager") li.classList.add("manager");
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

  // ROLEFORM messages are no longer supported — skip rendering
  if (cleanContent.startsWith("ROLEFORM::")) return;

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

// --- GIF / IMAGE URL inline rendering (admin-posted) ---
if (urlMatch && msg.role === "Admin") {
  const gifUrl = resolveGifUrl(urlMatch[0]);
  if (gifUrl) {
    const gifImg = document.createElement("img");
    gifImg.src = gifUrl;
    gifImg.className = "msg-image gif-embed";
    gifImg.style.maxWidth = "400px";
    gifImg.style.borderRadius = "8px";
    gifImg.style.marginTop = "6px";
    gifImg.style.display = "block";
    gifImg.addEventListener("click", (ev) => { ev.stopPropagation(); openLightbox(gifUrl); });
    wrapper.appendChild(gifImg);
  }
}

if (urlMatch && !msg.content.includes(NO_EMBED_PHRASE)) {
  const previewContainer = document.createElement("div");
  previewContainer.className = "link-preview-container";
  previewContainer.innerHTML = `<div class="link-preview-loading"><span class="loader"></span> Loading preview...</div>`;
  wrapper.appendChild(previewContainer);

  let resolved = false;
  const finalizePreview = (html) => {
    if (resolved) return;
    resolved = true;
    previewContainer.innerHTML = html;
    previewContainer.classList.add("loaded");
  };

  const fallbackRender = () => {
    if (resolved) return;
    resolved = true;
    previewContainer.innerHTML = `<div class="link-preview"><a href="${urlMatch[0]}" target="_blank" style="color: #00b0f4;">${urlMatch[0]}</a></div>`;
    previewContainer.classList.add("loaded");
    alert(`Link preview could not load for ${urlMatch[0]}. Showing plain link instead.`);
  };

  const previewTimeout = setTimeout(() => {
    fallbackRender();
  }, 5000);

  (async () => {
    try {
      const preview = await buildLinkPreview(urlMatch[0]);
      clearTimeout(previewTimeout);
      if (preview) {
        finalizePreview(preview);
      } else {
        fallbackRender();
      }
    } catch {} {
      clearTimeout(previewTimeout);
      fallbackRender();
    }
  })();
}
}


  contentDiv.appendChild(wrapper);

  // --- Mention Styling — convert @name to colored pill spans ---
  if (!fileMatch) {
    wrapper.innerHTML = wrapper.innerHTML.replace(
      /@(\w+)/g,
      (match, name) => {
        const lowerName = name.toLowerCase();
        let cls = "mention";
        if (lowerName === username.toLowerCase()) cls += " mine";
        if (lowerName === "everyone") cls += " everyone";
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

    if (newMsg.username !== username && newMsg.content.toLowerCase().includes(`@${username.toLowerCase()}`)) {
      unreadMentions[currentServerId] = (unreadMentions[currentServerId] || 0) + 1;
      localStorage.setItem('unreadMentions', JSON.stringify(unreadMentions));
      updateServerBadges();
    }

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

function updateServerBadges() {
  document.querySelectorAll('.server-icon').forEach(icon => {
    const serverId = icon.dataset.serverId;
    const count = unreadMentions[serverId] || 0;
    let badge = icon.querySelector('.unread-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'unread-badge';
        badge.style.position = 'absolute';
        badge.style.top = '-5px';
        badge.style.right = '-5px';
        badge.style.background = '#f04747';
        badge.style.color = 'white';
        badge.style.borderRadius = '50%';
        badge.style.width = '18px';
        badge.style.height = '18px';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
        badge.style.fontSize = '10px';
        badge.style.fontWeight = 'bold';
        icon.style.position = 'relative';
        icon.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : count;
    } else if (badge) {
      badge.remove();
    }
  });
}

// ------------------------ Send / Name Handlers ------------------------
saveNameBtn.addEventListener("click", saveName);
button.addEventListener("click", sendMessage);
input.addEventListener("keydown", e => { if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});

// Secret sign-out shortcut
document.addEventListener("keydown", async e => {
  if(e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase()==="t"){
    e.preventDefault();
    localStorage.removeItem("chatUsername");
    localStorage.removeItem("chatRole");
    await supabaseClient.auth.signOut();
    location.reload();
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

// ======================== MOBILE SIDEBAR TOGGLE ========================
const menuToggleBtn = document.getElementById("menuToggle");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function openSidebar() {
  document.body.classList.add("sidebar-open");
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

if (menuToggleBtn) {
  menuToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.body.classList.toggle("sidebar-open");
  });
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeSidebar);
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

let customEmojis = []; // { id, name, url }
let pickerBuilt = false;
let currentPickerMessageId = null;


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
    .insert({ name: name.trim().toLowerCase(), url, created_by: username });

  if (error) {
    alert("❌ Failed to add custom emoji: " + error.message);
  } else {
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
      `🎭 System Role: ${data.system_role || "User"}\n` +
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
    if (currentSystemRole !== "SysAdmin" && currentRole !== "Admin") {
      alert("❌ Only server Admin or SysAdmin can promote/demote users.");
      return;
    }

    const { data, error } = await supabaseClient
      .from("server_members")
      .select("role")
      .eq("server_id", currentServerId)
      .eq("username", author)
      .maybeSingle();

    if (error) throw error;

    const currentUserRole = data?.role || "User";
    const newRole = prompt(`Current role for "${author}" in this server: ${currentUserRole}\n\nEnter new role (User / Manager / Admin):`);
    if (!newRole) return;

    const trimmedRole = newRole.trim();
    if (!["User", "Manager", "Admin"].includes(trimmedRole)) {
      alert('❌ Invalid role. Must be "User", "Manager", or "Admin".');
      return;
    }

    const { error: updateError } = await supabaseClient
      .from("server_members")
      .update({ role: trimmedRole })
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
  input.value = `@${author} ` + input.value;
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
// ======================== FILE UPLOAD ========================
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");

// Open file picker when upload button is clicked
uploadBtn.addEventListener("click", () => {
  const role = (currentRole || "").toLowerCase();
  if (role !== "admin" && role !== "manager") {
    alert("❌ Only Managers and Admins can post images.");
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

  let q2 = supabaseClient.from("channels").select("*").eq("name", "general");
  if (currentServerId) q2 = q2.eq("server_id", currentServerId);
  const { data, error } = await q2.maybeSingle();

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
  let q = supabaseClient.from("channels").select("*").order("sort_order");
  if (currentServerId) q = q.eq("server_id", currentServerId);
  const { data, error } = await q;
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

// Server-scoped realtime for channels & categories — set up per switchServer()
let _channelRealtimeSub = null;
let _categoryRealtimeSub = null;

function subscribeToServerRealtime(serverId) {
  // Clean up previous server's subscriptions
  if (_channelRealtimeSub) { try { _channelRealtimeSub.unsubscribe(); } catch {} _channelRealtimeSub = null; }
  if (_categoryRealtimeSub) { try { _categoryRealtimeSub.unsubscribe(); } catch {} _categoryRealtimeSub = null; }

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
}

async function giveCustomRole(targetUser) {
  const roleName = prompt("Enter role name to give:");
  if (!roleName) return;

  const { error } = await supabaseClient
    .from("server_members")
    .update({ role: roleName })
    .eq("server_id", currentServerId)
    .eq("username", targetUser);

  if (error) {
    alert("❌ Failed to assign role");
    console.error(error);
    return;
  }

  alert(`✅ Role "${roleName}" assigned to ${targetUser} in this server.`);
  loadServerMembers();
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

// ======================== SERVER SYSTEM ========================

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

async function loadServers() {
  if (!username) return;

  // First, ensure user is added to the "main" server
  try {
    // Find or create "main" server
    const { data: mainServer, error: findError } = await supabaseClient
      .from("servers")
      .select("*")
      .eq("slug", "main")
      .maybeSingle();

    if (!findError && mainServer) {
      // Check if user is already a member
      const { data: isMember } = await supabaseClient
        .from("server_members")
        .select("id")
        .eq("server_id", mainServer.id)
        .eq("username", username)
        .maybeSingle();

      if (!isMember) {
        // Add user to main server
        await supabaseClient.from("server_members").insert({
          server_id: mainServer.id,
          username,
          role: "User"
        });
        console.log("✅ Added user to main server");
      }
    }
  } catch (err) {
    console.error("❌ Error adding to main server:", err);
  }

  try {
    if (currentSystemRole === "SysAdmin" || currentSystemRole === "SysManager") {
      console.log("📡 Loading ALL servers (SysAdmin/SysManager)");
      const { data, error } = await supabaseClient
        .from("servers").select("*").order("created_at", { ascending: true });
      if (error) {
        console.error("❌ loadServers error:", error);
        servers = [];
      } else {
        servers = data || [];
        console.log(`✅ Loaded ${servers.length} servers`);
      }
    } else {
      console.log("📡 Loading user servers");
      const { data, error } = await supabaseClient
        .from("server_members")
        .select("server_id, servers(*)")
        .eq("username", username);
      if (error) {
        console.error("❌ loadServers error:", error);
        servers = [];
      } else {
        servers = (data || []).map(d => d.servers).filter(Boolean);
        console.log(`✅ Loaded ${servers.length} servers`);
      }
    }
  } catch (err) {
    console.error("❌ Unexpected error in loadServers:", err);
    servers = [];
  }

  renderServerList();

  const urlParams = new URLSearchParams(window.location.search);
  const serverSlug = urlParams.get("server");
  let target = serverSlug ? servers.find(s => s.slug === serverSlug) : null;
  if (!target && servers.length > 0) target = servers[0];

  if (target) {
    console.log("🎯 Switching to server:", target.id, target.name);
    await switchServer(target.id, false);
  } else {
    console.warn("⚠️ No servers found");
    showNoServerScreen();
  }
}

async function switchServer(serverId, updateUrl = true) {
  console.log("🔀 switchServer called with:", serverId);
  currentServerId = serverId;
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

  // Ensure member panel is visible when server is selected
  const memberPanel = document.getElementById('memberList');
  if (memberPanel) {
    memberPanel.style.display = 'flex';
    memberPanel.classList.remove('open');
  }

  document.querySelectorAll(".server-icon[data-server-id]").forEach(el => {
    el.classList.toggle("active", el.dataset.serverId === serverId);
  });

  const noServerScreen = document.getElementById("noServerScreen");
  if (noServerScreen) noServerScreen.remove();
  const controlsEl = document.getElementById("controls");
  if (controlsEl) controlsEl.classList.add("visible");

  const msgInput = document.getElementById("messageInput");
  if (msgInput) msgInput.disabled = false;

  console.log("📂 Loading channels...");
  await loadChannels();

  if (channels.length > 0) {
    console.log("📝 Loading default channel...");
    await loadDefaultChannel();
  } else {
    console.log("🆕 No channels, creating 'general'...");
    await supabaseClient.from("channels").insert({
      name: "general",
      created_by: username,
      category: "General",
      server_id: currentServerId
    });
    await loadChannels();
    await loadDefaultChannel();
  }

  console.log("🔐 Refreshing server role...");
  await refreshServerRole();
  
  console.log("🌐 Subscribing to server realtime...");
  subscribeToServerRealtime(serverId);
  
  console.log("👥 Loading server members...");
  await loadServerMembers();
  
  console.log("🔔 Subscribing to presence...");
  subscribeToPresence();
  
  unreadMentions[serverId] = 0;
  localStorage.setItem('unreadMentions', JSON.stringify(unreadMentions));
  updateServerBadges();
  
  console.log("✅ switchServer complete!");
}

function renderServerList() {
  const serverList = document.getElementById("serverList");
  if (!serverList) return;
  serverList.innerHTML = "";

  // Get server order from localStorage
  let serverOrder = [];
  try {
    serverOrder = JSON.parse(localStorage.getItem("serverOrder") || "[]");
  } catch {}

  // Sort servers based on order
  const sortedServers = servers.slice().sort((a, b) => {
    const aIndex = serverOrder.indexOf(a.id);
    const bIndex = serverOrder.indexOf(b.id);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  sortedServers.forEach(server => {
    const icon = document.createElement("div");
    icon.className = "server-icon";
    icon.dataset.serverId = server.id;
    icon.title = server.name;
    if (server.id === currentServerId) icon.classList.add("active");
    if (server.icon_url) {
      const img = document.createElement("img");
      img.src = server.icon_url;
      img.alt = server.name;
      icon.appendChild(img);
    } else {
      icon.textContent = server.name.charAt(0).toUpperCase();
    }
    icon.addEventListener("click", () => switchServer(server.id));
    serverList.appendChild(icon);
  });

  // Make servers draggable
  if (typeof Sortable !== "undefined") {
    Sortable.create(serverList, {
      animation: 150,
      draggable: ".server-icon",
      onEnd: () => {
        const icons = serverList.querySelectorAll(".server-icon");
        const newOrder = Array.from(icons).map(icon => icon.dataset.serverId);
        localStorage.setItem("serverOrder", JSON.stringify(newOrder));
      }
    });
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
  console.log("🔍 loadServerMembers called, currentServerId:", currentServerId);
  console.log("   Current username:", username);
  
  if (!currentServerId) {
    console.warn("❌ No currentServerId, aborting loadServerMembers");
    return;
  }
  
  const content = document.getElementById("memberListContent");
  if (content) content.innerHTML = "<div style='padding:10px;color:#999;font-size:12px;'>Loading members...</div>";
  
  try {
    // Debug: Check if current user is in server_members
    console.log("📡 Debugging: Checking if current user exists in server_members...");
    const { data: myMembership } = await supabaseClient
      .from("server_members")
      .select("*")
      .eq("server_id", currentServerId)
      .eq("username", username)
      .maybeSingle();
    console.log("   My membership:", myMembership);
    
    // Always fetch fresh member data
    console.log("📡 Fetching server_members for server:", currentServerId);
    const { data: members, error } = await supabaseClient
      .from("server_members")
      .select("username, role")
      .eq("server_id", currentServerId);

    if (error) { 
      console.error("❌ loadServerMembers error:", error);
      const msg = `Error loading members: ${error.message || "Unknown error"}`;
      alert(msg);
      console.error("   Error code:", error.code);
      console.error("   Error hint:", error.hint);
      console.error("   Error details:", error.details);
      if (content) {
        content.innerHTML = `<div style='padding:10px;color:#ff6b6b;font-size:11px;word-break:break-word;font-family:monospace;'>
          <strong>Error loading members:</strong><br/>
          Code: ${error.code}<br/>
          Message: ${error.message}<br/>
          ${error.hint ? `Hint: ${error.hint}<br/>` : ''}
          Server ID: ${currentServerId ? currentServerId.substring(0, 8) + '...' : 'N/A'}<br/>
          Username: ${username || 'N/A'}
        </div>`;
      }
      return; 
    }
    
    serverMembers = Array.isArray(members) ? members : [];
    console.log("✅ Loaded", serverMembers.length, "server members", serverMembers);

    if (serverMembers.length === 0 && currentServerId) {
      console.warn("⚠️ server_members returned empty, trying fallback query");
      const { data: serversCache, error: fallbackError } = await supabaseClient
        .from("server_members")
        .select("username, role")
        .eq("server_id", currentServerId);
      if (!fallbackError && Array.isArray(serversCache) && serversCache.length > 0) {
        serverMembers = serversCache;
        console.log("✅ Fallback server_members query found", serverMembers.length, "members");
      }
    }

    // If still empty, fallback to owner + current user
    if (serverMembers.length === 0 && currentServerId) {
      const { data: serverInfo, error: serverError } = await supabaseClient
        .from("servers")
        .select("id, owner_username")
        .eq("id", currentServerId)
        .maybeSingle();
      if (!serverError && serverInfo) {
        const fallback = [];
        if (serverInfo.owner_username) fallback.push({ username: serverInfo.owner_username, role: "Admin" });
        if (username && username !== serverInfo.owner_username) {
          fallback.push({ username, role: "User" });
        }
        if (fallback.length > 0) {
          serverMembers = fallback;
          console.warn("⚠️ server_members empty; using owner/user fallback:", serverMembers);
        }
      }
    }

    // If still no members, use channel messages authors as a last resort
    if (serverMembers.length === 0 && currentChannelId) {
      const { data: messages } = await supabaseClient
        .from("messages")
        .select("username")
        .eq("channel_id", currentChannelId)
        .order("inserted_at", { ascending: false })
        .limit(50);

      const messageUsers = [...new Set((messages || []).map(m => m.username))].slice(0, 20);
      serverMembers = messageUsers.map(u => ({ username: u, role: u === username ? "User" : "User" }));
      if (serverMembers.length > 0) {
        console.warn("⚠️ server_members empty; using message authors fallback:", serverMembers);
      }
    }

    // Fetch presence data
    console.log("📡 Fetching channel_presence for server:", currentServerId);
    const { data: presence, error: presenceError } = await supabaseClient
      .from("channel_presence")
      .select("*")
      .eq("server_id", currentServerId);

    if (presenceError) {
      console.error("❌ Presence fetch error:", presenceError);
    }

    console.log("👥 Got", (presence || []).length, "presence records:", presence);
    renderMemberList(presence || []);
  } catch (err) {
    console.error("❌ Unexpected error in loadServerMembers:", err);
    alert(`Member list load failed: ${err.message || err}`);
    if (content) {
      content.innerHTML = `<div style='padding:10px;color:#ff6b6b;font-size:11px;'>
        Unexpected error: ${err.message || err}
      </div>`;
    }
  }
}

function renderMemberList(presence) {
  console.log("🎨 renderMemberList called, presence:", presence);
  const content = document.getElementById("memberListContent");
  console.log("📍 memberListContent element:", content);
  
  if (!content) {
    console.error("❌ memberListContent element not found!");
    return;
  }
  
  // Make sure we have serverMembers data
  if (!serverMembers || serverMembers.length === 0) {
    console.warn("⚠️ No server members to display. serverMembers:", serverMembers);
    alert("No server members found. This may be a database/permissions issue.");
    const debugInfo = currentServerId ? `Server ID: ${currentServerId.substring(0, 8)}...` : "No server selected";
    content.innerHTML = `<div style='padding: 10px; color: #999; font-size: 12px;'>
      No members found.<br/>
      <span style='font-size:10px;color:#666;'>(${debugInfo})</span>
    </div>`;

    // Keep member panel visible on mobile if this is the active server
    const memberPanel = document.getElementById('memberList');
    if (memberPanel) {
      memberPanel.style.display = 'flex';
      memberPanel.classList.add('open');
    }

    return;
  }

  console.log("✅ Starting to render", serverMembers.length, "members");

  // Ensure panel is visible (desktop + mobile after toggle)
  const memberPanel = document.getElementById('memberList');
  if (memberPanel) {
    if (window.innerWidth > 768) {
      memberPanel.style.display = 'flex';
    } else if (!memberPanel.classList.contains('open')) {
      // Keep mobile hidden until user toggles
      memberPanel.style.display = 'none';
    }
  }

  content.innerHTML = "";

  const presenceMap = new Map((presence || []).map(p => [p.username, p]));
  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000;
  const online = [];
  const offline = [];

  serverMembers.forEach(m => {
    const usernameKey = String(m.username || "").trim();
    const p = usernameKey ? presenceMap.get(usernameKey) : null;
    const isOnline = p && (now - new Date(p.updated_at).getTime() < ONLINE_THRESHOLD);

    if (isOnline) {
      console.log(`  ✅ ${usernameKey || '<unknown>'} is ONLINE`);
      online.push({ ...m, username: usernameKey || '<unknown>', presence: p });
    } else {
      console.log(`  ⚫ ${usernameKey || '<unknown>'} is OFFLINE`);
      offline.push({ ...m, username: usernameKey || '<unknown>', presence: p });
    }
  });

  console.log(`📊 Final split: ${online.length} online, ${offline.length} offline`);

  let renderedAnyGroup = false;
  const renderGroup = (label, members) => {
    if (members.length === 0) {
      console.log(`  (${label} group is empty, skipping)`);
      return;
    }
    renderedAnyGroup = true;
    console.log(`📌 Rendering ${label} group with ${members.length} members`);
    const groupLabel = document.createElement("div");
    groupLabel.className = "member-group-label";
    groupLabel.textContent = `${label} — ${members.length}`;
    content.appendChild(groupLabel);

    members.forEach(m => {
      const item = document.createElement("div");
      item.className = "member-item";
      const ch = m.presence ? channels.find(c => c.id === m.presence.channel_id) : null;
      const role = m.role || "User";
      const roleStr = String(role || "User").toLowerCase();
      const isSpecialRole = (roleStr === "admin" || roleStr === "manager");
      item.innerHTML = `
        <div class="member-avatar">
          ${escapeHTML(String(m.username || "?").charAt(0).toUpperCase())}
          <span class="status-dot ${label === "Online" ? "online" : ""}"></span>
        </div>
        <div class="member-info">
          <div class="member-name">${escapeHTML(String(m.username || "?") )}</div>
          ${ch ? `<div class="member-channel"># ${escapeHTML(ch.name)}</div>` : ""}
        </div>
        ${isSpecialRole ? `<span class="member-role-badge ${roleStr}">${role}</span>` : ""}
      `;
      content.appendChild(item);
      console.log(`    ✏️ Added ${m.username || '<unknown>'}`);
    });
  };

  renderGroup("Online", online);
  renderGroup("Offline", offline);

  if (!renderedAnyGroup) {
    console.warn("⚠️ No groups rendered, falling back to raw member list");
    content.innerHTML = "";
    const groupLabel = document.createElement("div");
    groupLabel.className = "member-group-label";
    groupLabel.textContent = `Members — ${serverMembers.length}`;
    content.appendChild(groupLabel);

    serverMembers.forEach(m => {
      const item = document.createElement("div");
      item.className = "member-item";
      item.innerHTML = `
        <div class="member-avatar">${escapeHTML(String(m.username || "?").charAt(0).toUpperCase())}</div>
        <div class="member-info">
          <div class="member-name">${escapeHTML(String(m.username || "?") )}</div>
        </div>
      `;
      content.appendChild(item);
    });
  }

  console.log("✅ renderMemberList complete! (renderedAnyGroup=", renderedAnyGroup, ")");
}

async function updateChannelPresence(channelId) {
  if (!username || !currentServerId) return;
  await supabaseClient.from("channel_presence").upsert({
    username,
    channel_id: channelId,
    server_id: currentServerId,
    updated_at: new Date().toISOString()
  }, { onConflict: ["username"] });
}

function subscribeToPresence() {
  console.log("🔔 subscribeToPresence called, currentServerId:", currentServerId);
  
  if (presenceSubscription) {
    try { presenceSubscription.unsubscribe(); } catch {}
    presenceSubscription = null;
  }
  
  // Clear old refresh interval if exists
  if (memberRefreshInterval) {
    clearInterval(memberRefreshInterval);
    memberRefreshInterval = null;
  }
  
  if (!currentServerId) {
    console.warn("❌ No currentServerId for subscribeToPresence");
    return;
  }

  console.log("📡 Setting up presence subscription for server:", currentServerId);
  presenceSubscription = supabaseClient
    .channel(`presence-${currentServerId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "channel_presence",
      filter: `server_id=eq.${currentServerId}`
    }, () => {
      console.log("🔄 Presence changed, reloading members");
      loadServerMembers();
    })
    .subscribe();

  // Refresh member list periodically (every 30 seconds) to catch any changes
  memberRefreshInterval = setInterval(() => {
    if (currentServerId) {
      console.log("⏰ 30s refresh: reloading members for server", currentServerId);
      loadServerMembers();
    }
  }, 30000);
  console.log("✅ Presence subscription set up!");
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
      role: "User"  // Set default role for joined members
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

async function createServer(name, slug) {
  const trimName = name.trim();
  const trimSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!trimName || !trimSlug) return "❌ Please fill in all fields.";

  const { data: existing } = await supabaseClient
    .from("servers")
    .select("id")
    .eq("slug", trimSlug)
    .maybeSingle();

  if (existing) return "❌ That URL is already taken. Try another.";

  const { data: newServer, error } = await supabaseClient
    .from("servers")
    .insert({ name: trimName, slug: trimSlug, owner_username: username })
    .select()
    .maybeSingle();

  if (error) return "❌ Failed to create server: " + error.message;

  // Add creator as Admin member
  const { data: memberRecord, error: memberError } = await supabaseClient.from("server_members").insert({
    server_id: newServer.id,
    username,
    role: "Admin"  // Server creator is admin
  }).select().maybeSingle();

  if (memberError) {
    // If member insert fails, delete the server
    await supabaseClient.from("servers").delete().eq("id", newServer.id);
    return "❌ Failed to add you to the server: " + memberError.message;
  }

  // Create server role entry (for permission system)
  const rolePayload = {
    server_id: newServer.id,
    role: "Admin",
    name: "Admin",
    permissions: {
      manage_roles: true,
      create_channels: true,
      delete_messages: true,
      manage_messages: true
    },
    color: "#5865f2",
    description: "Server owner/admin role"
  };

  const { data: roleRecord, error: roleError } = await supabaseClient
    .from("server_roles")
    .insert(rolePayload)
    .select()
    .maybeSingle();

  if (roleError) {
    console.warn("⚠️ server_roles insert failed:", roleError.message);
  } else if (roleRecord && memberRecord) {
    const { error: memberRoleError } = await supabaseClient
      .from("server_member_roles")
      .insert({
        server_id: newServer.id,
        member_id: memberRecord.id,
        role_id: roleRecord.id
      });

    if (memberRoleError) {
      if (memberRoleError.code === "42P01" || /does not exist/.test(String(memberRoleError.message))) {
        console.warn("⚠️ server_member_roles table missing, skipping member-role mapping");
      } else {
        // Cleanup on fatal errors
        await supabaseClient.from("servers").delete().eq("id", newServer.id);
        return "❌ Failed to map member role: " + memberRoleError.message;
      }
    }
  }

  servers.push(newServer);
  renderServerList();
  await switchServer(newServer.id);
  return null;
}

function initServerModals() {
  const addBtn = document.getElementById("addServerBtn");
  if (addBtn) addBtn.addEventListener("click", () => openModal("serverModal"));

  const goCreate = document.getElementById("goCreateServer");
  if (goCreate) goCreate.addEventListener("click", () => {
    closeModal("serverModal");
    openModal("createServerModal");
  });

  const goJoin = document.getElementById("goJoinServer");
  if (goJoin) goJoin.addEventListener("click", () => {
    closeModal("serverModal");
    openModal("joinServerModal");
  });

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
}

// ======================== SERVER ROLE HELPERS ========================

async function refreshServerRole() {
  if (!currentServerId || !username) return;

  if (currentSystemRole === "SysAdmin") {
    currentRole = "Admin";
    loadUserPermissions("admin");
  } else if (currentSystemRole === "SysManager") {
    currentRole = "Manager";
    userPermissions = {
      read_messages: true, send_messages: true, delete_messages: true,
      rename_channels: false, create_channels: false, manage_roles: false,
      mute_users: true, manage_messages: true, manage_reports: true
    };
  } else {
    const { data: memberData } = await supabaseClient
      .from("server_members")
      .select("role")
      .eq("server_id", currentServerId)
      .eq("username", username)
      .maybeSingle();
    const roleName = memberData?.role || "User";
    currentRole = roleName;
    loadUserPermissions(roleName);
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

const createChannelBtn = document.getElementById("createChannelBtn");

if (createChannelBtn) {
  createChannelBtn.addEventListener("click", () => {
    openInlineRow("channel-create", "", null);
  });
}