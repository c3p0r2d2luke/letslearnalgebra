/* global URLSearchParams, Sortable, requestAnimationFrame, localStorage, console, alert, prompt, confirm, fetch, document, window, Date, Blob, URL, Notification, emailjs */

/* =============================================================================
 * LLA Realtime Chat — script.js
 *
 * TABLE OF CONTENTS
 *   1.  Loader helpers                     (top of file)
 *   2.  Link-preview cache helpers
 *   3.  Server roles + filter constants
 *   4.  Mobile context-menu helpers        (~ line 170)
 *   5.  Message right-click / long-press menu
 *   6.  Supabase auth + bootstrap          (~ line 520)
 *   7.  Realtime manager                   (~ line 2170)
 *   8.  Channels + categories rendering    (~ line 2900)
 *   9.  Channel/category admin actions     (~ line 3260)
 *   10. Messages: load / render / realtime (~ line 3650)
 *   11. Send / save name handlers          (~ line 4380)
 *   12. Mobile sidebar toggle              (~ line 4480)
 *   13. Emoji picker + custom emojis       (~ line 4540)
 *   14. Discord-style features
 *         - Edit, reactions, replies,
 *           typing, hover controls          (~ line 5670)
 *   15. Threads + force-logout              (~ line 6000)
 *   16. File upload + lightbox              (~ line 6050)
 *   17. Scroll-to-bottom button             (~ line 6300)
 *   18. Create-channel modal                (~ line 6520)
 *   19. Server system + sortable            (~ line 6900)
 *   20. Server role helpers                 (~ line 7960)
 *   21. GIF / image URL resolver            (~ line 8140)
 *   22. Server context menu + invites       (~ line 8260)
 *   23. Profile modal listeners             (~ line 9210)
 *   24. Account-link modal listeners        (~ line 9500)
 * ============================================================================= */

/* ---------- 1. LOADER HELPERS ----------
 * The loader stays open only while the app is genuinely getting ready. As soon
 * as bootstrapAuth() (or any failure path) calls hideLoader(), it fades out.
 */


// --- AUDIO UNLOCK HELPER ---
let audioContextUnlocked = false;

async function unlockAudioContext() {
  if (audioContextUnlocked) return;
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    
    // Create a silent oscillator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.value = 1; // Very low frequency
    gain.gain.value = 0.001; // Almost silent
    
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    
    // Wait a moment then resume
    await ctx.resume();
    audioContextUnlocked = true;
    console.log("✅ Audio context unlocked via silent oscillator.");
  } catch (e) {
    console.warn("⚠️ Could not unlock audio context:", e);
  }
}

// Call this immediately when the user joins a voice channel
// We will hook this into joinVoiceChannel below.

/*-------------Debugging trick to make console logs into alerts
async function catchConsoleLogsAsAlerts() {
  const methods = ["log", "warn", "error", "info", "debug"];

  methods.forEach((method) => {
    const original = console[method];

    console[method] = function (...args) {
      let message = args.map(arg => {
        try {
          if (typeof arg === "object") {
            return JSON.stringify(arg, null, 2);
          }
          return String(arg);
        } catch {
          return "[Unserializable Object]";
        }
      }).join(" ");

      alert(`[${method.toUpperCase()}]\n\n${message}`);

      original.apply(console, args);
    };
  });
}

catchConsoleLogsAsAlerts();*/

let _loaderHidden = false;

function showLoader() {
  _loaderHidden = false;
  const el = document.getElementById("appLoader");
  if (el) {
    el.style.removeProperty("opacity");
    el.style.display = "flex";
  }
}

function hideLoader() {
  if (_loaderHidden) return;
  _loaderHidden = true;
  const el = document.getElementById("appLoader");
  if (!el) return;
  el.style.transition = "opacity 180ms ease-out";
  el.style.opacity = "0";
  setTimeout(() => {
    if (_loaderHidden) el.style.display = "none";
  }, 200);
}

// Safety net: if bootstrap takes longer than expected, never trap the user
// behind the loader forever.
window.addEventListener("load", () => {
  setTimeout(() => hideLoader(), 8000);
});


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

const SERVER_ROLE_LADDER = ["User", "Manager", "Admin", "SysManager", "SysAdmin"];

const DEFAULT_SERVER_SETTINGS = Object.freeze({
  bad_word_filter_enabled: false,
  admin_only_custom_emojis: false,
  allow_plaintext_links: false,
  allow_everyone_mentions: false
});

let currentServerSettings = { ...DEFAULT_SERVER_SETTINGS };
let currentServerWordFilters = [];
const serverSettingsCache = new Map();
const serverWordFiltersCache = new Map();
const FILTER_CHAR_MAP = Object.freeze({
  "$": "s",
  "5": "s",
  "€": "e",
  "3": "e",
  "@": "a",
  "4": "a",
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "+": "t",
  "7": "t",
  "8": "b",
  "9": "g",
  "2": "z"
});

function normalizeServerRole(roleName, fallback = "User") {
  const raw = String(roleName || "").trim().toLowerCase();
  if (!raw) return fallback;
  const match = SERVER_ROLE_LADDER.find((role) => role.toLowerCase() === raw);
  return match || fallback;
}

const input = document.getElementById("messageInput");
const messageSearchInput = document.getElementById("messageSearchInput");
const memberSearchInput = document.getElementById("memberSearchInput");
const messageSearchToggle = document.getElementById("messageSearchToggle");
const memberSearchToggle = document.getElementById("memberSearchToggle");
const dmListEl = document.getElementById("dmList");
const newDmBtn = document.getElementById("newDmBtn");
const mentionSuggestionsEl = document.getElementById("mentionSuggestions");
const profileBtn = document.getElementById("profileBtn");
if (profileBtn) {
  profileBtn.addEventListener("click", () => {
    if (!username) {
      console.warn("Profile clicked before user loaded");
      return;
    }
    openUserProfile(username);
  });
}
const avatarInput = document.getElementById("avatarInput");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");
let messageSearchTerm = "";
let memberSearchTerm = "";
let mentionSuggestionItems = [];
let mentionSelectedIndex = 0;
let activeSuggestionMode = null;
let userProfileModal = null;
let currentProfileUsername = null;
let currentProfileServerId = null; // Null if global profile

// Keep the suggestions popup out of any stacking/overflow contexts so it stays visible.
if (mentionSuggestionsEl && mentionSuggestionsEl.parentElement !== document.body) {
  document.body.appendChild(mentionSuggestionsEl);
}

input.addEventListener("input", () => {
  sendTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTyping(false);
  }, 2000);
  updateMentionSuggestions();
});

// Channel creation is handled by the IIFE below (openInlineRow)

const channelSidebar = document.querySelector(".channel-sidebar");
const categoryMenu = document.getElementById("categoryMenu");

// Close category menu on click-away (channelMenu is handled in the shared click handler below)
document.addEventListener("click", () => {
  if (categoryMenu) categoryMenu.style.display = "none";
});

const MOBILE_LONG_PRESS_MS = 450;
let recentMobileMessageMenuAt = 0;

function isMobileContextMenuMode() {
  return window.innerWidth <= 768 || Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}

function closeAllContextMenus() {
  ["adminMenu", "channelMenu", "memberMenu", "categoryMenu"].forEach((id) => {
    const menu = document.getElementById(id);
    if (!menu) return;
    menu.style.display = "none";
    menu.classList.remove("mobile-sheet", "mobile-message-sheet");
  });
}

["adminMenu", "channelMenu", "memberMenu", "categoryMenu"].forEach((id) => {
  const menu = document.getElementById(id);
  if (!menu) return;
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  menu.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
});

function getMessageMenuSections(messageId, author, anchorX, anchorY) {
  const isDm = currentConversationType === "dm";
  const sections = [
    {
      title: "Quick Actions",
      items: [
        { label: "Reply", action: () => startReply(messageId) },
        ...(!isDm ? [{ label: "React", action: () => openEmojiPicker(messageId, anchorX + 10, anchorY + 10) }] : []),
        ...(!isDm ? [{ label: "Report", action: () => reportMessage(messageId) }] : [])
      ]
    }
  ];

  if (isDm && author === username) {
    sections.push({
      title: "Message",
      items: [
        { label: "Delete My Message", action: () => deleteMessage(messageId) }
      ]
    });
  }

  if (currentRole === "Manager" && author === username) {
    sections.push({
      title: "Manager",
      items: [
        { label: "Delete My Message", action: () => deleteMessage(messageId) }
      ]
    });
  }

  if (userPermissions.manage_roles) {
    sections.push(
      {
        title: "Delete",
        items: [
          { label: "Delete", action: () => deleteMessage(messageId) },
          ...(!isDm ? [{ label: "Delete By Keyword", action: () => deleteKeyword() }] : [])
        ]
      },
      {
        title: "Info",
        items: [
          { label: "User Info", action: () => userInfo(author) },
          ...(!isDm ? [{ label: "Export Chat", action: () => exportChat() }] : [])
        ]
      },
      {
        title: "Edit",
        items: [
          { label: "Edit Message", action: () => editMessage(messageId) },
          ...(!isDm ? [{ label: "Pin / Unpin", action: () => pinMessage(messageId) }] : []),
          { label: "Change Name", action: () => changeName(author) },
          { label: "Promote / Demote", action: () => promote(author) },
          { label: "Give Custom Role", action: () => giveCustomRole(author) },
          { label: "Mute User (this server)", action: () => muteUser(author) },
          ...(currentSystemRole === "SysAdmin" ? [
            { label: "Global Mute (sysadmin)", action: () => globalMuteUser(author) },
            { label: "Global Unmute (sysadmin)", action: () => globalUnmuteUser(author) }
          ] : []),
          { label: "Block User", action: () => blockUser(author) },
          { label: "Unblock User", action: () => unblockUser(author) },
          { label: "Force Logout", action: () => forceLogout(author) }
        ]
      }
    );
  }

  return sections;
}

function showDesktopMessageMenu(menu, sections, anchorX, anchorY) {
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

  sections.forEach((section, index) => {
    if (index === 0) {
      currentSection = menu;
      section.items.forEach(item => addButton(item.label, item.action));
      return;
    }
    addSection(section.title);
    section.items.forEach(item => addButton(item.label, item.action));
  });

  const menuWidth = 200;
  const menuHeight = 300;
  let leftPos = anchorX + 10;
  let topPos = anchorY + 10;

  if (leftPos + menuWidth > window.innerWidth) leftPos = anchorX - menuWidth - 10;
  if (topPos + menuHeight > window.innerHeight) topPos = anchorY - menuHeight - 10;
  if (leftPos < 0) leftPos = 10;
  if (topPos < 0) topPos = 10;

  menu.style.position = "fixed";
  menu.style.left = leftPos + "px";
  menu.style.top = topPos + "px";
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.background = "#2f3136";
  menu.style.border = "1px solid #444";
  menu.style.padding = "4px";
  menu.style.display = "block";
}

function showMobileMessageMenu(menu, sections) {
  menu.classList.add("mobile-sheet", "mobile-message-sheet");

  const title = document.createElement("div");
  title.className = "context-menu-sheet-title";
  title.textContent = "Message Actions";
  menu.appendChild(title);

  sections.forEach((section) => {
    const wrapper = document.createElement("div");
    wrapper.className = "context-menu-dropdown-group";

    const label = document.createElement("label");
    label.className = "context-menu-dropdown-label";
    label.textContent = section.title;

    const select = document.createElement("select");
    select.className = "context-menu-dropdown";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = `Choose ${section.title.toLowerCase()}...`;
    select.appendChild(placeholder);

    section.items.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = item.label;
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      const selectedIndex = Number(select.value);
      if (!Number.isInteger(selectedIndex) || !section.items[selectedIndex]) return;
      menu.style.display = "none";
      section.items[selectedIndex].action();
      select.value = "";
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    menu.appendChild(wrapper);
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "context-menu-close";
  closeBtn.textContent = "Close";
  closeBtn.onclick = (event) => {
    event.stopPropagation();
    menu.style.display = "none";
  };
  menu.appendChild(closeBtn);

  menu.style.position = "fixed";
  menu.style.left = "8px";
  menu.style.right = "8px";
  menu.style.bottom = "max(8px, env(safe-area-inset-bottom))";
  menu.style.top = "auto";
  menu.style.display = "block";
}

function openMessageContextMenu(anchorX, anchorY, message) {
  const menu = document.getElementById("adminMenu");
  if (!menu) {
    console.error("❌ #adminMenu not found in DOM!");
    return;
  }

  closeAllContextMenus();

  const messageId = message.dataset.id;
  const author = message.dataset.user;
  const sections = getMessageMenuSections(messageId, author, anchorX, anchorY);

  menu.innerHTML = "";
  menu.classList.remove("mobile-sheet", "mobile-message-sheet");

  if (isMobileContextMenuMode()) {
    showMobileMessageMenu(menu, sections);
  } else {
    showDesktopMessageMenu(menu, sections, anchorX, anchorY);
  }

  console.log("✅ Context menu opened for message:", messageId);
}

function attachMessageLongPress(messageEl) {
  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  let handled = false;

  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  messageEl.addEventListener("touchstart", (event) => {
    if (!isMobileContextMenuMode() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    handled = false;
    clearPress();
    pressTimer = setTimeout(() => {
      handled = true;
      recentMobileMessageMenuAt = Date.now();
      openMessageContextMenu(startX, startY, messageEl);
    }, MOBILE_LONG_PRESS_MS);
  }, { passive: true });

  messageEl.addEventListener("touchmove", (event) => {
    if (!pressTimer) return;
    const touch = event.touches[0];
    if (!touch) return;
    const movedTooFar = Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12;
    if (movedTooFar) clearPress();
  }, { passive: true });

  messageEl.addEventListener("touchend", (event) => {
    if (handled) event.preventDefault();
    clearPress();
    handled = false;
  }, { passive: false });

  messageEl.addEventListener("touchcancel", () => {
    clearPress();
    handled = false;
  }, { passive: true });
}

document.addEventListener("contextmenu", (e) => {
  const message = e.target.closest("li[data-id]");
  if (!message) return;

  if (isMobileContextMenuMode() && Date.now() - recentMobileMessageMenuAt < 800) {
    e.preventDefault();
    return;
  }

  e.preventDefault();
  openMessageContextMenu(e.clientX, e.clientY, message);
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

function getAuthRedirectUrl() {
  const origin = window.location.origin;
  // If origin is valid (http/https), use it.
  if (origin && origin !== "null" && origin !== "file://") {
    return `${origin}${window.location.pathname}`;
  }
  // Fallback: If you are on localhost but the origin detection is weird, 
  // explicitly define your local dev URL.
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
     return `${window.location.origin}${window.location.pathname}`;
  }
  return null; 
}

function deriveDefaultUsername(authUser) {
  const rawFromMetadata = authUser?.user_metadata?.username || authUser?.user_metadata?.preferred_username;
  const rawFromEmail = authUser?.email ? String(authUser.email).split("@")[0] : "";
  const candidate = String(rawFromMetadata || rawFromEmail || "user").trim();
  return candidate.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "user";
}

async function ensureUserProfileRow(authUser) {
  const authId = authUser?.id;
  if (!authId) throw new Error("Missing auth user id.");

  const { data: existing, error: fetchError } = await supabaseClient
    .from("users")
    .select("username, sys_admin, sys_manager, blocked, muted_until, avatar_url")
    .eq("auth_id", authId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing;

  // If the auth user exists but no app profile row exists yet, create one now.
  // This happens for first-time OAuth sign-in and (optionally) magic-link users.
  let proposed = deriveDefaultUsername(authUser);
  let chosen = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    chosen = prompt("Choose a username (letters, numbers, underscore):", proposed) || "";
    chosen = chosen.trim();
    if (!chosen) return null;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(chosen)) {
      alert("❌ Username must be 3–20 chars and only letters, numbers, underscore.");
      proposed = chosen || proposed;
      continue;
    }

    const { data: taken, error: takenError } = await supabaseClient
      .from("users")
      .select("username")
      .eq("username", chosen)
      .maybeSingle();

    if (takenError) throw takenError;
    if (taken) {
      alert("❌ Username already taken.");
      proposed = chosen;
      continue;
    }
    break;
  }

  if (!chosen) return null;

  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || null;
  const { error: insertError } = await supabaseClient.from("users").insert({
    username: chosen,
    auth_id: authId,
    sys_admin: false,
    sys_manager: false,
    blocked: false,
    forceLogout: false,
    avatar_url: avatarUrl
  });

  if (insertError) throw insertError;

  return {
    username: chosen,
    sys_admin: false,
    sys_manager: false,
    blocked: false,
    muted_until: null,
    avatar_url: avatarUrl || ""
  };
}

// In your auth section

async function handleAuthSuccess(user) {
  const authId = user.id;
  console.log("🔑 Auth Success. Fetching profile for auth_id:", authId);

  let userData;
  try {
    userData = await ensureUserProfileRow(user);
  } catch (profileError) {
    console.error("❌ DB Error fetching/creating profile:", profileError);
    alert("Database error. Please try again.");
    return;
  }

  if (!userData) {
    alert("Sign-in canceled. Please sign in again to continue.");
    await supabaseClient.auth.signOut();
    showAuthGate();
    return;
  }

  // 2. CRITICAL: Set Global State & Save to LocalStorage IMMEDIATELY
  username = userData.username;
  setAvatarUrl(username, userData.avatar_url || "");
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
  subscribeToGlobalMentions();
}

async function doSignUp() {
  const usernameVal = document.getElementById("signUpUsername").value.trim();
  const email = document.getElementById("signUpEmail").value.trim();
  const password = document.getElementById("signUpPassword").value;
  const avatarFile = document.getElementById("signUpAvatar")?.files?.[0] || null;
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
      forceLogout: false,
      avatar_url: null
    });

  if (profileError) {
    console.error("Profile creation failed:", profileError);
    // Optional: Cleanup auth user if profile fails
    // await supabaseClient.auth.admin.deleteUser(userId); 
    errorEl.textContent = "❌ Failed to create profile. Check console.";
    errorEl.style.display = "block";
    return;
  }

  if (avatarFile) {
    const avatarResult = await uploadAvatarFile(avatarFile, usernameVal, userId);
    if (avatarResult.error) {
      errorEl.textContent = avatarResult.error;
      errorEl.style.display = "block";
      return;
    }
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
let authBootstrapped = false;
let authHandling = false;

async function handleAuthRedirectIfNeeded() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return;

  // Check if this is an OAuth linking attempt
  const isLinking = localStorage.getItem('oauth_linking') === 'true';
  const linkingProvider = localStorage.getItem('oauth_provider');
  const linkingUserId = localStorage.getItem('oauth_user_id');

  const { error } = await supabaseClient.auth.exchangeCodeForSession(window.location.href);
  if (error) {
    console.warn("Auth code exchange failed:", error);
    // Clean up linking context on error
    if (isLinking) {
      localStorage.removeItem('oauth_linking');
      localStorage.removeItem('oauth_provider');
      localStorage.removeItem('oauth_user_id');
    }
    return;
  }

  // Handle OAuth linking completion
  if (isLinking && linkingProvider) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user && user.id === linkingUserId) {
      console.log(`✅ Successfully linked ${linkingProvider} account!`);
      // Show success message in the account link modal when it opens
      setTimeout(() => {
        const statusEl = document.getElementById("accountLinkStatus");
        if (statusEl) {
          statusEl.textContent = `✅ ${linkingProvider.charAt(0).toUpperCase() + linkingProvider.slice(1)} account linked successfully!`;
          statusEl.style.display = "block";
          statusEl.style.color = "#3ba55d";
          statusEl.style.background = "rgba(59, 165, 93, 0.1)";
          setTimeout(() => {
            statusEl.style.display = "none";
          }, 5000);
        }
        // Update button states if modal is open
        updateAccountLinkButtons();
      }, 1000);
    } else {
      console.warn("⚠️ OAuth linking may have failed - user ID mismatch");
    }

    // Clean up linking context
    localStorage.removeItem('oauth_linking');
    localStorage.removeItem('oauth_provider');
    localStorage.removeItem('oauth_user_id');
  }

  url.searchParams.delete("code");
  window.history.replaceState({}, document.title, url.toString());
}

async function bootstrapAuth() {
  if (authBootstrapped) return;
  authBootstrapped = true;

  showLoader();

  try {
    try {
      await handleAuthRedirectIfNeeded();
    } catch (err) {
      console.warn("Auth redirect handling failed:", err);
    }

    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session?.user) {
      await handleAuthSuccess(session.user);
    } else {
      showAuthGate();
    }
  } catch (err) {
    console.error("Bootstrap failed:", err);
    showAuthGate();
  } finally {
    // Hide as soon as the app is ready — no minimum wait.
    hideLoader();
  }
}

document.addEventListener("DOMContentLoaded", bootstrapAuth);

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

async function sendMagicLink() {
  const email = document.getElementById("signInEmail").value.trim();
  const errorEl = document.getElementById("signInError");
  errorEl.style.display = "none";

  if (!email) {
    errorEl.textContent = "❌ Enter your email first.";
    errorEl.style.display = "block";
    return;
  }

  const redirectTo = getAuthRedirectUrl();
  const magicBtn = document.getElementById("magicLinkBtn");
  if (magicBtn) {
    magicBtn.disabled = true;
    magicBtn.textContent = "Sending…";
  }
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
      shouldCreateUser: true
    }
  });

  if (magicBtn) {
    magicBtn.disabled = false;
    magicBtn.textContent = "Email Me a Magic Link";
  }

  if (error) {
    errorEl.textContent = "❌ " + error.message;
    errorEl.style.display = "block";
    return;
  }

  errorEl.textContent = "✅ Magic link sent. Check your email.";
  errorEl.style.display = "block";
}

async function signInWithOAuthProvider(provider) {
  const redirectTo = getAuthRedirectUrl();

  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider,
    options: {
      ...(redirectTo ? { redirectTo } : {})
    }
  });

  if (error) {
    console.error("OAuth error:", error);
    alert(error.message);
    return;
  }

  if (!data?.url) {
    console.error("No redirect URL returned:", data);
    alert("OAuth failed: no redirect URL");
    return;
  }

  window.location.href = data.url;
}

document.getElementById("signInBtn").addEventListener("click", doSignIn);
document.getElementById("magicLinkBtn").addEventListener("click", sendMagicLink);
document.getElementById("signInPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSignIn();
});

const oauthGoogleBtn = document.getElementById("oauthGoogleBtn");
if (oauthGoogleBtn) {
  oauthGoogleBtn.addEventListener("click", () => signInWithOAuthProvider("google"));
}

const oauthGithubBtn = document.getElementById("oauthGithubBtn");
if (oauthGithubBtn) {
  oauthGithubBtn.addEventListener("click", () => signInWithOAuthProvider("github"));
}

const oauthDiscordBtn = document.getElementById("oauthDiscordBtn");
if (oauthDiscordBtn) {
  oauthDiscordBtn.addEventListener("click", () => signInWithOAuthProvider("discord"));
}

const oauthAzureBtn = document.getElementById("oauthAzureBtn");
if (oauthAzureBtn) {
  oauthAzureBtn.addEventListener("click", () => signInWithOAuthProvider("azure"));
}

document.getElementById("signUpBtn").addEventListener("click", doSignUp);
document.getElementById("signUpPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSignUp();
});

let isTyping = false;
let channels = [];
let categories = [];
let collapsedCategories = new Set();
try { collapsedCategories = new Set(JSON.parse(localStorage.getItem("collapsedCategories") || "[]")); } catch {}
let currentChannelId = null;
let lastTextChannelId = null; // last non-voice channel — used to return after VC disconnect
let currentServerId = null;
let currentConversationType = "channel";
let currentDmConversationId = null;
let servers = [];
let serverMembers = [];
let memberPresence = [];
let directConversations = [];
let memberRealtimeSubscription = null;
let globalMentionSubscription = null;
let serverMembershipSubscription = null;
let dmMembershipSubscription = null;
let dmRealtimeSubscription = null;
let isBlocked = false;
let mutedUntil = null;          // per-server mute (admin imposed)
let globalMutedUntil = null;    // global sysadmin mute (users.muted_until)
let selfMuted = (localStorage.getItem("chatSelfMuted") === "true");  // self-imposed, can self-clear
let muteInterval = null;
let currentNotificationPrefs = { mentions: true, replies: true, all_messages: false };
let currentPresenceStatus = localStorage.getItem("chatPresenceStatus") || "online"; // online|idle|dnd|invisible
let currentCustomStatus = "";
let currentBio = "";
let currentThemeId = null;
let availableThemes = [];
let cachedUserVoiceVolume = parseInt(localStorage.getItem("chatVoiceVolume") || "100", 10);
const messageDataMap = new Map(); // id → full message object
const NO_EMBED_PHRASE = "potatoheadman";
const avatarUrlByUsername = new Map();
const serverProfileByKey = new Map();
let currentUserAvatarUrl = "";
const channelServerMap = new Map();
const unreadMentionCounts = new Map();
const deliveredMentionNotifications = new Set();
const button = document.getElementById("sendButton");
const messagesList = document.getElementById("messages");

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getInitials(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function getServerProfileKey(serverId, usernameValue) {
  return `${serverId || "global"}:${String(usernameValue || "").toLowerCase()}`;
}

function setServerProfileData(serverId, usernameValue, profile = {}) {
  if (!serverId || !usernameValue) return;
  const key = getServerProfileKey(serverId, usernameValue);
  serverProfileByKey.set(key, {
    display_name: profile.display_name || "",
    avatar_url: profile.avatar_url || "",
    role: profile.role || "",
    role_color: profile.role_color || ""
  });
}

function getServerProfileData(serverId, usernameValue) {
  if (!serverId || !usernameValue) return null;
  return serverProfileByKey.get(getServerProfileKey(serverId, usernameValue)) || null;
}

function getEffectiveDisplayName(usernameValue, serverId = currentConversationType === "channel" ? currentServerId : null) {
  if (usernameValue === "Frenchwizz") return "Takeo";
  const profile = getServerProfileData(serverId, usernameValue);
  return profile?.display_name || usernameValue;
}

function getAvatarUrl(usernameValue) {
  return avatarUrlByUsername.get(String(usernameValue || "").toLowerCase()) || "";
}

function getEffectiveAvatarUrl(usernameValue, serverId = currentConversationType === "channel" ? currentServerId : null) {
  const profile = getServerProfileData(serverId, usernameValue);
  return profile?.avatar_url || getAvatarUrl(usernameValue);
}

function bustAvatarUrl(url) {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

function setAvatarUrl(usernameValue, url) {
  if (!usernameValue) return;
  avatarUrlByUsername.set(String(usernameValue).toLowerCase(), url || "");
  if (String(usernameValue).toLowerCase() === String(username || "").toLowerCase()) {
    currentUserAvatarUrl = url || "";
    updateProfileButton();
  }
}

async function loadAvatarMapForUsernames(usernames) {
  const unique = [...new Set((usernames || []).filter(Boolean))];
  if (unique.length === 0) return;

  const missing = unique.filter(name => !avatarUrlByUsername.has(String(name).toLowerCase()));
  if (missing.length === 0) return;

  const { data, error } = await supabaseClient
    .from("users")
    .select("username, display_name, avatar_url")
    .in("username", missing);
  if (error) {
    console.warn("⚠️ Failed to load avatars:", error.message);
    return;
  }

  (data || []).forEach(row => setAvatarUrl(row.username, row.avatar_url || ""));
  missing.forEach(name => {
    if (!avatarUrlByUsername.has(String(name).toLowerCase())) {
      avatarUrlByUsername.set(String(name).toLowerCase(), "");
    }
  });
}

function buildAvatarElement(usernameValue, className) {
  const avatar = document.createElement("div");
  avatar.className = className;
  const displayLabel = getEffectiveDisplayName(usernameValue);
  const avatarUrl = getEffectiveAvatarUrl(usernameValue);
  const initials = document.createElement("span");
  initials.className = "avatar-fallback";
  initials.textContent = getInitials(displayLabel);
  avatar.appendChild(initials);

  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "avatar-image";
    img.alt = `${displayLabel} avatar`;
    img.loading = "lazy";
    img.src = avatarUrl;
    img.onerror = () => {
      img.remove();
      avatar.classList.remove("has-image");
    };
    img.onload = () => {
      avatar.classList.add("has-image");
    };
    avatar.appendChild(img);
  }
  return avatar;
}

function updateProfileButton() {
  const btn = document.getElementById("profileBtn");
  if (!btn) return;

  const displayLabel = getEffectiveDisplayName(username);
  const avatarUrl = getEffectiveAvatarUrl(username) || currentUserAvatarUrl || getAvatarUrl(username);

  // Reset
  btn.innerHTML = "";
  btn.classList.remove("has-image");

  const fallback = document.createElement("span");
  fallback.className = "avatar-fallback";
  fallback.textContent = getInitials(displayLabel);
  btn.appendChild(fallback);

  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "avatar-image";
    img.alt = `${displayLabel} avatar`;
    img.src = avatarUrl;
    img.onload = () => btn.classList.add("has-image");
    img.onerror = () => {
      img.remove();
      btn.classList.remove("has-image");
    };
    btn.appendChild(img);
  }
}

async function notifyMentionClientSide(msg, serverId = null) {
  if (!msg?.id) return;
  if (deliveredMentionNotifications.has(msg.id)) return;

  const pageVisible = document.visibilityState === "visible" && document.hasFocus();
  if (pageVisible) return;
  if (Notification.permission !== "granted") return;

  deliveredMentionNotifications.add(msg.id);

  const title = /@(everyone|here)\b/i.test(String(msg.content || ""))
    ? `${msg.username} pinged everyone`
    : `${msg.username} mentioned you`;
  const body = String(msg.content || "").slice(0, 140) || "Open chat to view the message.";
  const targetServer = serverId || channelServerMap.get(Number(msg.channel_id));
  const url = targetServer
    ? `/chatwithteachers?server=${encodeURIComponent((servers.find(server => server.id === targetServer)?.slug) || "")}`
    : "/chatwithteachers";

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        tag: `mention-${msg.id}`,
        icon: "/logo.png",
        badge: "/logo.png",
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200, 100, 400],
        silent: false,
        data: { url }
      });
      return;
    }
  } catch (notificationError) {
    console.warn("⚠️ Service worker notification fallback failed:", notificationError);
  }

  try {
    new Notification(title, {
      body,
      tag: `mention-${msg.id}`
    });
  } catch (notificationError) {
    console.warn("⚠️ Direct Notification fallback failed:", notificationError);
  }
}

async function showLocalTestNotification() {
  if (Notification.permission !== "granted") return;

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Notifications enabled", {
        body: "Local notification test successful.",
        tag: "local-notification-test",
        icon:  "/logo.png",
        badge: "/logo.png",
        requireInteraction: true,
        silent: false,
        vibrate: [120, 60, 120],
        data: { url: window.location.pathname + window.location.search }
      });
      return;
    }
  } catch (error) {
    console.warn("⚠️ Local service worker notification test failed:", error);
  }

  try {
    new Notification("Notifications enabled", {
      body: "Local notification test successful.",
      tag: "local-notification-test"
    });
  } catch (error) {
    console.warn("⚠️ Direct local notification test failed:", error);
  }
}

async function uploadAvatarAsset(file, authIdOverride = null) {
  if (!file) return { error: "❌ No file selected." };
  if (!String(file.type || "").startsWith("image/")) return { error: "❌ Avatar must be an image." };
  if (file.size > 5 * 1024 * 1024) return { error: "❌ Avatar must be under 5MB." };

  const authId = authIdOverride || (await supabaseClient.auth.getUser())?.data?.user?.id;
  if (!authId) return { error: "❌ Could not identify your account." };

  const extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${authId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabaseClient.storage
    .from("avatars")
    .upload(path, file, { upsert: true });
  if (uploadError) return { error: "❌ Failed to upload avatar: " + uploadError.message };

  const { data: publicData } = supabaseClient.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = bustAvatarUrl(publicData?.publicUrl || "");
  if (!avatarUrl) return { error: "❌ Failed to resolve avatar URL." };
  return { avatarUrl };
}

async function uploadAvatarFile(file, targetUsername, authIdOverride = null) {
  const asset = await uploadAvatarAsset(file, authIdOverride);
  if (asset.error || !asset.avatarUrl) return asset;

  const { error: updateError } = await supabaseClient
    .from("users")
    .update({ avatar_url: asset.avatarUrl })
    .eq("username", targetUsername);
  if (updateError) return { error: "❌ Failed to save avatar: " + updateError.message };

  setAvatarUrl(targetUsername, asset.avatarUrl);
  return { avatarUrl: asset.avatarUrl };
}

async function uploadServerProfileAvatar(file, serverId, targetUsername) {
  const result = await uploadAvatarAsset(file);
  if (result.error || !result.avatarUrl) return result;

  const { error: updateError } = await supabaseClient
    .from("server_members")
    .update({ profile_avatar_url: result.avatarUrl })
    .eq("server_id", serverId)
    .eq("username", targetUsername);
  if (updateError) return { error: "❌ Failed to save server profile avatar: " + updateError.message };

  const existing = getServerProfileData(serverId, targetUsername) || {};
  setServerProfileData(serverId, targetUsername, {
    ...existing,
    avatar_url: result.avatarUrl
  });
  updateProfileButton();
  return result;
}

async function editMyServerProfile() {
  if (!currentServerId || !username) {
    alert("❌ No server selected.");
    return;
  }

  const existing = getServerProfileData(currentServerId, username) || {};
  const nextDisplayName = prompt(
    "Server display name:",
    existing.display_name || username
  );
  if (nextDisplayName === null) return;

  const cleanedDisplayName = nextDisplayName.trim();
  const { error } = await supabaseClient
    .from("server_members")
    .update({ profile_display_name: cleanedDisplayName || null })
    .eq("server_id", currentServerId)
    .eq("username", username);

  if (error) {
    alert("❌ Failed to update server profile: " + error.message);
    return;
  }

  setServerProfileData(currentServerId, username, {
    ...existing,
    display_name: cleanedDisplayName || ""
  });

  if (currentConversationType === "channel") {
    await loadMessages();
    renderMemberList();
  }
  renderDmList();
}

async function changeMyAvatar() {
  const file = avatarInput?.files?.[0];
  if (!file) return;
  let result;
  if (currentConversationType === "channel" && currentServerId) {
    const useServerProfileAvatar = confirm("Use this avatar only for the current server?\n\nOK = server profile avatar\nCancel = global avatar");
    result = useServerProfileAvatar
      ? await uploadServerProfileAvatar(file, currentServerId, username)
      : await uploadAvatarFile(file, username);
  } else {
    result = await uploadAvatarFile(file, username);
  }

  const { error } = result;
  if (error) {
    alert(error);
    return;
  }

  await loadMessages();
  renderMemberList();
  renderServerList();
}

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageMentionsUser(content, targetUsername) {
  const normalizedContent = String(content || "");
  if (/@(everyone|here)\b/i.test(normalizedContent)) return true;
  if (!targetUsername) return false;
  const mentionPattern = new RegExp(`@${escapeRegExp(targetUsername)}\\b`, "i");
  return mentionPattern.test(normalizedContent);
}

function getMessageSearchText(msg) {
  return normalizeSearchValue(`${msg?.username || ""} ${msg?.content || ""}`);
}

async function getCurrentServerMemberUsernames() {
  if (!currentServerId) return [];
  if (serverMembers.length > 0) {
    return serverMembers.map(m => m.username).filter(Boolean);
  }

  const { data, error } = await supabaseClient
    .from("server_members")
    .select("username")
    .eq("server_id", currentServerId);
  if (error) {
    console.error("❌ Failed to fetch server members for push:", error.message);
    return [];
  }
  return (data || []).map(row => row.username).filter(Boolean);
}

async function getMentionCandidates() {
  if (currentConversationType === "dm") {
    const activeDm = directConversations.find((conversation) => conversation.id === currentDmConversationId);
    return activeDm?.otherUsername
      ? [{ username: activeDm.otherUsername, role: "Direct Message" }]
      : [];
  }

  if (!currentServerId) return [];

  if (serverMembers.length > 0) {
    return serverMembers
      .filter(member => member?.username)
      .map(member => ({
        username: getDisplayName(member),
        role: member.role || "Member"
      }));
  }

  const { data, error } = await supabaseClient
    .from("server_members")
    .select("username, role")
    .eq("server_id", currentServerId)
    .order("sort_order", { ascending: true })
    .order("username", { ascending: true });
  if (error) {
    console.error("❌ Failed to load mention candidates:", error.message);
    return [];
  }

  return (data || [])
    .filter(member => member?.username)
    .map(member => ({
      username: getDisplayName(member),
      role: member.role || "Member"
    }));
}

async function sendPushToUsers(targetUsernames, payload) {
  const uniqueUsers = [...new Set((targetUsernames || []).filter(Boolean))]
    .filter(name => String(name).toLowerCase() !== String(username || "").toLowerCase());
  if (uniqueUsers.length === 0) return;

  const { data: subs, error } = await supabaseClient
    .from("push_subscriptions")
    .select("username, subscription")
    .in("username", uniqueUsers);
  if (error) {
    console.error("❌ Failed to load push subscriptions:", error.message);
    return;
  }

  await Promise.all((subs || []).map(async (sub) => {
    try {
      await invokeSendPush({
        ...payload,
        subscription: sub.subscription,
        url: window.location.pathname + window.location.search
      });
    } catch (pushError) {
      console.error("Push failed:", pushError);
    }
  }));
}

function canViewMembers() {
  return ["Manager", "Admin", "SysManager", "SysAdmin"].includes(currentRole)
    || ["SysManager", "SysAdmin"].includes(currentSystemRole);
}

function canMentionEveryone() {
  return currentServerSettings.allow_everyone_mentions
    || ["Admin", "SysManager", "SysAdmin"].includes(currentRole)
    || ["SysManager", "SysAdmin"].includes(currentSystemRole)
    || userPermissions.manage_roles;
}

function getEffectiveServerSettings(serverId = currentServerId) {
  if (!serverId) return { ...DEFAULT_SERVER_SETTINGS };
  return {
    ...DEFAULT_SERVER_SETTINGS,
    ...(serverSettingsCache.get(serverId) || {})
  };
}

function getEffectiveServerWordFilters(serverId = currentServerId) {
  if (!serverId) return [];
  return [...(serverWordFiltersCache.get(serverId) || [])];
}

function canManageServerOptions(serverId = currentServerId) {
  if (!serverId) return false;
  const server = servers.find((entry) => entry.id === serverId);
  return currentSystemRole === "SysAdmin" || server?.owner_username === username;
}

function canUseRestrictedCustomEmojis() {
  return currentSystemRole === "SysAdmin" || isServerOwner() || userPermissions.manage_roles;
}

function canPostImagesInChannel() {
  // Only Managers, Admins, and SysAdmins (incl. SysManagers) may post images.
  return ["Manager", "Admin", "SysManager", "SysAdmin"].includes(currentRole)
    || ["SysManager", "SysAdmin"].includes(currentSystemRole);
}

let currentServerOptionsTargetId = null;

async function loadServerSettings(serverId = currentServerId, { force = false } = {}) {
  if (!serverId) {
    currentServerSettings = { ...DEFAULT_SERVER_SETTINGS };
    currentServerWordFilters = [];
    return currentServerSettings;
  }

  if (!force && serverSettingsCache.has(serverId)) {
    currentServerSettings = getEffectiveServerSettings(serverId);
    currentServerWordFilters = getEffectiveServerWordFilters(serverId);
    return currentServerSettings;
  }

  const [{ data: settingsRow, error: settingsError }, { data: filterRows, error: filtersError }] = await Promise.all([
    supabaseClient
      .from("server_settings")
      .select("bad_word_filter_enabled, admin_only_custom_emojis, allow_plaintext_links, allow_everyone_mentions")
      .eq("server_id", serverId)
      .maybeSingle(),
    supabaseClient
      .from("server_word_filters")
      .select("word")
      .eq("server_id", serverId)
      .eq("is_active", true)
      .order("word", { ascending: true })
  ]);

  if (settingsError) {
    console.warn("⚠️ Failed to load server settings:", settingsError.message);
  }
  if (filtersError) {
    console.warn("⚠️ Failed to load server word filters:", filtersError.message);
  }

  const resolvedSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    ...(settingsRow || {})
  };
  const resolvedWords = (filterRows || [])
    .map((row) => String(row.word || "").trim().toLowerCase())
    .filter(Boolean);

  serverSettingsCache.set(serverId, resolvedSettings);
  serverWordFiltersCache.set(serverId, resolvedWords);
  currentServerSettings = resolvedSettings;
  currentServerWordFilters = resolvedWords;
  return resolvedSettings;
}

function normalizeFilterToken(value) {
  return String(value || "")
    .toLowerCase()
    .split("")
    .map((char) => FILTER_CHAR_MAP[char] || char)
    .join("")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1");
}

function getFilterSkeleton(value) {
  return normalizeFilterToken(value).replace(/[aeiou]/g, "");
}

function getDamerauLevenshteinDistance(a, b) {
  const source = normalizeFilterToken(a);
  const target = normalizeFilterToken(b);
  const sourceLength = source.length;
  const targetLength = target.length;

  if (!sourceLength) return targetLength;
  if (!targetLength) return sourceLength;

  const matrix = Array.from({ length: sourceLength + 1 }, () => new Array(targetLength + 1).fill(0));
  for (let i = 0; i <= sourceLength; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= targetLength; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= sourceLength; i += 1) {
    for (let j = 1; j <= targetLength; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );

      if (
        i > 1
        && j > 1
        && source[i - 1] === target[j - 2]
        && source[i - 2] === target[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }

  return matrix[sourceLength][targetLength];
}

function tokenMatchesFilteredWord(token, filteredWord) {
  const normalizedToken = normalizeFilterToken(token);
  const normalizedWord = normalizeFilterToken(filteredWord);
  if (!normalizedToken || !normalizedWord) return false;

  // Exact (post-leetspeak) match always counts.
  if (normalizedToken === normalizedWord) return true;

  // Short filter words must match exactly. Otherwise innocent words like
  // "hello" would match the filter "hell" via Damerau-Levenshtein distance 1
  // or via the vowel-stripped skeleton ("hll" === "hll").
  if (normalizedWord.length < 5) return false;

  // Limit length drift so unrelated longer words don't fuzzy-match.
  const lengthDelta = Math.abs(normalizedToken.length - normalizedWord.length);
  if (lengthDelta > 1) return false;

  // Vowel-stripped skeleton match (catches "fck" vs "fuck") only when the
  // lengths are close, to avoid the "hell"/"hello" false positive.
  const tokenSkeleton = getFilterSkeleton(normalizedToken);
  const wordSkeleton = getFilterSkeleton(normalizedWord);
  if (tokenSkeleton && tokenSkeleton === wordSkeleton && lengthDelta <= 1) {
    return true;
  }

  const distance = getDamerauLevenshteinDistance(normalizedToken, normalizedWord);
  const maxDistance = normalizedWord.length >= 8 ? 2 : 1;
  return distance <= maxDistance;
}

function getMentionReadStorageKey() {
  return `serverMentionReadAt:${username || "guest"}`;
}

function getServerCheckpointKey() {
  return `serverCheckpoint:${username || "guest"}`;
}

function readMentionReadMap() {
  try {
    return JSON.parse(localStorage.getItem(getMentionReadStorageKey()) || "{}");
  } catch {
    return {};
  }
}

function writeMentionReadMap(map) {
  localStorage.setItem(getMentionReadStorageKey(), JSON.stringify(map));
}

function readServerCheckpointMap() {
  try {
    return JSON.parse(localStorage.getItem(getServerCheckpointKey()) || "{}");
  } catch {
    return {};
  }
}

function writeServerCheckpointMap(map) {
  localStorage.setItem(getServerCheckpointKey(), JSON.stringify(map));
}

function markServerMentionsRead(serverId) {
  if (!serverId) return;
  const readMap = readMentionReadMap();
  readMap[serverId] = new Date().toISOString();
  writeMentionReadMap(readMap);
  unreadMentionCounts.set(serverId, 0);
  renderServerList();
}

// In script.js, find setServerCheckpoint
function setServerCheckpoint(serverId, messageId = null) {
  if (!serverId) return;
  const checkpointMap = readServerCheckpointMap();

  // Get current max ID if not provided (e.g., when scrolling)
  let currentMaxId = messageId;
  if (!currentMaxId && messagesMap.size > 0) {
    // Find the highest ID in the current view
    const ids = Array.from(messagesMap.keys());
    currentMaxId = Math.max(...ids);
  }

  checkpointMap[serverId] = {
    lastViewed: new Date().toISOString(),
    lastMessageId: currentMaxId // <--- NEW: Track ID
  };
  writeServerCheckpointMap(checkpointMap);
}

function getServerCheckpoint(serverId) {
  if (!serverId) return null;
  const checkpointMap = readServerCheckpointMap();
  return checkpointMap[serverId] || null;
}

function getServerMentionCount(serverId) {
  return unreadMentionCounts.get(serverId) || 0;
}

function isServerOwner() {
  if (!currentServerId || !username) return false;
  const server = servers.find(s => s.id === currentServerId);
  return server?.owner_username === username;
}

async function loadChannelServerMap(serverIds = []) {
  const ids = (serverIds || []).filter(Boolean);
  if (ids.length === 0) return;

  const { data, error } = await supabaseClient
    .from("channels")
    .select("id, server_id")
    .in("server_id", ids);
  if (error) {
    console.warn("⚠️ Failed to load channel/server map:", error.message);
    return;
  }

  (data || []).forEach(row => {
    channelServerMap.set(Number(row.id), row.server_id);
  });
}

async function refreshUnreadMentionCounts() {
  if (!username || servers.length === 0) return;

  const serverIds = servers.map(server => server.id).filter(Boolean);
  await loadChannelServerMap(serverIds);

  const readMap = readMentionReadMap();
  const checkpointMap = readServerCheckpointMap();
  unreadMentionCounts.clear();

  await Promise.all(serverIds.map(async (serverId) => {
    const channelIds = [...channelServerMap.entries()]
      .filter(([, mappedServerId]) => mappedServerId === serverId)
      .map(([channelId]) => channelId);
    if (channelIds.length === 0) {
      unreadMentionCounts.set(serverId, 0);
      return;
    }

    // 1. Get the checkpoint data
    const checkpoint = checkpointMap[serverId];
    const lastViewTime = checkpoint?.lastViewed;
    const lastMessageId = checkpoint?.lastMessageId; // <--- NEW: Check ID first

    let query = supabaseClient
      .from("messages")
      .select("username, content, channel_id, inserted_at")
      .in("channel_id", channelIds)
      .neq("username", username)
      .order("inserted_at", { ascending: false })
      .limit(200);

    // 2. Apply the filter: Prefer ID, fallback to Time
    if (lastMessageId && lastMessageId > 0) {
      // Filter strictly by ID: Only count messages newer than the last one we saw
      query = query.gt("id", lastMessageId);
    } else if (lastViewTime) {
      // Fallback to timestamp if no ID is recorded
      query = query.gt("inserted_at", lastViewTime);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("⚠️ Failed to load unread mentions for server:", serverId, error.message);
      unreadMentionCounts.set(serverId, 0);
      return;
    }

    const count = (data || []).filter(msg => messageMentionsUser(msg.content, username)).length;
    unreadMentionCounts.set(serverId, count);
  }));

  renderServerList();
}

function subscribeToGlobalMentions() {
  if (globalMentionSubscription) {
    try { globalMentionSubscription.unsubscribe(); } catch {}
    globalMentionSubscription = null;
  }
  if (!username) return;

  globalMentionSubscription = supabaseClient
    .channel(`global-mentions-${username}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        const message = payload.new;
        if (!message || getDisplayName(message) === username) return;
        if (!messageMentionsUser(message.content, username)) return;

        let serverId = channelServerMap.get(Number(message.channel_id));
        if (!serverId) {
          await loadChannelServerMap(servers.map(server => server.id));
          serverId = channelServerMap.get(Number(message.channel_id));
        }
        if (!serverId) return;

        if (serverId === currentServerId && Number(message.channel_id) === Number(currentChannelId)) {
          await notifyMentionClientSide(message, serverId);
          markServerMentionsRead(serverId);
          return;
        }

        unreadMentionCounts.set(serverId, (unreadMentionCounts.get(serverId) || 0) + 1);
        renderServerList();
        await notifyMentionClientSide(message, serverId);
      }
    )
    .subscribe();
}

function stopMemberRealtime() {
  if (memberRealtimeSubscription) {
    try { memberRealtimeSubscription.unsubscribe(); } catch {}
    memberRealtimeSubscription = null;
  }
}

function setMemberListVisibility() {
  const memberList = document.getElementById("memberList");
  const memberToggle = document.getElementById("memberListToggle");
  if (memberToggle) memberToggle.style.display = canViewMembers() ? "inline-flex" : "none";
  if (!memberList) return;
  if (!canViewMembers()) {
    stopMemberRealtime();
    memberList.classList.remove("open");
    memberList.style.display = "none";
    const content = document.getElementById("memberListContent");
    if (content) content.innerHTML = "";
  } else if (window.innerWidth > 768) {
    memberList.style.display = "flex";
  } else {
    memberList.style.display = "";
  }
}

function setSearchInputVisibility(inputEl, visible) {
  if (!inputEl) return;
  inputEl.classList.toggle("hidden", !visible);
  if (visible) {
    requestAnimationFrame(() => inputEl.focus());
  } else {
    inputEl.value = "";
    if (inputEl === messageSearchInput) {
      messageSearchTerm = "";
      applyMessageSearchFilter();
    } else if (inputEl === memberSearchInput) {
      memberSearchTerm = "";
      renderMemberList();
    }
  }
}

function wireSearchToggle(toggleEl, inputEl) {
  if (!toggleEl || !inputEl) return;

  toggleEl.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextVisible = inputEl.classList.contains("hidden");
    setSearchInputVisibility(inputEl, nextVisible);
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchInputVisibility(inputEl, false);
    }
  });
}

function hideMentionSuggestions() {
  if (!mentionSuggestionsEl) return;
  mentionSuggestionsEl.style.display = "none";
  mentionSuggestionsEl.innerHTML = "";
  mentionSuggestionItems = [];
  mentionSelectedIndex = 0;
  activeSuggestionMode = null;
}

function getMentionContext() {
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
  if (!match) return null;
  return {
    query: match[2] || "",
    start: cursor - match[2].length - 1,
    end: cursor
  };
}

function getEmojiContext() {
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s):([a-zA-Z0-9_-]*)$/);
  if (!match) return null;
  return {
    query: match[2] || "",
    start: cursor - match[2].length - 1,
    end: cursor
  };
}

function renderMentionSuggestions(items) {
  if (!mentionSuggestionsEl) return;
  if (!items.length) {
    hideMentionSuggestions();
    return;
  }

  mentionSuggestionItems = items;
  mentionSelectedIndex = Math.min(mentionSelectedIndex, items.length - 1);
  mentionSuggestionsEl.innerHTML = "";

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const buttonEl = document.createElement("button");
    buttonEl.type = "button";
    buttonEl.className = `mention-suggestion-item${index === mentionSelectedIndex ? " active" : ""}`;

    let previewHtml = "";

    if (item.kind === "command") {
      // Style for commands: Bold label, grey description
      buttonEl.innerHTML = `
        <div class="mention-suggestion-main">
          <span style="font-weight: 700; color: #fff;">${escapeHTML(item.label)}</span>
        </div>
        <div class="mention-suggestion-meta" style="color: #949ba4;">${escapeHTML(item.meta || "")}</div>
      `;
    } else if (item.kind === "channel") {
      previewHtml = `<span style="font-size:18px; margin-right:8px; color:#b9bbbe;">#</span>`;
      buttonEl.innerHTML = `
        <div class="mention-suggestion-main">
          ${previewHtml}
          ${escapeHTML(item.label)}
        </div>
        <div class="mention-suggestion-meta">${escapeHTML(item.meta || "")}</div>
      `;
    } else if (item.kind === "emoji") {
      previewHtml = renderEmojiSuggestionPreview(item);
      buttonEl.innerHTML = `
        <div class="mention-suggestion-main">
          ${previewHtml}
          ${escapeHTML(item.label)}
        </div>
        <div class="mention-suggestion-meta">${escapeHTML(item.meta || "")}</div>
      `;
    } else {
      // Standard user mention
      buttonEl.innerHTML = `
        <div class="mention-suggestion-main">
          ${escapeHTML(item.label)}
        </div>
        <div class="mention-suggestion-meta">${escapeHTML(item.meta || "")}</div>
      `;
    }

    buttonEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyMentionSuggestion(item);
    });
    fragment.appendChild(buttonEl);
  });

  mentionSuggestionsEl.appendChild(fragment);
  mentionSuggestionsEl.style.display = "block";
  const inputRect = input.getBoundingClientRect();
  const popupHeight = mentionSuggestionsEl.offsetHeight || 0;
  const maxWidth = Math.min(420, window.innerWidth - 24);
  const left = Math.min(inputRect.left, window.innerWidth - maxWidth - 12);
  const top = Math.max(12, inputRect.top - popupHeight - 8);
  mentionSuggestionsEl.style.left = `${Math.max(12, left)}px`;
  mentionSuggestionsEl.style.top = `${top}px`;
  mentionSuggestionsEl.style.width = `${Math.min(inputRect.width, maxWidth)}px`;
  mentionSuggestionsEl.style.transform = "none";
}

async function updateMentionSuggestions() {
  const context = getMentionContext();
  const channelContext = getChannelContext();
  const emojiContext = getEmojiContext();

  // --- 1. SLASH COMMAND HANDLING (NEW) ---
  // Check if we are at the start of the input or after whitespace with a '/'
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  const slashMatch = beforeCursor.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);

  if (slashMatch) {
    activeSuggestionMode = "command";
    mentionSelectedIndex = 0;
    const query = slashMatch[2].toLowerCase();

    // Define your commands here
    const commands = [
      { label: "/gif", value: "gif", description: "Search for a GIF", insert: "/gif " },
/*      { label: "/help", value: "help", description: "Show available commands", insert: "/help " },
      { label: "/me", value: "me", description: "Display an action", insert: "/me " },
      { label: "/clear", value: "clear", description: "Clear chat locally", insert: "/clear " }*/
    ];

    // Filter commands based on query
    const filtered = commands
      .filter(cmd => !query || cmd.value.startsWith(query) || cmd.label.startsWith(query))
      .slice(0, 8);

    if (filtered.length > 0) {
      mentionSuggestionItems = filtered.map(cmd => ({
        kind: "command",
        value: cmd.value,
        label: cmd.label,
        meta: cmd.description,
        insertText: cmd.insert
      }));
      renderMentionSuggestions(mentionSuggestionItems);
      return;
    }
  }

  // --- 2. CHANNEL HANDLING (Existing Logic) ---
  if (channelContext) {
    activeSuggestionMode = "channel";
    const normalizedQuery = normalizeSearchValue(channelContext.query);
    const serverChannels = channels.filter(ch => ch.server_id === currentServerId);

    const channelItems = serverChannels
      .filter(ch => !normalizedQuery || String(ch.name).toLowerCase().includes(normalizedQuery))
      .slice(0, 8)
      .map(ch => ({
        kind: "channel",
        value: ch.name,
        label: `#${ch.name}`,
        meta: "Channel",
        id: ch.id
      }));

    renderMentionSuggestions(channelItems);
    return;
  }

  // --- 3. EMOJI HANDLING (Existing Logic) ---
  if (emojiContext) {
    activeSuggestionMode = "emoji";
    const normalizedQuery = normalizeSearchValue(emojiContext.query);
    const items = getEmojiSuggestionItems(normalizedQuery);
    renderMentionSuggestions(items);
    return;
  }

  // --- 4. MENTION HANDLING (Existing Logic) ---
  if (context) {
    activeSuggestionMode = "mention";
    const mentionCandidates = await getMentionCandidates();
    const normalizedQuery = normalizeSearchValue(context.query);

    const baseItems = canMentionEveryone()
      ? [
          { kind: "mention", value: "everyone", label: "@everyone", meta: "Notify all server members" },
          { kind: "mention", value: "here", label: "@here", meta: "Notify online members" }
        ]
      : [];

    const userItems = mentionCandidates
      .filter(candidate => !normalizedQuery || String(candidate.username).toLowerCase().includes(normalizedQuery))
      .map(candidate => ({
        kind: "mention",
        value: candidate.username,
        label: `@${candidate.username}`,
        meta: candidate.role || "Member"
      }));

    const allItems = [...baseItems, ...userItems];
    const seen = new Set();
    const uniqueItems = allItems.filter(item => {
      const key = item.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);

    renderMentionSuggestions(uniqueItems);
    return;
  }

  hideMentionSuggestions();
}

function applyMentionSuggestion(itemOrValue) {
  const item = typeof itemOrValue === "object" ? itemOrValue : { kind: activeSuggestionMode || "mention", value: itemOrValue };

  const isCommand = item.kind === "command";
  const isEmoji = item.kind === "emoji";
  const isChannel = item.kind === "channel";

  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);

  let start = cursor;
  let replacement = "";

  if (isCommand) {
    // Find the start of the slash command: look for space or start of string before the slash
    // Regex: (^|\s)\/[a-zA-Z0-9_-]*$
    const match = beforeCursor.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);

    if (match) {
      // match.index is where the match started (either 0 or the space before /)
      // We want to replace starting from the '/' character, not the space.
      // The '/' is at match.index + (match[1].length)
      start = match.index + match[1].length; 
      replacement = item.insertText; // e.g., "/gif "
    } else {
      // Fallback if regex fails (shouldn't happen if triggered correctly)
      return;
    }
  } else if (isChannel) {
    const ctx = getChannelContext();
    if (!ctx) return;
    start = ctx.start;
    replacement = `#${item.value} `;
  } else if (isEmoji) {
    const ctx = getEmojiContext();
    if (!ctx) return;
    start = ctx.start;
    replacement = item.insertText;
  } else {
    // Standard mention
    const ctx = getMentionContext();
    if (!ctx) return;
    start = ctx.start;
    replacement = `${item.label} `;
  }

  const before = input.value.slice(0, start);
  const after = input.value.slice(cursor);

  input.value = `${before}${replacement}${after}`;

  const nextCursor = before.length + replacement.length;
  input.focus();
  input.setSelectionRange(nextCursor, nextCursor);

  hideMentionSuggestions();
}

function applyMessageSearchFilter() {
  if (!messagesList) return;

  const term = normalizeSearchValue(messageSearchTerm);
  let visibleCount = 0;

  messagesMap.forEach((li, id) => {
    const msg = messageDataMap.get(id);
    const matches = !term || getMessageSearchText(msg).includes(term);
    li.style.display = matches ? "" : "none";
    if (matches) visibleCount += 1;
  });

  const existingEmpty = document.getElementById("messageSearchEmpty");
  if (existingEmpty) existingEmpty.remove();

  if (term && messagesMap.size > 0 && visibleCount === 0) {
    const empty = document.createElement("li");
    empty.id = "messageSearchEmpty";
    empty.className = "search-empty-state";
    empty.textContent = "No messages match your search.";
    messagesList.appendChild(empty);
  }
}

const namePrompt = document.getElementById("namePrompt");
const nameInput = document.getElementById("nameInput");
const saveNameBtn = document.getElementById("saveNameButton");

// ------------------------ Supabase Setup ------------------------
const supabaseUrl = "https://qjajtkdchvapthnidtwj.supabase.co";
const supabaseKey = "sb_publishable_1HWGEhoX-b4jj05hDKsGYw_H004LgVz"; 
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

async function invokeSendPush(payload) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const headers = {
    "Content-Type": "application/json",
    apikey: supabaseKey
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  return fetch(`${supabaseUrl}/functions/v1/send-push`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

// ------------------------ User data ------------------------
let username = localStorage.getItem("chatUsername") || "";
let currentRole = normalizeServerRole(localStorage.getItem("chatRole") || "User");
let currentSystemRole = localStorage.getItem("chatSysAdmin") === "true"
  ? "SysAdmin"
  : localStorage.getItem("chatSysManager") === "true"
    ? "SysManager"
    : "User";
let userPermissions = {};

function getDisplayName(user) {
  if (!user) return "Unknown User";

  return (
    user.display_name ||
    user.profile_display_name ||
    user.users?.display_name ||
    user.username ||
    "Unknown User"
  );
}



function loadUserPermissions(roleName, customPerms = null) {
  const name = (roleName || "user").toLowerCase();
  
  // 1. Define Base Permissions for standard roles
  let basePerms = {
    read_messages: true, 
    send_messages: true, 
    delete_messages: false,
    rename_channels: false, 
    create_channels: false, 
    manage_roles: false,
    mute_users: false, 
    manage_messages: false, 
    manage_reports: false,
    send_gifs: false, 
    send_links: false, 
    send_attachments: false,
    mention_everyone: false, 
    bypass_word_filter: false,
    create_invites: false, 
    use_custom_emojis: false
  };

  // Assign base permissions based on role hierarchy
  switch (name) {
    case "sysadmin":
    case "admin":
      basePerms = {
        read_messages: true, send_messages: true, delete_messages: true,
        rename_channels: true, create_channels: true, manage_roles: true,
        mute_users: true, manage_messages: true, manage_reports: true,
        send_gifs: true, send_links: true, send_attachments: true,
        mention_everyone: true, bypass_word_filter: true,
        create_invites: true, use_custom_emojis: true
      };
      break;
    case "sysmanager":
      basePerms = {
        read_messages: true, send_messages: true, delete_messages: true,
        rename_channels: true, create_channels: true, manage_roles: true,
        mute_users: true, manage_messages: true, manage_reports: true,
        send_gifs: true, send_links: true, send_attachments: true,
        mention_everyone: true, bypass_word_filter: true,
        create_invites: true, use_custom_emojis: true
      };
      break;
    case "teacher":
    case "moderator":
    case "mod":
    case "manager":
      basePerms = {
        read_messages: true, send_messages: true, delete_messages: true,
        rename_channels: false, create_channels: false, manage_roles: false,
        mute_users: true, manage_messages: true, manage_reports: true,
        send_gifs: true, send_links: true, send_attachments: true,
        mention_everyone: false, bypass_word_filter: false,
        create_invites: true, use_custom_emojis: true
      };
      break;
    // Default "user" keeps the basePerms defined at the top
  }

  // 2. CRITICAL: Merge Custom Permissions
  // If customPerms exists, it OVERRIDES the base permissions.
  // We iterate through customPerms and only update keys that are explicitly set (true/false).
  if (customPerms && typeof customPerms === "object") {
    Object.entries(customPerms).forEach(([key, value]) => {
      // Only override if the value is explicitly true or false (not undefined/null)
      if (value !== undefined && value !== null) {
        basePerms[key] = value;
      }
    });
  }

  // Update global state
  userPermissions = basePerms;
}
const messagesMap = new Map();
const reactionMessageMap = new Map(); // reaction id → message id (for DELETE realtime lookup)
const reactionIdsByMessage = new Map(); // message id -> reaction ids currently cached
const reactionDetailsMap = new Map(); // reaction id -> reaction row snapshot
const reactionSummaryByMessage = new Map(); // message id -> emoji summary map
const pendingReactionInsertMap = new Map(); // messageId:emoji:username -> temp reaction id
let typingTimeout = null;

// ------------------------ Name Lock ------------------------
function updateMessageLock() {
  const hasName = nameInput.value.trim().length > 0;
  input.disabled = !hasName;
  button.disabled = !hasName;
}
nameInput.addEventListener("input", updateMessageLock);
updateMessageLock();

if (messageSearchInput) {
  messageSearchInput.addEventListener("input", () => {
    messageSearchTerm = messageSearchInput.value || "";
    applyMessageSearchFilter();
  });
}

if (memberSearchInput) {
  memberSearchInput.addEventListener("input", () => {
    memberSearchTerm = memberSearchInput.value || "";
    renderMemberList();
  });
}

wireSearchToggle(messageSearchToggle, messageSearchInput);
wireSearchToggle(memberSearchToggle, memberSearchInput);


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
        .limit(200)
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
    .order("inserted_at", { ascending: true })
    .limit(100);

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
        await handleRealtimeDmMessage(payload.new || payload.old, payload.eventType);
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
    .limit(1)
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
    .order("inserted_at", { ascending: true })
    .limit(50); // Limit initial load for speed

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

   // --- FIXED: NON-BLOCKING IP LOGGING ---
  let ip = "unknown";

  // 1. Try to fetch IP asynchronously WITHOUT blocking the message send
  fetch("https://api.ipify.org?format=json", { 
    signal: AbortSignal.timeout(2000) // Hard 2-second timeout
  })
  .then(res => res.ok ? res.json() : null)
  .then(data => {
    if (data?.ip) {
      ip = data.ip;
      // Update DB in the background (fire and forget)
      supabaseClient
        .from("users")
        .update({ ip: ip })
        .eq("username", username)
        .then(() => console.log("✅ IP updated to:", ip))
        .catch(err => console.warn("⚠️ IP update failed:", err.message));
    }
  })
  .catch(err => {
    // Silently fail if IP fetch fails; message still sends
    console.warn("⚠️ Could not fetch IP:", err.message);
  });

  // 2. Proceed with message sending immediately (don't wait for IP)
  // The 'ip' variable might still be "unknown" here, which is fine.
  // The background fetch will update the DB later.
  // -----------------------------------------------------------

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

  const cleanContent = msg.content.replaceAll(NO_EMBED_PHRASE, "");
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
    // Handle File Uploads
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

    // --- CRITICAL: FORCE @ MENTION STYLING (BLUE) ---
    // This regex finds @username patterns and wraps them in the styled span
    // It runs AFTER formatMessageContent to ensure we catch raw text mentions
    formatted = formatted.replace(/@([a-zA-Z0-9_]+)/g, (match, name) => {
      const isMine = name.toLowerCase() === (username || "").toLowerCase();
      const mentionClass = isMine ? "mention mine" : "mention";
      // We escape the name to prevent XSS, but keep the structure
      return `<span class="${mentionClass}"><span class="mention-mark">@</span><span class="mention-name">${escapeHTML(name)}</span></span>`;
    });

    // Handle Code Blocks (Admin only usually, but good to check)
    if (!formatted.startsWith("<pre class=\"code-block\">")) {
      formatted = replaceCustomEmojiShortcodes(formatted);
    }

    contentDiv.innerHTML = formatted;

    // Apply long message class if content is very long
    if (cleanContent.length > 1000) {
      contentDiv.classList.add("long-message");
    }

    // Emoji-only message styling
    if (isEmojiOnlyMessage(cleanContent)) {
      contentDiv.classList.add("emoji-only-message");
    }

    // --- LINK PREVIEWS & GIFS (Post-render) ---
    const urlMatch = cleanContent.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      const gifUrl = resolveGifUrl(url);

      const stripUrlFromBody = () => {
        const escapedUrl = escapeHTML(url);
        let html = contentDiv.innerHTML || "";
        if (html.includes(escapedUrl)) {
          html = html.split(escapedUrl).join("");
        } else if (html.includes(url)) {
          html = html.split(url).join("");
        }
        contentDiv.innerHTML = html.trim();
      };

      const appendInlineGif = (mediaUrl) => {
        stripUrlFromBody();
        contentDiv.appendChild(createInlineGifElement(mediaUrl));
      };

      const appendLinkPreview = () => {
        if (cleanContent.includes(NO_EMBED_PHRASE)) return;
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
        appendInlineGif(gifUrl);
      } else if (isLikelyGifPageUrl(url) && !cleanContent.includes(NO_EMBED_PHRASE)) {
        const placeholder = document.createElement("div");
        placeholder.className = "gif-resolving";
        contentDiv.appendChild(placeholder);
        setTimeout(async () => {
          const resolved = await resolveGifPageUrlAsync(url);
          placeholder.remove();
          if (resolved) {
            appendInlineGif(resolved);
          } else {
            appendLinkPreview();
          }
        }, 0);
      } else {
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
  if (newMsg.channel_id !== currentChannelId) return;
  if (!newMsg) return;

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

// Secret sign-out shortcut
document.addEventListener("keydown", async e => {
  if(e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase()==="t"){
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

    alert(
      `👤 User: ${author}\n` +
      `🎭 System Role: ${data.system_role || "User"}\n` +
      serverStatusLine +
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
  const roleName = prompt("Enter role name to give:");
  if (!roleName) return;

  try {
    // First, try to find existing role
    let { data: existingRole, error: findError } = await supabaseClient
      .from("server_roles")
      .select("id")
      .eq("server_id", currentServerId)
      .eq("name", roleName)
      .single();

    let roleId;
    
    if (findError && findError.code === 'PGRST116') {
      // Role doesn't exist, create it
      const { data: newRole, error: createError } = await supabaseClient
        .from("server_roles")
        .insert({
          server_id: currentServerId,
          name: roleName,
          display_name: roleName,
          color: "#5865f2",
          permissions: {}
        })
        .select("id")
        .single();

      if (createError) throw createError;
      roleId = newRole.id;
    } else if (findError) {
      throw findError;
    } else {
      roleId = existingRole.id;
    }

    // Now assign the role to the user
    const { error: assignError } = await supabaseClient
      .from("server_members")
      .update({ primary_role_id: roleId })
      .eq("server_id", currentServerId)
      .eq("username", targetUser);

    if (assignError) throw assignError;

    alert(`✅ Role "${roleName}" assigned to ${targetUser} in this server.`);
    await loadServerMembers();
    await refreshServerRole();
  } catch (error) {
    alert("❌ Failed to assign role: " + error.message);
    console.error("giveCustomRole error:", error);
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

      if (!error) {
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

  if (target) {
    await switchServer(target.id, false);
  } else {
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
}

function renderServerList() {
  const serverList = document.getElementById("serverList");
  if (!serverList) return;
  if (_serverSortableInstance) {
    try { _serverSortableInstance.destroy(); } catch {}
    _serverSortableInstance = null;
  }
  serverList.innerHTML = "";

  servers.forEach(server => {
    const icon = document.createElement("div");
    icon.className = `server-icon ${server.id === currentServerId ? 'active' : ''}`;
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
      switchServer(server.id);
      if (window.innerWidth <= 768) closeServerSidebar();
    };

    serverList.appendChild(icon);
  });

  if (typeof Sortable !== "undefined") {
    const mobileDrag = isMobileContextMenuMode();
    _serverSortableInstance = Sortable.create(serverList, {
      animation: 150,
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
          <div class="member-name">${escapeHTML(displayName(m.username))}</div>
          ${ch ? `<div class="member-channel"># ${escapeHTML(ch.name)}</div>` : ""}
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
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "server_members",
      filter: `server_id=eq.${currentServerId}`
    }, async () => {
      console.log("🔄 server_members changed, reloading member list");
      await loadServerMembers();
    })
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "server_member_roles",
      filter: `server_id=eq.${currentServerId}`
    }, async () => {
      console.log("🔄 server_member_roles changed, reloading member list");
      await loadServerMembers();
    })
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "server_roles",
      filter: `server_id=eq.${currentServerId}`
    }, async () => {
      console.log("🔄 server_roles changed, reloading member list");
      await loadServerMembers();
    })
    .subscribe();

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
  // Check if user is SysAdmin
  if (currentSystemRole !== "SysAdmin") {
    return "❌ Only SysAdmins can create servers.";
  }

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

  // SysAdmin becomes the owner and admin
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
  // Only show for SysAdmins
  addBtn.style.display = currentSystemRole === "SysAdmin" ? "flex" : "none";

  addBtn.addEventListener("click", () => {
    if (currentSystemRole !== "SysAdmin") {
      alert("❌ Only SysAdmins can create servers.");
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
        .limit(1)
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
    if (currentConversationType === "channel") {
      await loadMessages();
    }

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
    } else {
      const { error } = await supabaseClient
        .from("server_roles")
        .update({ name, role: name, color, permissions })
        .eq("id", editingRoleId);
      if (error) throw error;
      const cached = serverRolesCache.find((r) => r.id === editingRoleId);
      if (cached) { cached.name = name; cached.role = name; cached.color = color; cached.permissions = permissions; }
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
  if (!user) return { google: false, github: false, discord: false, azure: false };

  // Supabase stores linked identities in user.identities
  const identities = user.identities || [];

  return {
    google: identities.some(id => id.provider === 'google'),
    github: identities.some(id => id.provider === 'github'),
    discord: identities.some(id => id.provider === 'discord'),
    azure: identities.some(id => id.provider === 'azure')
  };
}

async function unlinkOAuthIdentity(provider) {
  console.log(`🔄 Attempting to unlink ${provider}...`);

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
  //    (The previous `auth.admin.unlinkIdentity` requires a service role key
  //    and silently fails from a browser, which is why unlinking never worked.)
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
    azure: document.getElementById("linkAzureBtn")
   // spotify: document.getElementById("linkSpotifyBtn")
  };

  const providerNames = {
    google: "Google",
    github: "GitHub",
    discord: "Discord",
    azure: "Azure"
   // spotify: "Spotify"
  };

  const providerIcons = {
    google: "🔵",
    github: "🐙",
    discord: "💬",
    azure: "🐦"
    //spotify: "🎵"
  };

  Object.keys(buttons).forEach(provider => {
    const button = buttons[provider];
    if (!button) return;

    if (linked[provider]) {
      // Account is linked - show unlink option
      button.innerHTML = `<span style="margin-right: 8px;">${providerIcons[provider]}</span> ${providerNames[provider]} Linked! :) Unlink?`;
      button.style.background = "linear-gradient(135deg, #dc3545, #c82333)";
      button.onclick = async () => {
        if (confirm(`Are you sure you want to unlink your ${providerNames[provider]} account?`)) {
          await unlinkOAuthIdentity(provider);
        }
      };
    } else {
      // Account is not linked - show link option
      button.innerHTML = `<span style="margin-right: 8px;">${providerIcons[provider]}</span> Link ${providerNames[provider]} Account`;

      // Restore original gradient colors
      const originalGradients = {
        google: "linear-gradient(135deg, #4285f4, #34a853)",
        github: "linear-gradient(135deg, #24292e, #5865f2)",
        discord: "linear-gradient(135deg, #5865f2, #99aab5)",
        azure: "linear-gradient(135deg, #1da1f2, #14171a)"
      };
      button.style.background = originalGradients[provider];
      button.onclick = async () => await linkOAuthIdentity(provider);
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

// ======================== /gif SLASH COMMAND (FORCED POSITION FIX) ========================
(function setupGifSlashCommand() {
  const TENOR_API_KEY = "LIVDSRZULELA"; 
  const TENOR_LIMIT = 24;
  const DEBOUNCE_MS = 300;

  const inputEl = document.getElementById("messageInput");
  const controlsEl = document.getElementById("controls");

  if (!inputEl) {
    console.warn("[gif-picker] Input element missing.");
    return;
  }

  // 1. CREATE PICKER INSIDE BODY (Bypasses parent overflow:hidden)
  const picker = document.createElement("div");
  picker.id = "gifPicker";
  picker.className = "hidden";

  // FORCE STYLES IN-JS TO OVERRIDE CSS
  picker.style.position = "fixed"; 
  picker.style.zIndex = "9999999"; // Higher than everything
  picker.style.backgroundColor = "#2f3136";
  picker.style.border = "1px solid #40444b";
  picker.style.borderRadius = "8px";
  picker.style.boxShadow = "0 8px 32px rgba(0,0,0,0.5)";
  picker.style.width = "320px";
  picker.style.maxHeight = "360px";
  picker.style.overflowY = "auto";
  picker.style.display = "none"; // Start hidden
  picker.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))";
  picker.style.gap = "8px";
  picker.style.padding = "10px";
  picker.style.left = "0";
  picker.style.top = "0";

  // Prevent focus loss
  picker.addEventListener("mousedown", (e) => e.preventDefault());

  // Inject into BODY, not controlsEl
  document.body.appendChild(picker);

  const tenorCache = new Map();
  let searchTimer = null;
  let searchSeq = 0;

  const isOpen = () => picker.style.display !== "none";

  const open = (targetRect) => {
    picker.style.display = "grid"; // Force grid layout

    // Position it right above the input
    if (targetRect) {
      const bottom = window.innerHeight - targetRect.bottom;
      const left = targetRect.left;

      // Ensure it fits on screen
      const pickerHeight = 360;
      const spaceAbove = targetRect.top;

      if (spaceAbove > pickerHeight) {
        // Show above input
        picker.style.bottom = `${bottom + targetRect.height + 8}px`;
        picker.style.top = "auto";
        picker.style.left = `${left}px`;
      } else {
        // Show below input (if no space above)
        picker.style.top = `${targetRect.bottom + 8}px`;
        picker.style.bottom = "auto";
        picker.style.left = `${left}px`;
      }
    }
  };

  const close = () => {
    picker.style.display = "none";
    picker.innerHTML = "";
  };

  function setState(html, kind = "") {
    picker.innerHTML = `
      <div style="grid-column: 1/-1; padding: 8px; font-size: 12px; color: #949ba4; text-transform: uppercase; border-bottom: 1px solid #40444b; margin-bottom: 8px;">
        GIF Search <span style="float:right; opacity:0.6">Powered by Tenor</span>
      </div>
      <div class="gif-state ${kind}" style="padding: 20px; text-align: center; color: #dbdee1;">${html}</div>
    `;
  }

  function renderResults(results, query) {
    if (!results.length) {
      setState(`No results for "${query}".`);
      return;
    }

    // Clear header
    const header = document.createElement("div");
    header.style.gridColumn = "1/-1";
    header.style.padding = "8px";
    header.style.fontSize = "12px";
    header.style.color = "#949ba4";
    header.style.textTransform = "uppercase";
    header.style.borderBottom = "1px solid #40444b";
    header.style.marginBottom = "8px";
    header.innerHTML = `GIFs for "${query}" <span style="float:right; opacity:0.6">Powered by Tenor</span>`;
    picker.innerHTML = "";
    picker.appendChild(header);

    results.forEach((r) => {
      const m = (r.media && r.media[0]) || null;
      if (!m) return;
      const thumb = m.tinygif?.url || m.nanogif?.url || m.gif?.url;
      const full  = m.gif?.url || m.tinygif?.url;
      if (!thumb || !full) return;

      const item = document.createElement("div");
      item.className = "gif-item";
      item.style.cursor = "pointer";
      item.style.borderRadius = "8px";
      item.style.overflow = "hidden";
      item.style.position = "relative";
      item.style.aspectRatio = "1/1";
      item.style.background = "#202225";
      item.style.border = "2px solid transparent";
      item.style.transition = "border-color 0.12s, transform 0.12s";

      item.onmouseover = () => {
        item.style.borderColor = "#5865f2";
        item.style.transform = "translateY(-2px)";
      };
      item.onmouseout = () => {
        item.style.borderColor = "transparent";
        item.style.transform = "translateY(0)";
      };

      const img = document.createElement("img");
      img.src = thumb;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.display = "block";

      item.appendChild(img);
      item.addEventListener("click", () => sendGif(full));
      picker.appendChild(item);
    });
  }

  async function fetchTenor(query) {
    if (tenorCache.has(query)) return tenorCache.get(query);
    const url = `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}`
      + `&key=${TENOR_API_KEY}&limit=${TENOR_LIMIT}`
      + `&media_filter=minimal&contentfilter=high`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Tenor HTTP ${res.status}`);
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      tenorCache.set(query);
      return results;
    } catch (e) {
      console.error("[gif-picker] Fetch failed:", e);
      return [];
    }
  }

  async function sendGif(gifUrl) {
    close();
    inputEl.value = "";
    try {
      await sendMessage({ overrideContent: gifUrl, bypassLinkCheck: true });
    } catch (e) {
      console.error("[gif-picker] Failed to send GIF:", e);
    }
    inputEl.focus();
  }

  function handleInput() {
    const value = inputEl.value.trim();
  const match = value.match(/^\/gif(?:\s+(.*))?$/i);

  if (!match) {
    if (isOpen()) close();
    return;
  }

  // --- /gif permission gate (honors per-server "Send GIFs" role permission) ---
  const _legacyGifAllowed = ["Manager", "Admin", "SysManager", "SysAdmin"].includes(currentRole);
  if (!(userPermissions.send_gifs || _legacyGifAllowed)) {
    if (isOpen()) close();
    return;
  }
  // -----------------------------------------

  const query = (match[1] || "").trim();
  open(inputEl.getBoundingClientRect());

    if (!query) {
      setState("Type a search after <b>/gif</b> — e.g. <b>/gif cats</b>");
      return;
    }

    setState("Searching...");
    const seq = ++searchSeq;

    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (seq !== searchSeq) return;
      try {
        const results = await fetchTenor(query);
        if (seq !== searchSeq) return;
        if (isOpen()) renderResults(results, query);
      } catch (e) {
        if (seq !== searchSeq) return;
        if (isOpen()) setState("GIF search failed.", "error");
      }
    }, DEBOUNCE_MS);
  }

  // Keydown handler
  inputEl.addEventListener("keydown", (e) => {
    if (!isOpen()) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const first = picker.querySelector(".gif-item");
      if (first) first.click();
      else close();
    }
  }, true);

  inputEl.addEventListener("input", handleInput);

  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== inputEl && !picker.contains(document.activeElement)) {
        close();
      }
    }, 150);
  });

  document.addEventListener("mousedown", (e) => {
    if (!isOpen()) return;
    if (picker.contains(e.target) || e.target === inputEl) return;
    close();
  });

  console.log("✅ GIF Picker (Forced) Initialized!");
})();

// Add this helper near your other helper functions
async function markCurrentChannelAsRead() {
  if (!currentServerId || !currentChannelId) return;

  // If we have messages loaded, take the highest ID
  if (messagesMap.size > 0) {
    const maxId = Math.max(...Array.from(messagesMap.keys()));
    setServerCheckpoint(currentServerId, maxId);
    markServerMentionsRead(currentServerId); // Clears the badge
  }
}

// ================= EDGE FUNCTION PATCHES =================

async function censorContent(text, serverId = currentServerId) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("censor-message", {
      body: { text, serverId }
    });
    if (error) throw error;
    return data?.text || text;
  } catch (err) {
    console.warn("Censor fallback:", err);
    return text;
  }
}

async function fetchLinkPreviewEdge(url) {
  try {
    const res = await fetch(`${supabaseClient.supabaseUrl}/functions/v1/get-link-preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error("Preview failed");
    return await res.json();
  } catch (err) {
    console.warn("Preview error:", err);
    return null;
  }
}

async function resolveGifEdge(query) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("resolve-gif", {
      body: { query }
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn("GIF error:", err);
    return null;
  }
}

async function logIpEdge() {
  try {
    await supabaseClient.functions.invoke("log-ip", {
      body: { username }
    });
  } catch (err) {
    console.warn("IP log failed:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (typeof username !== "undefined") logIpEdge();
  }, 2000);
});

// ================= END PATCH =================

// --- GLOBAL VARIABLES FOR WEBRTC ---
let currentPeerConnections = new Map(); // Map: username -> RTCPeerConnection
let currentVoiceChannelId = null;
let localStream = null;
let voiceSignalingSub = null; // To track the subscription

// --- Voice participant state map: username -> {is_muted, is_deafened, is_admin_muted, is_admin_deafened}
let voiceParticipantState = new Map();
let voiceRoomSub = null; // realtime sub for voice_room_participants
let voiceOutputVolume = 1.0; // 0..1 — applied to all incoming audio elements
let selfDeafened = false;

function getVoiceParticipantBadges(state) {
  const badges = [];
  if (state.is_admin_muted) badges.push({ icon: '🔇', danger: true, title: 'Server Muted' });
  else if (state.is_muted) badges.push({ icon: '🎤', danger: false, title: 'Muted' });
  if (state.is_admin_deafened) badges.push({ icon: '🛑', danger: true, title: 'Server Deafened' });
  else if (state.is_deafened) badges.push({ icon: '🎧', danger: false, title: 'Deafened' });
  return badges;
}

function renderVoiceParticipant(usernameVal, state) {
  const grid = document.getElementById('voiceParticipantGrid');
  if (!grid) return;
  let el = grid.querySelector(`.voice-participant[data-username="${usernameVal}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'voice-participant';
    el.dataset.username = usernameVal;
    if (usernameVal === username) el.classList.add('is-self');

    const avatar = buildAvatarElement(usernameVal, 'voice-participant-avatar');
    const name = document.createElement('div');
    name.className = 'voice-participant-name';
    name.textContent = displayName(usernameVal);

    const badgeRow = document.createElement('div');
    badgeRow.className = 'voice-participant-badges';

    el.appendChild(avatar);
    el.appendChild(name);
    el.appendChild(badgeRow);
    grid.appendChild(el);

    // Right-click / long-press for admin actions
    el.addEventListener('contextmenu', (e) => {
      if (usernameVal === username) return; // can't admin-act on self via context menu
      e.preventDefault();
      openVoiceParticipantMenu(usernameVal, e.clientX, e.clientY);
    });
    let touchTimer = null;
    el.addEventListener('touchstart', (e) => {
      if (usernameVal === username) return;
      const touch = e.touches[0];
      touchTimer = setTimeout(() => {
        openVoiceParticipantMenu(usernameVal, touch.clientX, touch.clientY);
      }, 600);
    });
    el.addEventListener('touchend', () => { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } });
    el.addEventListener('touchmove', () => { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } });
  }

  // Refresh badges
  const badgeRow = el.querySelector('.voice-participant-badges');
  badgeRow.innerHTML = '';
  for (const b of getVoiceParticipantBadges(state || {})) {
    const span = document.createElement('span');
    span.className = 'vp-badge' + (b.danger ? ' danger' : '');
    span.textContent = b.icon;
    span.title = b.title;
    badgeRow.appendChild(span);
  }
}

function removeVoiceParticipant(usernameVal) {
  const grid = document.getElementById('voiceParticipantGrid');
  if (!grid) return;
  const el = grid.querySelector(`.voice-participant[data-username="${usernameVal}"]`);
  if (el) el.remove();
  voiceParticipantState.delete(usernameVal);
}

// Backwards-compatible alias used elsewhere in the file
function addParticipantToGrid(usernameVal) {
  const state = voiceParticipantState.get(usernameVal) || {};
  renderVoiceParticipant(usernameVal, state);
}

// --- SUBSCRIBE TO SIGNALING (FIXED ORDER) ---
function subscribeToVoiceSignaling(channelId) {
  if (voiceSignalingSub) {
    try { voiceSignalingSub.unsubscribe(); } catch {}
    voiceSignalingSub = null;
  }

  console.log(`📡 Subscribing to voice signaling for channel ${channelId}...`);

  voiceSignalingSub = supabaseClient
    .channel(`voice-signaling-${channelId}`)
    .on(
      "postgres_changes",
      { 
        event: "INSERT", 
        schema: "public", 
        table: "voice_signaling",
        filter: `channel_id=eq.${channelId}` 
      },
      async (payload) => {
        const data = payload.new;

        // Only process messages intended for me
        if (data.to_username !== username) return;

        const peerConn = currentPeerConnections.get(data.from_username);
        if (!peerConn) {
          console.warn("⚠️ Received signal from unknown user:", data.from_username);
          return;
        }

        try {
          if (data.sdp) {
            // Received SDP Offer or Answer
            const sdpObj = JSON.parse(data.sdp);
            console.log(`📩 Processing SDP from ${data.from_username}: ${sdpObj.type}`);

            await peerConn.setRemoteDescription(new RTCSessionDescription(sdpObj));

            if (sdpObj.type === 'offer') {
              // Create Answer
              const answer = await peerConn.createAnswer();
              await peerConn.setLocalDescription(answer);

              // Send Answer back
              await supabaseClient
                .from("voice_signaling")
                .insert({
                  channel_id: channelId,
                  from_username: username,
                  to_username: data.from_username,
                  sdp: JSON.stringify(answer)
                });
            }
          } else if (data.ice_candidate) {
            // Received ICE Candidate
            console.log(`📩 Received ICE candidate from ${data.from_username}`);
            await peerConn.addIceCandidate(new RTCIceCandidate(data.ice_candidate));
          }
        } catch (e) {
          console.error("❌ Error processing signal:", e);
        }
      }
    )
    .subscribe((status) => {
      console.log(`Realtime Status: ${status}`);
    });
}

// --- SUBSCRIBE TO VOICE ROOM PARTICIPANT CHANGES ---
function subscribeToVoiceRoom(channelId) {
  if (voiceRoomSub) {
    try { voiceRoomSub.unsubscribe(); } catch {}
    voiceRoomSub = null;
  }

  console.log(`📡 Subscribing to voice room participants for channel ${channelId}...`);

  voiceRoomSub = supabaseClient
    .channel(`voice-room-${channelId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "voice_room_participants",
        filter: `channel_id=eq.${channelId}`
      },
      async (payload) => {
        const p = payload.new;
        if (!p || !p.username) return;
        console.log(`🔊 voice room INSERT: ${p.username}`);
        voiceParticipantState.set(p.username, {
          is_muted: !!p.is_muted,
          is_deafened: !!p.is_deafened,
          is_admin_muted: !!p.is_admin_muted,
          is_admin_deafened: !!p.is_admin_deafened
        });
        renderVoiceParticipant(p.username, voiceParticipantState.get(p.username));

        // If a new user joined and we're already in the room, open a peer connection to them.
        if (p.username !== username && currentVoiceChannelId === channelId && !currentPeerConnections.has(p.username)) {
          try { await initiateConnection(p.username, channelId); }
          catch (e) { console.warn("⚠️ initiateConnection failed for", p.username, e); }
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "voice_room_participants",
        filter: `channel_id=eq.${channelId}`
      },
      (payload) => {
        const p = payload.new;
        if (!p || !p.username) return;
        const next = {
          is_muted: !!p.is_muted,
          is_deafened: !!p.is_deafened,
          is_admin_muted: !!p.is_admin_muted,
          is_admin_deafened: !!p.is_admin_deafened
        };
        voiceParticipantState.set(p.username, next);
        renderVoiceParticipant(p.username, next);

        // If admin-muted my own mic, force-mute locally and refresh the bar.
        if (p.username === username) {
          try { applyLocalMicState(); } catch {}
          try { applyLocalDeafenState(); } catch {}
          try { refreshVoiceControlButtons(); } catch {}
          try { updateSelfMuteBadge(); } catch {}
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "voice_room_participants",
        filter: `channel_id=eq.${channelId}`
      },
      (payload) => {
        const p = payload.old || {};
        if (!p.username) return;
        console.log(`👋 voice room DELETE: ${p.username}`);
        // Close peer connection if any
        const conn = currentPeerConnections.get(p.username);
        if (conn) {
          try { conn.close(); } catch {}
          currentPeerConnections.delete(p.username);
        }
        // Remove audio element
        const audioEl = document.getElementById(`audio-${p.username}`);
        if (audioEl) audioEl.remove();
        // Remove tile
        if (typeof removeVoiceParticipant === "function") removeVoiceParticipant(p.username);
        else voiceParticipantState.delete(p.username);
      }
    )
    .subscribe((status) => {
      console.log(`Voice Room Realtime Status: ${status}`);
    });
}

// --- CONNECT TO EXISTING USERS ---
async function connectToExistingUsers(channelId) {
  // Get all other participants
  const { data: participants, error } = await supabaseClient
    .from("voice_room_participants")
    .select("username")
    .eq("channel_id", channelId)
    .neq("username", username);

  if (error) {
    console.error("❌ Failed to fetch participants:", error);
    return;
  }

  if (!participants || participants.length === 0) {
    console.log("ℹ️ No other users in this voice channel yet.");
    return;
  }

  console.log(`🔗 Connecting to ${participants.length} users...`);

  for (const p of participants) {
    // Avoid connecting to myself or duplicate connections
    if (p.username === username || currentPeerConnections.has(p.username)) continue;

    await initiateConnection(p.username, channelId);
  }
}

// --- INITIATE CONNECTION (ROBUST VERSION) ---
async function initiateConnection(targetUsername, channelId) {
  console.log(`🤝 Initiating connection to ${targetUsername}...`);

  if (!localStream) {
    console.error("❌ initiateConnection failed: No localStream available.");
    return;
  }

  const peerConn = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });

  // Add local tracks
  localStream.getTracks().forEach(track => {
    peerConn.addTrack(track, localStream);
  });

  // Handle incoming remote stream
  peerConn.ontrack = (event) => {
    console.log(`🎵 Received track from ${targetUsername}`);
    
    let stream = event.streams[0];
    
    // FIX: If stream is missing, create one from the track
    if (!stream) {
      console.warn(`⚠️ No stream object received for ${targetUsername}, creating one manually.`);
      stream = new MediaStream();
      event.track && stream.addTrack(event.track);
    }

    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.id = `audio-${targetUsername}`;
    
    // Ensure not muted unless deafened
    if (selfDeafened) {
      audio.muted = true;
    } else {
      audio.muted = false;
    }

    document.body.appendChild(audio);

    // Audio Level Analyzer
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    
    try {
      audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.warn("AudioContext resume failed:", e));
      }
    } catch (e) {
      console.warn("Failed to create AudioContext:", e);
      return;
    }

    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    analyser.fftSize = 256;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastSpeaking = false;

    function checkSpeaking() {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const isSpeaking = average > 20; 

      const participantEl = document.querySelector(`.voice-participant[data-username="${targetUsername}"]`);
      if (participantEl) {
        const avatar = participantEl.querySelector('.voice-participant-avatar');
        if (isSpeaking && !lastSpeaking) {
          avatar.classList.add('speaking');
        } else if (!isSpeaking && lastSpeaking) {
          avatar.classList.remove('speaking');
        }
      }
      lastSpeaking = isSpeaking;
      requestAnimationFrame(checkSpeaking);
    }

    checkSpeaking();
  };

  peerConn.onicecandidate = async (event) => {
    if (event.candidate) {
      try {
        await supabaseClient
          .from("voice_signaling")
          .insert({
            channel_id: channelId,
            from_username: username,
            to_username: targetUsername,
            ice_candidate: event.candidate.toJSON()
          });
      } catch (err) {
        console.error("Failed to send ICE candidate:", err);
      }
    }
  };

  try {
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);

    await supabaseClient
      .from("voice_signaling")
      .insert({
        channel_id: channelId,
        from_username: username,
        to_username: targetUsername,
        sdp: JSON.stringify(offer)
      });

    currentPeerConnections.set(targetUsername, peerConn);
    console.log(`✅ Offer sent to ${targetUsername}`);
  } catch (err) {
    console.error("❌ Failed to create/send offer:", err);
  }
}

// --- JOIN VOICE CHANNEL (UPDATED) ---
async function joinVoiceChannel(channelId) {
  const channel = channels.find(c => c.id === channelId);
  
  if (!channel || channel.channel_type !== 'voice') {
    console.error("❌ Cannot join: Not a voice channel");
    alert("❌ This is not a voice channel.");
    return;
  }

  if (currentVoiceChannelId && currentVoiceChannelId !== channelId) {
    leaveVoiceChannel();
  }

  try {
    console.log("🎤 Requesting microphone access...");
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("✅ Microphone access granted.");

    // CALL THE HELPER HERE
    await unlockAudioContext();

    const messagesList = document.getElementById('messages');
    const controlsBar = document.getElementById('controls');
    const replyBanner = document.getElementById('replyBanner');
    const voiceGrid = document.getElementById('voiceParticipantGrid');
    const voiceBar = document.getElementById('voiceControlBar');
    const vcStatusChannel = document.getElementById('vcStatusChannel');
    const currentChannelName = document.getElementById('currentChannelName');
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendButton');

    if (messagesList) messagesList.style.display = 'none';
    if (controlsBar) controlsBar.style.display = 'none';
    if (replyBanner) replyBanner.style.display = 'none';

    if (voiceGrid) {
      voiceGrid.style.display = 'flex';
      voiceGrid.innerHTML = ''; 
      voiceParticipantState.clear(); 
    }
    if (voiceBar) voiceBar.style.display = 'flex';
    
    if (vcStatusChannel) vcStatusChannel.textContent = channel.name;
    if (currentChannelName) {
      currentChannelName.textContent = `🎤 ${channel.name}`;
      currentChannelName.style.color = 'var(--success)'; 
    }
    if (input) {
      input.disabled = true;
      input.value = ''; 
    }
    if (sendBtn) sendBtn.disabled = true;

    try {
      await supabaseClient
        .from("voice_room_participants")
        .delete()
        .eq("channel_id", channelId)
        .eq("username", username);

      const { error: insertError } = await supabaseClient
        .from("voice_room_participants")
        .insert({
          channel_id: channelId,
          username: username,
          is_muted: false,
          is_deafened: false,
          is_admin_muted: false,
          is_admin_deafened: false
        });

      if (insertError) {
        console.error("DB Insert Error:", insertError);
        if (insertError.message.includes("column") && insertError.message.includes("does not exist")) {
          alert("❌ Database Error: Missing columns. Run SQL migration.");
          leaveVoiceChannel();
          return;
        }
        throw insertError;
      }
    } catch (dbErr) {
      console.error("Failed to update DB presence:", dbErr);
      alert("❌ Could not update voice status in database.");
      leaveVoiceChannel();
      return;
    }

    currentVoiceChannelId = channelId;
    selfMuted = false;
    selfDeafened = false;

    subscribeToVoiceSignaling(channelId);
    subscribeToVoiceRoom(channelId);

    await connectToExistingUsers(channelId);

    const { data: participants, error: fetchError } = await supabaseClient
      .from("voice_room_participants")
      .select("username, is_muted, is_deafened, is_admin_muted, is_admin_deafened")
      .eq("channel_id", channelId);

    if (fetchError) {
      console.error("❌ Failed to fetch participants:", fetchError);
      voiceParticipantState.set(username, { is_muted: false, is_deafened: false, is_admin_muted: false, is_admin_deafened: false });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
    } else if (participants) {
      for (const p of participants) {
        if (p.username === username) continue;

        voiceParticipantState.set(p.username, {
          is_muted: !!p.is_muted,
          is_deafened: !!p.is_deafened,
          is_admin_muted: !!p.is_admin_muted,
          is_admin_deafened: !!p.is_admin_deafened
        });
        renderVoiceParticipant(p.username, voiceParticipantState.get(p.username));

        if (!currentPeerConnections.has(p.username)) {
          await initiateConnection(p.username, channelId);
        }
      }
      
      voiceParticipantState.set(username, { is_muted: false, is_deafened: false, is_admin_muted: false, is_admin_deafened: false });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
    } else {
      voiceParticipantState.set(username, { is_muted: false, is_deafened: false, is_admin_muted: false, is_admin_deafened: false });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
    }

    if (selfMuted) {
      const st = voiceParticipantState.get(username) || {};
      voiceParticipantState.set(username, { ...st, is_muted: true });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
      await supabaseClient
        .from("voice_room_participants")
        .update({ is_muted: true })
        .eq("channel_id", channelId)
        .eq("username", username);
    }

    applyLocalMicState();
    applyLocalDeafenState();
    refreshVoiceControlButtons();

    console.log(`✅ Joined voice channel: ${channel.name}`);

  } catch (err) {
    console.error("Voice connection failed:", err);
    alert("Failed to join voice chat: " + err.message);
    leaveVoiceChannel();
    return;
  }
}

// --- LEAVE VOICE CHANNEL ---
function leaveVoiceChannel() {
  // 1. Capture IDs before clearing state
  const channelIdToLeave = currentVoiceChannelId;

  // 2. Delete DB presence row (async, fire-and-forget)
  if (channelIdToLeave && username) {
    supabaseClient
      .from("voice_room_participants")
      .delete()
      .eq("channel_id", channelIdToLeave)
      .eq("username", username)
      .then(({ error }) => {
        if (error) console.error("Failed to remove voice participant from DB:", error);
      });
  }

  // 3. Unsubscribe realtime channels
  if (voiceSignalingSub) {
    supabaseClient.removeChannel(voiceSignalingSub);
    voiceSignalingSub = null;
  }
  if (voiceRoomSub) {
    supabaseClient.removeChannel(voiceRoomSub);
    voiceRoomSub = null;
  }

  // 4. Close peer connections
  currentPeerConnections.forEach(conn => conn.close());
  currentPeerConnections.clear();

  // 5. Stop local media stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // 6. Hide voice UI, show text UI
  const voiceGrid = document.getElementById('voiceParticipantGrid');
  const voiceBar = document.getElementById('voiceControlBar');
  if (voiceGrid) voiceGrid.style.display = 'none';
  if (voiceBar) voiceBar.style.display = 'none';

  const messagesList = document.getElementById('messages');
  const controlsBar = document.getElementById('controls');
  const replyBanner = document.getElementById('replyBanner');
  if (messagesList) messagesList.style.display = 'block';
  if (controlsBar) controlsBar.style.display = 'flex';
  if (replyBanner) replyBanner.style.display = 'none';

  // 7. Re-enable text input
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendButton');
  if (input) {
    input.disabled = false;
    input.focus();
  }
  if (sendBtn) sendBtn.disabled = false;

  // 8. Reset header to the current text channel name
  const currentChannelNameEl = document.getElementById('currentChannelName');
  if (currentChannelNameEl) {
    const lastTextChannel = channels.find(c => c.id === lastTextChannelId);
    currentChannelNameEl.textContent = `# ${lastTextChannel?.name || 'general'}`;
    currentChannelNameEl.style.color = 'var(--text-main)';
  }

  // 9. Clear state
  voiceParticipantState.clear();
  currentVoiceChannelId = null;
  selfMuted = false;
  selfDeafened = false;
}

/* ======================================================================
   VOICE — local mic / deafen state, control bar wiring, admin menu
   ====================================================================== */
function applyLocalMicState() {
  // Mic should be off if either the user self-muted OR an admin server-muted them.
  const st = voiceParticipantState.get(username) || {};
  const shouldMute = !!selfMuted || !!st.is_admin_muted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !shouldMute; });
  }
}

function applyLocalDeafenState() {
  const st = voiceParticipantState.get(username) || {};
  const isDeafened = !!st.is_deafened || !!st.is_admin_deafened;
  // Mute every remote audio element when deafened.
  document.querySelectorAll('audio.remote-voice').forEach(a => {
    a.muted = isDeafened;
    if (!isDeafened) {
      a.volume = (cachedUserVoiceVolume || 100) / 100;
    }
  });
  // Deafened implies muted mic (Discord behavior): if we became deafened, also mute outgoing audio.
  if (isDeafened && localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = false; });
  } else {
    applyLocalMicState();
  }
}

function refreshVoiceControlButtons() {
  const st = voiceParticipantState.get(username) || {};
  const muteBtn = document.getElementById('vcMuteBtn');
  const deafBtn = document.getElementById('vcDeafenBtn');

  const isAdminMuted = !!st.is_admin_muted;
  const isAdminDeafened = !!st.is_admin_deafened;
  const isMuted = !!selfMuted || isAdminMuted;
  const isDeafened = !!st.is_deafened || isAdminDeafened;

  if (muteBtn) {
    muteBtn.classList.toggle('active', isMuted);
    muteBtn.classList.toggle('admin-locked', isAdminMuted);
    muteBtn.disabled = isAdminMuted;
    const icon = muteBtn.querySelector('.vc-icon');
    if (icon) icon.textContent = isMuted ? '🔇' : '🎤';
    muteBtn.title = isAdminMuted ? 'Server muted by admin' : (isMuted ? 'Unmute microphone' : 'Mute microphone');
    muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  }
  if (deafBtn) {
    deafBtn.classList.toggle('active', isDeafened);
    deafBtn.classList.toggle('admin-locked', isAdminDeafened);
    deafBtn.disabled = isAdminDeafened;
    const icon = deafBtn.querySelector('.vc-icon');
    if (icon) icon.textContent = isDeafened ? '🔇' : '🎧';
    deafBtn.title = isAdminDeafened ? 'Server deafened by admin' : (isDeafened ? 'Undeafen' : 'Deafen');
    deafBtn.setAttribute('aria-pressed', isDeafened ? 'true' : 'false');
  }
}

async function toggleVoiceMute() {
  if (!currentVoiceChannelId) return;
  const st = voiceParticipantState.get(username) || {};
  if (st.is_admin_muted) return; // can't override admin mute
  selfMuted = !selfMuted;
  localStorage.setItem("chatSelfMuted", selfMuted ? "true" : "false");
  const next = { ...st, is_muted: selfMuted };
  voiceParticipantState.set(username, next);
  applyLocalMicState();
  refreshVoiceControlButtons();
  renderVoiceParticipant(username, next);
  updateSelfMuteBadge();
  try {
    await supabaseClient
      .from("voice_room_participants")
      .update({ is_muted: selfMuted })
      .eq("channel_id", currentVoiceChannelId)
      .eq("username", username);
  } catch (err) { console.warn("mute sync failed:", err.message); }
}

async function toggleVoiceDeafen() {
  if (!currentVoiceChannelId) return;
  const st = voiceParticipantState.get(username) || {};
  if (st.is_admin_deafened) return;
  const newDeafened = !st.is_deafened;
  // Discord-style: deafen forces mute on, undeafen restores prior self-mute choice.
  const newMuted = newDeafened ? true : !!selfMuted;
  if (newDeafened) selfMuted = true;
  localStorage.setItem("chatSelfMuted", selfMuted ? "true" : "false");
  const next = { ...st, is_deafened: newDeafened, is_muted: newMuted };
  voiceParticipantState.set(username, next);
  applyLocalDeafenState();
  refreshVoiceControlButtons();
  renderVoiceParticipant(username, next);
  updateSelfMuteBadge();
  try {
    await supabaseClient
      .from("voice_room_participants")
      .update({ is_deafened: newDeafened, is_muted: newMuted })
      .eq("channel_id", currentVoiceChannelId)
      .eq("username", username);
  } catch (err) { console.warn("deafen sync failed:", err.message); }
}

// --- Admin context menu on a remote voice participant ---
let _activeVoiceMenuTarget = null;
function openVoiceParticipantMenu(targetUsername, x, y) {
  const menu = document.getElementById('voiceParticipantMenu');
  if (!menu) return;
  // Only Admin / SysAdmin / Manager (or Manager scoped to others) may use this menu.
  const canAdmin = ["Admin", "SysAdmin", "Manager"].includes(currentRole);
  if (!canAdmin) return;
  _activeVoiceMenuTarget = targetUsername;

  const st = voiceParticipantState.get(targetUsername) || {};
  // Toggle visibility of mute/unmute, deafen/undeafen based on current state.
  menu.querySelector('[data-action="server-mute"]').style.display    = st.is_admin_muted    ? 'none' : 'block';
  menu.querySelector('[data-action="server-unmute"]').style.display  = st.is_admin_muted    ? 'block' : 'none';
  menu.querySelector('[data-action="server-deafen"]').style.display  = st.is_admin_deafened ? 'none' : 'block';
  menu.querySelector('[data-action="server-undeafen"]').style.display= st.is_admin_deafened ? 'block' : 'none';

  // Position within viewport.
  menu.style.display = 'block';
  const w = menu.offsetWidth || 200;
  const h = menu.offsetHeight || 160;
  const px = Math.min(x, window.innerWidth - w - 8);
  const py = Math.min(y, window.innerHeight - h - 8);
  menu.style.left = px + 'px';
  menu.style.top  = py + 'px';
}

function closeVoiceParticipantMenu() {
  const menu = document.getElementById('voiceParticipantMenu');
  if (menu) menu.style.display = 'none';
  _activeVoiceMenuTarget = null;
}

async function applyAdminVoiceAction(targetUsername, action) {
  if (!currentVoiceChannelId || !targetUsername) return;
  const updates = {};
  if (action === 'server-mute')      updates.is_admin_muted    = true;
  if (action === 'server-unmute')    updates.is_admin_muted    = false;
  if (action === 'server-deafen')  { updates.is_admin_deafened = true;  updates.is_admin_muted = true; }
  if (action === 'server-undeafen')  updates.is_admin_deafened = false;

  if (action === 'disconnect') {
    try {
      await supabaseClient
        .from("voice_room_participants")
        .delete()
        .eq("channel_id", currentVoiceChannelId)
        .eq("username", targetUsername);
    } catch (err) { alert("❌ Disconnect failed: " + err.message); }
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("voice_room_participants")
      .update(updates)
      .eq("channel_id", currentVoiceChannelId)
      .eq("username", targetUsername);
    if (error) throw error;
  } catch (err) {
    alert("❌ Voice admin action failed: " + err.message);
  }
}

// Wire VC control bar + participant menu (idempotent).
(function wireVoiceControlsOnce() {
  function init() {
    const muteBtn  = document.getElementById('vcMuteBtn');
    const deafBtn  = document.getElementById('vcDeafenBtn');
    const leaveBtn = document.getElementById('vcLeaveBtn');
    if (muteBtn  && !muteBtn.dataset.wired)  { muteBtn.dataset.wired = "1";  muteBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggleVoiceMute(); }); }
    if (deafBtn  && !deafBtn.dataset.wired)  { deafBtn.dataset.wired = "1";  deafBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggleVoiceDeafen(); }); }
    if (leaveBtn && !leaveBtn.dataset.wired) { leaveBtn.dataset.wired = "1"; leaveBtn.addEventListener('click', (e) => { e.stopPropagation(); leaveVoiceChannel(); }); }

    const menu = document.getElementById('voiceParticipantMenu');
    if (menu && !menu.dataset.wired) {
      menu.dataset.wired = "1";
      menu.querySelectorAll('button[data-action]').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = b.dataset.action;
          const target = _activeVoiceMenuTarget;
          closeVoiceParticipantMenu();
          if (target) await applyAdminVoiceAction(target, action);
        });
      });
      // Close on outside click / scroll / esc.
      document.addEventListener('click', (e) => {
        if (menu.style.display === 'block' && !menu.contains(e.target)) closeVoiceParticipantMenu();
      });
      window.addEventListener('scroll', closeVoiceParticipantMenu, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVoiceParticipantMenu(); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ======================================================================
   GLOBAL MUTE (SysAdmin only) — uses users.muted_until
   ====================================================================== */
async function globalMuteUser(user) {
  if (currentSystemRole !== "SysAdmin") {
    alert("❌ Only SysAdmins can apply a global mute.");
    return;
  }
  const minutes = parseInt(prompt(`Globally mute ${user} for how many minutes? (applies everywhere)`), 10);
  if (!minutes || minutes <= 0) return;
  const until = new Date(Date.now() + minutes * 60000).toISOString();
  const { error } = await supabaseClient
    .from("users")
    .update({ muted_until: until })
    .eq("username", user);
  if (error) { alert("❌ Global mute failed: " + error.message); return; }
  alert(`🔇 ${user} has been globally muted for ${minutes} minutes.`);
}

async function globalUnmuteUser(user) {
  if (currentSystemRole !== "SysAdmin") {
    alert("❌ Only SysAdmins can clear a global mute.");
    return;
  }
  if (!confirm(`Clear the global mute on ${user}?`)) return;
  const { error } = await supabaseClient
    .from("users")
    .update({ muted_until: null })
    .eq("username", user);
  if (error) { alert("❌ Global unmute failed: " + error.message); return; }
  alert(`🔊 ${user}'s global mute has been cleared.`);
}

async function loadThemesAndApply() {
  let dbThemes = [];
  try {
    const { data, error } = await supabaseClient
      .from("themes")
      .select("id, name, display_name, css_variables, is_default")
      .order("is_default", { ascending: false })
      .order("display_name", { ascending: true });
    
    if (!error && Array.isArray(data)) {
      // Filter out any accidental built-in IDs just in case
      dbThemes = data.filter(theme => theme && theme.css_variables && !theme.id.startsWith("__builtin_"));
    }
  } catch (err) { 
    console.warn("Themes table unavailable:", err.message); 
  }

  // Since we removed built-ins, availableThemes is purely DB-driven
  availableThemes = dbThemes;

  // --- FALLBACK LOGIC ---
  // If the DB is empty, we don't want a broken UI. 
  // We will apply a hardcoded "Safe Default" style immediately.
  if (availableThemes.length === 0) {
    console.warn("⚠️ No themes found in DB. Applying safe fallback style.");
    applyFallbackStyle();
    // We do NOT set currentThemeId here so the user knows to pick one later
    return; 
  }

  // --- THEME SELECTION ---
  let chosen = null;
  
  // 1. Check Local Storage first
  const localThemeId = localStorage.getItem("chatThemeId");
  if (localThemeId) {
    chosen = availableThemes.find(t => t.id === localThemeId);
  }

  // 2. Fallback to the DB's default flag
  if (!chosen) {
    chosen = availableThemes.find(t => t.is_default === true);
  }

  // 3. Fallback to the first theme if no default exists
  if (!chosen) {
    chosen = availableThemes[0];
  }

  if (chosen) {
    applyThemeVariables(chosen);
    // Sync local storage if we picked a DB theme
    localStorage.setItem("chatThemeId", chosen.id);
  }

  // Refresh settings modal if open
  if (document.getElementById("userSettingsModal")?.style.display === "flex") {
    renderThemeList();
  }
}

// Helper to apply a hardcoded fallback if DB is empty
function applyFallbackStyle() {
  const root = document.documentElement;
  const fallback = {
    "--bg-main": "#2b2d31",
    "--bg-secondary": "#1e1f22",
    "--bg-tertiary": "#313338",
    "--text-main": "#dbdee1",
    "--text-muted": "#949ba4",
    "--accent": "#5865f2",
    "--danger": "#ed4245",
    "--success": "#3ba55d"
  };
  
  // Reset previous vars
  if (root._lastThemeVarKeys && Array.isArray(root._lastThemeVarKeys)) {
    root._lastThemeVarKeys.forEach((k) => root.style.removeProperty(k));
  }

  Object.entries(fallback).forEach(([k, v]) => {
    root.style.setProperty(k, v);
  });
  root._lastThemeVarKeys = Object.keys(fallback);
}

async function selectTheme(themeId) {
  const theme = availableThemes.find(t => t.id === themeId);
  if (!theme) return;
  
  applyThemeVariables(theme);
  
  // Save ONLY to Local Storage
  localStorage.setItem("chatThemeId", themeId);
  
  // Optional: Sync to DB if you want persistence across devices
  // Since there are no built-ins, we always save the ID as-is.
  try {
    await supabaseClient.from("users").update({ custom_theme_id: themeId }).eq("username", username);
  } catch (err) { console.warn("Save theme failed:", err.message); }

  renderThemeList();
}

// Coerce a theme's css_variables (which may come back from Postgres as a JSON
// string instead of a parsed object) into a plain object.
function _normalizeThemeVars(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); }
    catch (err) { console.warn("Bad theme JSON, ignoring:", err.message, raw); return null; }
  }
  if (typeof raw === "object") return raw;
  return null;
}

// Many themes only define a small core palette (--bg-main, --bg-secondary,
// --bg-tertiary, --text-main, --accent, etc.). The CSS, however, references
// a wider set of variables (--bg-modal, --bg-input, --bg-deepest,
// --surface-border, --warning, --text-on-accent, --body-bg-from/to, ...).
// If we don't fill those in, the missing vars stay at their dark-Discord
// defaults and the theme appears to "barely do anything." This expander
// derives sensible values for every var the CSS uses from whatever the
// theme actually provides.
function _expandThemeVariables(vars) {
  const out = { ...vars };
  const get = (k) => (typeof out[k] === "string" && out[k]) ? out[k] : null;

  // --- Background ladder (deepest -> elevated) ---
  const bgMain      = get("--bg-main")      || "#2b2d31";
  const bgSecondary = get("--bg-secondary") || _shadeColor(bgMain, -10);
  const bgTertiary  = get("--bg-tertiary")  || _shadeColor(bgMain,  +6);
  const bgHover     = get("--bg-hover")     || _shadeColor(bgMain, +10);
  const bgElevated  = get("--bg-elevated")  || _shadeColor(bgMain, +16);
  const bgDeepest   = get("--bg-deepest")   || _shadeColor(bgSecondary, -20);
  const bgModal     = get("--bg-modal")     || bgTertiary;
  const bgInput     = get("--bg-input")     || bgSecondary;

  out["--bg-main"]      = bgMain;
  out["--bg-secondary"] = bgSecondary;
  out["--bg-tertiary"]  = bgTertiary;
  out["--bg-hover"]     = bgHover;
  out["--bg-elevated"]  = bgElevated;
  out["--bg-deepest"]   = bgDeepest;
  out["--bg-modal"]     = bgModal;
  out["--bg-input"]     = bgInput;

  // --- Body gradient backdrop ---
  out["--body-bg-from"] = get("--body-bg-from") || _shadeColor(bgMain, -4);
  out["--body-bg-to"]   = get("--body-bg-to")   || _shadeColor(bgMain, -16);

  // --- Text colors ---
  const textMain  = get("--text-main")  || "#dbdee1";
  const textMuted = get("--text-muted") || _mix(textMain, bgMain, 0.45);
  out["--text-main"]      = textMain;
  out["--text-muted"]     = textMuted;
  out["--text-link"]      = get("--text-link")      || get("--accent") || "#00a8fc";
  out["--text-on-accent"] = get("--text-on-accent") || _bestContrast(get("--accent") || "#5865f2");

  // --- Accent / status colors ---
  const accent = get("--accent") || "#5865f2";
  out["--accent"]         = accent;
  out["--accent-strong"] = get("--accent-strong") || _shadeColor(accent, +12);
  out["--danger"]         = get("--danger")  || "#ed4245";
  out["--success"]        = get("--success") || "#3ba55d";
  out["--warning"]        = get("--warning") || "#faa61a";

  // --- Borders ---
  // Use a luminance-aware translucent overlay so borders are visible on both
  // very-dark and light themes.
  out["--surface-border"] = get("--surface-border")
    || (_isLight(bgMain) ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)");

  return out;
}

// --- Tiny color helpers (no deps) -------------------------------------
function _hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function _rgbToHex(r,g,b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function _shadeColor(hex, percent) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return hex;
  const amt = Math.round(2.55 * percent);
  return _rgbToHex(rgb.r + amt, rgb.g + amt, rgb.b + amt);
}
function _mix(hexA, hexB, ratio) {
  const a = _hexToRgb(hexA), b = _hexToRgb(hexB);
  if (!a || !b) return hexA;
  return _rgbToHex(a.r*(1-ratio)+b.r*ratio, a.g*(1-ratio)+b.g*ratio, a.b*(1-ratio)+b.b*ratio);
}
function _luminance(hex) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return 0.5;
  const f = (c) => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*f(rgb.r) + 0.7152*f(rgb.g) + 0.0722*f(rgb.b);
}
function _isLight(hex) { return _luminance(hex) > 0.5; }
function _bestContrast(hex) { return _isLight(hex) ? "#1a1a1a" : "#ffffff"; }

function applyThemeVariables(theme) {
  if (!theme) return;
  const raw = _normalizeThemeVars(theme.css_variables);
  if (!raw) return;
  const vars = _expandThemeVariables(raw);
  const root = document.documentElement;

  // Reset any previously-set inline overrides so vars from the *previous*
  // theme don't bleed through when the new theme omits them.
  if (root._lastThemeVarKeys && Array.isArray(root._lastThemeVarKeys)) {
    root._lastThemeVarKeys.forEach((k) => root.style.removeProperty(k));
  }

  Object.entries(vars).forEach(([k, v]) => {
    if (typeof v === "string") root.style.setProperty(k, v);
  });
  root._lastThemeVarKeys = Object.keys(vars);

  // Cache the parsed (raw) object locally for instant apply on next load —
  // we re-expand on read so logic changes here apply immediately.
  try { localStorage.setItem("chatThemeVars", JSON.stringify(raw)); } catch {}
}

// Restore last theme variables ASAP so first paint isn't a flash.
(function applyCachedTheme() {
  try {
    const cached = localStorage.getItem("chatThemeVars");
    if (!cached) return;
    const raw = JSON.parse(cached);
    if (!raw || typeof raw !== "object") return;
    const vars = (typeof _expandThemeVariables === "function") ? _expandThemeVariables(raw) : raw;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      if (typeof v === "string") root.style.setProperty(k, v);
    });
    root._lastThemeVarKeys = Object.keys(vars);
  } catch {}
})();

function renderThemeList() {
  const list = document.getElementById("settingsThemeList");
  if (!list) return;
  list.innerHTML = "";
  if (!availableThemes.length) {
    list.innerHTML = '<div class="settings-theme-loading">No themes available.</div>';
    return;
  }
  availableThemes.forEach(theme => {
    const card = document.createElement("div");
    card.className = "settings-theme-card";
    if (theme.id === currentThemeId || (!currentThemeId && theme.is_default)) {
      card.classList.add("selected");
    }
    const v = _normalizeThemeVars(theme.css_variables) || {};
    const p1 = v["--accent"] || "#5865f2";
    const p2 = v["--accent-strong"] || v["--text-link"] || "#00a8fc";
    const bg = v["--bg-main"] || "#2b2d31";
    const text = v["--text-main"] || "#dbdee1";
    card.innerHTML = `
      <div class="settings-theme-preview" style="background:linear-gradient(135deg, ${p1}, ${p2});">
        <div style="position:relative;height:100%;">
          <div style="position:absolute;inset:8px;background:${bg};border-radius:6px;display:flex;align-items:center;padding:0 8px;">
            <div style="width:14px;height:14px;border-radius:50%;background:${p1};margin-right:6px;"></div>
            <div style="height:6px;flex:1;background:${text};opacity:0.5;border-radius:3px;"></div>
          </div>
        </div>
      </div>
      <div class="settings-theme-name">${escapeHTML(theme.display_name || theme.name)}</div>
    `;
    card.addEventListener("click", () => selectTheme(theme.id));
    list.appendChild(card);
  });
}

/* ======================================================================
   USER SETTINGS MODAL — open/close, tabs, panes
   ====================================================================== */
function openUserSettings(initialTab = "account") {
  if (!username) return;
  const modal = document.getElementById("userSettingsModal");
  if (!modal) return;

  // Populate fields with current data
  populateSettingsAccountTab();
  populateSettingsProfileTab();
  populateSettingsNotificationsTab();
  populateSettingsVoiceTab();
  populateSettingsStatusTab();
  renderThemeList();
  refreshSettingsConnections();

  switchSettingsTab(initialTab);
  modal.style.display = "flex";
}

function closeUserSettings() {
  const modal = document.getElementById("userSettingsModal");
  if (modal) modal.style.display = "none";
}

function switchSettingsTab(name) {
  document.querySelectorAll("#userSettingsModal .settings-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll("#userSettingsModal .settings-pane").forEach(p => {
    p.classList.toggle("active", p.dataset.pane === name);
  });
}

function populateSettingsAccountTab() {
  document.getElementById("settingsDisplayName").textContent = getEffectiveDisplayName(username) || username;
  document.getElementById("settingsUsername").textContent = `@${username}`;
  // Email
  supabaseClient.auth.getUser().then(({ data }) => {
    const email = data?.user?.email || "—";
    const el = document.getElementById("settingsEmailValue");
    if (el) el.textContent = email;
  });
  // Avatar
  const avatar = getEffectiveAvatarUrl(username) || currentUserAvatarUrl || "";
  const img = document.getElementById("settingsAvatarImage");
  const fallback = document.getElementById("settingsAvatarFallback");
  if (avatar) {
    img.src = avatar;
    img.style.display = "block";
    fallback.style.display = "none";
  } else {
    img.style.display = "none";
    fallback.style.display = "flex";
    fallback.textContent = getInitials(username);
  }
}

function populateSettingsProfileTab() {
  const bioEl = document.getElementById("settingsBio");
  const statusEl = document.getElementById("settingsStatus");
  if (bioEl) bioEl.value = currentBio || "";
  if (statusEl) statusEl.value = currentCustomStatus || "";
}

function populateSettingsNotificationsTab() {
  const m = document.getElementById("settingsNotifyMentions");
  const r = document.getElementById("settingsNotifyReplies");
  const a = document.getElementById("settingsNotifyAll");
  if (m) m.checked = currentNotificationPrefs.mentions !== false;
  if (r) r.checked = currentNotificationPrefs.replies !== false;
  if (a) a.checked = !!currentNotificationPrefs.all_messages;
}

function populateSettingsVoiceTab() {
  const vol = document.getElementById("settingsVoiceVolume");
  const valEl = document.getElementById("settingsVoiceVolumeValue");
  if (vol) vol.value = cachedUserVoiceVolume;
  if (valEl) valEl.textContent = cachedUserVoiceVolume;
  const sm = document.getElementById("settingsSelfMuteToggle");
  if (sm) sm.checked = !!selfMuted;
}

function populateSettingsStatusTab() {
  document.querySelectorAll("#userSettingsModal .status-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.status === currentPresenceStatus);
  });
}

async function saveProfileChanges() {
  const bio = (document.getElementById("settingsBio")?.value || "").trim();
  const status = (document.getElementById("settingsStatus")?.value || "").trim();
  const msg = document.getElementById("settingsProfileMsg");
  try {
    const { error } = await supabaseClient.from("users").update({
      profile_description: bio,
      profile_status: status
    }).eq("username", username);
    if (error) throw error;
    currentBio = bio;
    currentCustomStatus = status;
    if (msg) { msg.textContent = "✅ Saved"; msg.classList.remove("error"); }
    setTimeout(() => { if (msg) msg.textContent = ""; }, 2200);
  } catch (err) {
    if (msg) { msg.textContent = "❌ " + err.message; msg.classList.add("error"); }
  }
}

async function saveNotificationChanges() {
  const prefs = {
    mentions: document.getElementById("settingsNotifyMentions").checked,
    replies: document.getElementById("settingsNotifyReplies").checked,
    all_messages: document.getElementById("settingsNotifyAll").checked
  };
  const msg = document.getElementById("settingsNotifyMsg");
  try {
    const { error } = await supabaseClient.from("users").update({
      notification_preferences: prefs
    }).eq("username", username);
    if (error) throw error;
    currentNotificationPrefs = prefs;
    if (msg) { msg.textContent = "✅ Saved"; msg.classList.remove("error"); }
    setTimeout(() => { if (msg) msg.textContent = ""; }, 2200);
  } catch (err) {
    if (msg) { msg.textContent = "❌ " + err.message; msg.classList.add("error"); }
  }
}

function setPresenceStatus(status) {
  if (!["online", "idle", "dnd", "invisible"].includes(status)) return;
  currentPresenceStatus = status;
  localStorage.setItem("chatPresenceStatus", status);
  populateSettingsStatusTab();
  updatePresenceDot();
}

function updatePresenceDot() {
  const dot = document.getElementById("profileBtnPresenceDot");
  if (!dot) return;
  dot.dataset.status = currentPresenceStatus;
  dot.title = "Status: " + currentPresenceStatus;
}

const CONNECTION_PROVIDERS = [
  { id: "google",   name: "Google",    icon: "G",  brand: "#ea4335" },
  { id: "github",   name: "GitHub",    icon: "GH", brand: "#1f2328" },
  { id: "discord",  name: "Discord",   icon: "D",  brand: "#5865f2" },
  { id: "azure",    name: "Microsoft", icon: "M",  brand: "#0067b8" }
];

function getProviderHandleFromIdentity(identity) {
  const d = identity?.identity_data || {};
  return d.user_name || d.preferred_username || d.global_name || d.full_name || d.name || d.email || "";
}

async function refreshSettingsConnections() {
  const list = document.getElementById("settingsConnectionsList");
  const status = document.getElementById("settingsConnectionsStatus");
  if (!list) return;
  list.innerHTML = '<div class="connections-loading">Loading connections…</div>';

  let identities = [];
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    identities = user?.identities || [];
  } catch (err) {
    list.innerHTML = '<div class="connections-loading error">Could not load linked accounts.</div>';
    if (status) { status.textContent = "❌ " + err.message; status.classList.add("error"); }
    return;
  }
  if (status) { status.textContent = ""; status.classList.remove("error"); }

  list.innerHTML = "";
  CONNECTION_PROVIDERS.forEach(p => {
    const linked = identities.find(i => i.provider === p.id);
    const handle = linked ? getProviderHandleFromIdentity(linked) : "";

    const card = document.createElement("div");
    card.className = "connection-card" + (linked ? " is-linked" : "");
    card.innerHTML = `
      <div class="connection-card-icon" style="background:${p.brand};">${escapeHTML(p.icon)}</div>
      <div class="connection-card-body">
        <div class="connection-card-name">${escapeHTML(p.name)}</div>
        <div class="connection-card-handle">${linked
          ? (handle ? escapeHTML(handle) : "Linked")
          : "Not connected"}</div>
      </div>
      <button class="connection-card-btn ${linked ? 'disconnect' : 'connect'}"
              data-provider="${p.id}" data-action="${linked ? 'disconnect' : 'connect'}">
        ${linked ? "Disconnect" : "Connect"}
      </button>
    `;
    list.appendChild(card);
  });

  // Wire buttons (delegated each refresh — fine since list was rebuilt).
  list.querySelectorAll(".connection-card-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      const action = btn.dataset.action;
      btn.disabled = true;
      try {
        if (action === "connect") {
          await linkOAuthIdentity(provider);
        } else {
          if (!confirm(`Disconnect your ${provider} account?`)) { btn.disabled = false; return; }
          await unlinkOAuthIdentity(provider);
          await refreshSettingsConnections();
        }
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/* ======================================================================
   USER SETTINGS — wire up button events (run after DOM ready)
   ====================================================================== */
(function wireUserSettingsModal() {
  function init() {
    const modal = document.getElementById("userSettingsModal");
    if (!modal) return;

    // Close handlers
    const closeBtn = document.getElementById("closeUserSettingsModal");
    if (closeBtn) closeBtn.addEventListener("click", closeUserSettings);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeUserSettings(); });

    // Tab switching
    modal.querySelectorAll(".settings-tab").forEach(tab => {
      const name = tab.dataset.tab;
      if (!name) return;
      tab.addEventListener("click", () => switchSettingsTab(name));
    });

    // Logout
    const logout = document.getElementById("settingsLogoutBtn");
    if (logout) logout.addEventListener("click", () => performLogout());

    // Account: Edit / Change Email / Change Password
    const editProfile = document.getElementById("settingsEditProfileBtn");
    if (editProfile) editProfile.addEventListener("click", () => {
      closeUserSettings();
      openUserProfile(username, currentServerId);
    });
    const chgEmail = document.getElementById("settingsChangeEmailBtn");
    if (chgEmail) chgEmail.addEventListener("click", () => changeAccountEmail());
    const chgPwd = document.getElementById("settingsChangePasswordBtn");
    if (chgPwd) chgPwd.addEventListener("click", () => changeAccountPassword());

    // Avatar change → reuse the existing file input
    const avatarBox = document.getElementById("settingsAvatarContainer");
    if (avatarBox) avatarBox.addEventListener("click", () => {
      const inp = document.getElementById("avatarInput");
      if (inp) inp.click();
    });

    // Profile tab save
    const saveProfile = document.getElementById("settingsSaveProfileBtn");
    if (saveProfile) saveProfile.addEventListener("click", saveProfileChanges);

    // Notifications save
    const saveNotif = document.getElementById("settingsSaveNotifyBtn");
    if (saveNotif) saveNotif.addEventListener("click", saveNotificationChanges);

    // Voice volume slider
    const vol = document.getElementById("settingsVoiceVolume");
    const volVal = document.getElementById("settingsVoiceVolumeValue");
    if (vol) vol.addEventListener("input", () => {
      cachedUserVoiceVolume = parseInt(vol.value, 10) || 100;
      if (volVal) volVal.textContent = cachedUserVoiceVolume;
      localStorage.setItem("chatVoiceVolume", String(cachedUserVoiceVolume));
      // Apply to all currently-playing remote audios.
      document.querySelectorAll("audio.remote-voice").forEach(a => { a.volume = cachedUserVoiceVolume / 100; });
    });

    // Self-mute toggle inside voice tab
    const selfMuteToggle = document.getElementById("settingsSelfMuteToggle");
    if (selfMuteToggle) selfMuteToggle.addEventListener("change", () => {
      if (selfMuteToggle.checked !== selfMuted) toggleSelfMute();
    });

    // Status options (Online / Idle / DND / Invisible)
    modal.querySelectorAll(".status-option").forEach(btn => {
      btn.addEventListener("click", () => setPresenceStatus(btn.dataset.status));
    });

    // (Connections — now rendered as cards; click handlers wired in refreshSettingsConnections.)

    // Danger Zone — Delete Account
    const delBtn = document.getElementById("settingsDeleteAccountBtn");
    if (delBtn) delBtn.addEventListener("click", () => deleteMyAccount());

    // Self-mute mic button on user panel
    const muteBtn = document.getElementById("selfMuteBtn");
    if (muteBtn) {
      muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelfMute();
      });
    }
    // Gear icon → open settings
    const gear = document.getElementById("openSettingsBtn");
    if (gear) {
      gear.addEventListener("click", (e) => {
        e.stopPropagation();
        openUserSettings("account");
      });
    }

    updateSelfMuteBadge();
    updatePresenceDot();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ============================================================
 *  CHANNEL PERMISSIONS  (channel_permissions table)
 *  Discord-style per-channel role/member overrides:
 *    - can_view, can_send, can_manage
 *    - row keyed by (channel_id, role_id|username, NULLs allowed)
 *    - resolution order: @everyone (no role/no user)
 *                      → role overrides (any of the user's role ids)
 *                      → user override (by username)
 *                      → DENY beats ALLOW within the same tier
 * ============================================================ */

let channelPermissionsCache = new Map(); // channel_id -> [rows]
let currentUserRoleIds = new Set();      // role ids the logged-in user holds in current server
let allServerRolesCache = [];            // for the modal Roles tab

async function loadChannelPermissionsForServer() {
  channelPermissionsCache = new Map();
  currentUserRoleIds = new Set();
  if (!currentServerId || !channels || !channels.length) return;

  const channelIds = channels.map(c => c.id);
  try {
    const [permsRes, rolesRes, myMemberRes] = await Promise.all([
      supabaseClient.from("channel_permissions").select("*").in("channel_id", channelIds),
      supabaseClient.from("server_roles").select("id, role, name, color").eq("server_id", currentServerId),
      // member id of current user in this server (needed for role-link lookup)
      username
        ? supabaseClient.from("server_members").select("id, primary_role_id").eq("server_id", currentServerId).eq("username", username).maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    allServerRolesCache = rolesRes?.data || [];

    // Now that we have member id, fetch real role links
    if (myMemberRes?.data?.id) {
      const myMemberId = myMemberRes.data.id;
      const { data: links } = await supabaseClient
        .from("server_member_roles")
        .select("role_id")
        .eq("server_id", currentServerId)
        .eq("member_id", myMemberId);
      (links || []).forEach(l => l.role_id && currentUserRoleIds.add(l.role_id));
      if (myMemberRes.data.primary_role_id) currentUserRoleIds.add(myMemberRes.data.primary_role_id);
    }

    (permsRes?.data || []).forEach(row => {
      if (!channelPermissionsCache.has(row.channel_id)) channelPermissionsCache.set(row.channel_id, []);
      channelPermissionsCache.get(row.channel_id).push(row);
    });
  } catch (err) {
    console.warn("⚠️ loadChannelPermissionsForServer failed:", err?.message || err);
  }
}

// Resolve effective {can_view, can_send, can_manage} for the CURRENT user in a given channel.
// Returns null if there are no overrides at all (caller treats null as "use defaults").
function getEffectiveChannelPermission(channelId) {
  const rows = channelPermissionsCache.get(channelId);
  if (!rows || !rows.length) return null;

  const result = { can_view: true, can_send: true, can_manage: false, _hasMatch: false };

  // Tier 1: @everyone (role_id null AND username null)
  rows.filter(r => !r.role_id && !r.username).forEach(r => {
    applyOverride(result, r);
    result._hasMatch = true;
  });

  // Tier 2: role-based (any of the user's roles) — DENY wins over ALLOW within same key
  const myRoleRows = rows.filter(r => r.role_id && currentUserRoleIds.has(r.role_id));
  ["can_view", "can_send", "can_manage"].forEach(key => {
    let allow = null;
    myRoleRows.forEach(r => {
      if (r[key] === false) allow = false;
      else if (r[key] === true && allow !== false) allow = true;
    });
    if (allow !== null) { result[key] = allow; result._hasMatch = true; }
  });

  // Tier 3: user override (highest priority)
  const userRow = rows.find(r => !r.role_id && r.username && r.username === username);
  if (userRow) {
    applyOverride(result, userRow);
    result._hasMatch = true;
  }

  return result._hasMatch ? result : null;
}

function applyOverride(target, row) {
  if (row.can_view !== null && row.can_view !== undefined) target.can_view = !!row.can_view;
  if (row.can_send !== null && row.can_send !== undefined) target.can_send = !!row.can_send;
  if (row.can_manage !== null && row.can_manage !== undefined) target.can_manage = !!row.can_manage;
}

// Hook channel filtering into the existing renderChannelList by hiding/dimming after render.
// We do it as a post-pass so we don't have to rewrite the existing function.
(function installChannelVisibilityFilter() {
  const original = (typeof renderChannelList === "function") ? renderChannelList : null;
  if (!original) return;
  window.renderChannelList = function patchedRenderChannelList(...args) {
    const r = original.apply(this, args);
    try { applyChannelVisibilityFilter(); } catch (e) { console.warn(e); }
    return r;
  };
})();

function applyChannelVisibilityFilter() {
  const isAdmin = !!(userPermissions && userPermissions.manage_roles);
  document.querySelectorAll("#channelList .channel").forEach(el => {
    const chId = parseInt(el.dataset.id, 10);
    if (!chId) return;
    const eff = getEffectiveChannelPermission(chId);
    el.classList.remove("cp-hidden-but-admin");
    if (eff && eff.can_view === false) {
      if (isAdmin) {
        el.style.display = "";
        el.classList.add("cp-hidden-but-admin");
        el.title = "Hidden from non-admins by channel permissions";
      } else {
        el.style.display = "none";
      }
    } else {
      el.style.display = "";
      el.title = "";
    }
  });
}

/* ============================================================
 *  CHANNEL PERMISSIONS MODAL
 * ============================================================ */
let _cpModalState = {
  channelId: null,
  // Map "role:<id>" or "user:<username>" -> { can_view, can_send, can_manage, _isNew, _toDelete, _id }
  rows: new Map(),
  initialSnapshot: ""
};

function openChannelPermsModal(channelId) {
  if (!channelId) return;
  if (!userPermissions || !userPermissions.manage_roles) {
    alert("❌ You don't have permission to edit channel permissions.");
    return;
  }
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return;

  _cpModalState = { channelId, rows: new Map(), initialSnapshot: "" };

  document.getElementById("channelPermsTitle").textContent = "# " + ch.name;

  // Seed rows from cache
  const rows = channelPermissionsCache.get(channelId) || [];
  rows.forEach(r => {
    const key = r.role_id ? "role:" + r.role_id : (r.username ? "user:" + r.username : "everyone");
    _cpModalState.rows.set(key, {
      _id: r.id,
      role_id: r.role_id || null,
      username: r.username || null,
      can_view: (r.can_view === null || r.can_view === undefined) ? null : !!r.can_view,
      can_send: (r.can_send === null || r.can_send === undefined) ? null : !!r.can_send,
      can_manage: (r.can_manage === null || r.can_manage === undefined) ? null : !!r.can_manage,
      _isNew: false,
      _toDelete: false
    });
  });
  _cpModalState.initialSnapshot = JSON.stringify([..._cpModalState.rows.entries()]);

  // Populate the role / member add-selects
  populateCpAddSelects();

  // Switch to Roles tab
  cpSwitchTab("roles");

  renderCpRows();

  document.getElementById("channelPermsModal").style.display = "flex";
}

function closeChannelPermsModal() {
  document.getElementById("channelPermsModal").style.display = "none";
  _cpModalState = { channelId: null, rows: new Map(), initialSnapshot: "" };
}

function populateCpAddSelects() {
  const roleSel = document.getElementById("cpAddRoleSelect");
  const memSel = document.getElementById("cpAddMemberSelect");
  if (!roleSel || !memSel) return;

  // Roles already overridden
  const usedRoleIds = new Set();
  const usedUsernames = new Set();
  _cpModalState.rows.forEach(v => {
    if (v.role_id) usedRoleIds.add(v.role_id);
    if (v.username) usedUsernames.add(v.username);
  });

  roleSel.innerHTML = '<option value="">+ Add role override…</option>';
  // Always allow @everyone as a synthetic role
  if (!_cpModalState.rows.has("everyone")) {
    const opt = document.createElement("option");
    opt.value = "__everyone__";
    opt.textContent = "@everyone";
    roleSel.appendChild(opt);
  }
  (allServerRolesCache || []).forEach(r => {
    if (usedRoleIds.has(r.id)) return;
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = "@" + (r.name || r.role || "Role");
    opt.dataset.color = r.color || "";
    roleSel.appendChild(opt);
  });

  memSel.innerHTML = '<option value="">+ Add member override…</option>';
  (serverMembers || [])
    .slice()
    .sort((a, b) => String(a.username || "").localeCompare(String(b.username || "")))
    .forEach(m => {
      if (!m.username || usedUsernames.has(m.username)) return;
      const opt = document.createElement("option");
      opt.value = m.username;
      const display = m.profile_display_name || m.username;
      opt.textContent = display + (display !== m.username ? " (" + m.username + ")" : "");
      memSel.appendChild(opt);
    });
}

function cpSwitchTab(name) {
  document.querySelectorAll(".cp-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.cpTab === name);
  });
  document.querySelectorAll(".channel-perms-pane").forEach(p => {
    p.style.display = (p.dataset.cpPane === name) ? "" : "none";
  });
}

function renderCpRows() {
  const rolesContainer = document.getElementById("cpRolesList");
  const membersContainer = document.getElementById("cpMembersList");
  if (!rolesContainer || !membersContainer) return;
  rolesContainer.innerHTML = "";
  membersContainer.innerHTML = "";

  const roleEntries = [];
  const memberEntries = [];

  _cpModalState.rows.forEach((row, key) => {
    if (row._toDelete) return;
    if (key.startsWith("role:") || key === "everyone") roleEntries.push([key, row]);
    else memberEntries.push([key, row]);
  });

  if (!roleEntries.length) {
    rolesContainer.innerHTML = '<div class="cp-empty">No role overrides yet. Use the dropdown above to add one.</div>';
  } else {
    roleEntries.forEach(([key, row]) => rolesContainer.appendChild(buildCpRowEl(key, row, "role")));
  }
  if (!memberEntries.length) {
    membersContainer.innerHTML = '<div class="cp-empty">No member overrides yet. Use the dropdown above to add one.</div>';
  } else {
    memberEntries.forEach(([key, row]) => membersContainer.appendChild(buildCpRowEl(key, row, "member")));
  }
}

function buildCpRowEl(key, row, kind) {
  const el = document.createElement("div");
  el.className = "cp-row";
  el.dataset.cpKey = key;

  let label = "";
  let dotColor = "#99aab5";
  if (key === "everyone") {
    label = "@everyone";
  } else if (kind === "role") {
    const r = (allServerRolesCache || []).find(x => x.id === row.role_id);
    label = "@" + (r?.name || r?.role || "Unknown role");
    dotColor = r?.color || "#99aab5";
  } else {
    const m = (serverMembers || []).find(x => x.username === row.username);
    const display = m?.profile_display_name || row.username;
    label = display + (display !== row.username ? " (" + row.username + ")" : "");
  }

  el.innerHTML = `
    <div class="cp-row-label">
      <span class="cp-role-dot" style="background:${escapeHTML(dotColor)};"></span>
      <span class="cp-name">${escapeHTML(label)}</span>
    </div>
    ${triStateHTML("View", "can_view", row.can_view)}
    ${triStateHTML("Send", "can_send", row.can_send)}
    ${triStateHTML("Manage", "can_manage", row.can_manage)}
    <button class="cp-row-remove" type="button" title="Remove override">×</button>
  `;

  // Wire tri-state buttons
  el.querySelectorAll(".cp-tri-state").forEach(group => {
    const field = group.dataset.field;
    group.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.value;
        const cur = _cpModalState.rows.get(key);
        if (!cur) return;
        cur[field] = (v === "allow") ? true : (v === "deny") ? false : null;
        group.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });

  el.querySelector(".cp-row-remove").addEventListener("click", () => {
    const cur = _cpModalState.rows.get(key);
    if (!cur) return;
    if (cur._isNew) _cpModalState.rows.delete(key);
    else cur._toDelete = true;
    renderCpRows();
    populateCpAddSelects();
  });

  return el;
}

function triStateHTML(label, field, value) {
  const allowActive = value === true ? "active" : "";
  const denyActive = value === false ? "active" : "";
  const defActive = (value === null || value === undefined) ? "active" : "";
  return `
    <div class="cp-perm-control">
      <label>${label}</label>
      <div class="cp-tri-state" data-field="${field}">
        <button type="button" class="cp-deny ${denyActive}" data-value="deny" title="Deny">✕</button>
        <button type="button" class="cp-default ${defActive}" data-value="default" title="Default">/</button>
        <button type="button" class="cp-allow ${allowActive}" data-value="allow" title="Allow">✓</button>
      </div>
    </div>
  `;
}

async function saveChannelPermsModal() {
  const channelId = _cpModalState.channelId;
  if (!channelId) return;
  const saveBtn = document.getElementById("channelPermsSave");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

  try {
    const inserts = [];
    const updates = [];
    const deleteIds = [];

    _cpModalState.rows.forEach(row => {
      if (row._toDelete) {
        if (row._id) deleteIds.push(row._id);
        return;
      }
      const payload = {
        channel_id: channelId,
        role_id: row.role_id || null,
        username: row.username || null,
        can_view: row.can_view,
        can_send: row.can_send,
        can_manage: row.can_manage
      };
      if (row._id) updates.push({ id: row._id, ...payload });
      else inserts.push(payload);
    });

    const ops = [];
    if (deleteIds.length) ops.push(supabaseClient.from("channel_permissions").delete().in("id", deleteIds));
    updates.forEach(u => {
      const { id, ...rest } = u;
      ops.push(supabaseClient.from("channel_permissions").update(rest).eq("id", id));
    });
    if (inserts.length) ops.push(supabaseClient.from("channel_permissions").insert(inserts));

    const results = await Promise.all(ops);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;

    await loadChannelPermissionsForServer();
    renderChannelList();
    closeChannelPermsModal();
    if (typeof showToast === "function") showToast("✅ Channel permissions saved.");
  } catch (err) {
    console.error("❌ saveChannelPermsModal:", err);
    alert("❌ Failed to save: " + (err.message || err));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Changes"; }
  }
}

// Wire UI once on load
(function wireChannelPermsModal() {
  function init() {
    const closeBtn = document.getElementById("channelPermsClose");
    const cancelBtn = document.getElementById("channelPermsCancel");
    const saveBtn = document.getElementById("channelPermsSave");
    const overlay = document.getElementById("channelPermsModal");
    const addRoleBtn = document.getElementById("cpAddRoleBtn");
    const addMemBtn = document.getElementById("cpAddMemberBtn");

    if (!overlay) return;

    if (closeBtn) closeBtn.addEventListener("click", closeChannelPermsModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeChannelPermsModal);
    if (saveBtn) saveBtn.addEventListener("click", saveChannelPermsModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeChannelPermsModal(); });

    document.querySelectorAll(".cp-tab").forEach(t => {
      t.addEventListener("click", () => cpSwitchTab(t.dataset.cpTab));
    });

    if (addRoleBtn) addRoleBtn.addEventListener("click", () => {
      const sel = document.getElementById("cpAddRoleSelect");
      const v = sel.value;
      if (!v) return;
      const key = v === "__everyone__" ? "everyone" : "role:" + v;
      if (_cpModalState.rows.has(key)) {
        const existing = _cpModalState.rows.get(key);
        if (existing._toDelete) existing._toDelete = false;
      } else {
        _cpModalState.rows.set(key, {
          _id: null,
          role_id: v === "__everyone__" ? null : v,
          username: null,
          can_view: null, can_send: null, can_manage: null,
          _isNew: true, _toDelete: false
        });
      }
      sel.value = "";
      populateCpAddSelects();
      renderCpRows();
    });

    if (addMemBtn) addMemBtn.addEventListener("click", () => {
      const sel = document.getElementById("cpAddMemberSelect");
      const v = sel.value;
      if (!v) return;
      const key = "user:" + v;
      if (_cpModalState.rows.has(key)) {
        const existing = _cpModalState.rows.get(key);
        if (existing._toDelete) existing._toDelete = false;
      } else {
        _cpModalState.rows.set(key, {
          _id: null,
          role_id: null,
          username: v,
          can_view: null, can_send: null, can_manage: null,
          _isNew: true, _toDelete: false
        });
      }
      sel.value = "";
      populateCpAddSelects();
      renderCpRows();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

async function getMemberPermissions(serverId, memberId) {
  const { data: roleLinks, error } = await supabase
    .from("server_member_roles")
    .select(`
      role_id,
      server_roles (
        permissions
      )
    `)
    .eq("server_id", serverId)
    .eq("member_id", memberId);

  if (error) {
    console.error(error);
    return {};
  }

  const finalPerms = {};

  for (const link of roleLinks || []) {
    const perms = link.server_roles?.permissions || {};

    for (const key in perms) {
      if (perms[key] === true) {
        finalPerms[key] = true;
      }
    }
  }

  return finalPerms;
}