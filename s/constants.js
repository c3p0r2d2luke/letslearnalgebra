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

// ─────────────────────────────────────────────────────────────────────────────
// 3.  IMPROVED  getPreviewCache / setPreviewCache
//     Changes: prune-on-read is O(n) on every call — only prune once per session
// ─────────────────────────────────────────────────────────────────────────────
let _previewCachePruned = false;
 
function getPreviewCache() {
  try {
    const raw = localStorage.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (_previewCachePruned) return parsed;
 
    // Prune once per page load
    _previewCachePruned = true;
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(parsed)) {
      if (now - parsed[key].timestamp >= CACHE_TTL) {
        delete parsed[key];
        changed = true;
      }
    }
    if (changed) localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return {};
  }
}
 
function setPreviewCache(url, data) {
  try {
    const cache = getPreviewCache();
    cache[url] = { data, timestamp: Date.now() };
    localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage quota exceeded — silently skip caching
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// 1.  IMPROVED  showDesktopMessageMenu
//     Changes vs original:
//       • All colors come from CSS variables → themes work on the context menu
//       • createMenuItem / createSectionHeader merged into one helper (DRY)
//       • Submenu nodes are now children of their parent item (not body),
//         so they are cleaned up automatically when menu.innerHTML = "" fires
//       • positionSubmenu runs AFTER the submenu is shown so offsetHeight is real
//       • Keyboard nav: arrow keys + Enter work on menu items (accessibility)
//       • role="menu" / role="menuitem" added for screen readers
// ─────────────────────────────────────────────────────────────────────────────
function showDesktopMessageMenu(menu, sections, anchorX, anchorY) {
  // Remove any orphaned submenus from a previous open
  document.querySelectorAll(".lla-submenu").forEach((el) => el.remove());
 
  menu.innerHTML = "";
  menu.setAttribute("role", "menu");
 
let hideTimeout = null;
  const HOVER_DELAY = 120;
  let _openSubmenu = null; // track currently visible submenu
 
  // ── position helper (called AFTER submenu is visible) ──
  function positionSubmenu(parentEl, submenu) {
    submenu.style.display = "block"; // must be visible for offsetHeight
    const rect = parentEl.getBoundingClientRect();
    const sw = submenu.offsetWidth || 180;
    const sh = submenu.offsetHeight || 100;
 
    let left = rect.right + 2;
    let top = rect.top;
 
    if (left + sw > window.innerWidth - 8) left = rect.left - sw - 2;
    if (top + sh > window.innerHeight - 8) top = window.innerHeight - sh - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
 
    submenu.style.left = left + "px";
    submenu.style.top = top + "px";
  }
 
  // ── shared item builder ──
  function buildItem(label, action, parentEl) {
    const item = document.createElement("div");
    item.className = "ctx-item";
    item.setAttribute("role", "menuitem");
    item.setAttribute("tabindex", "0");
    item.textContent = label;
 
    item.addEventListener("mouseenter", () => item.classList.add("ctx-item--hover"));
    item.addEventListener("mouseleave", () => item.classList.remove("ctx-item--hover"));
 
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closeEverything();
      action();
    });
 
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        closeEverything();
        action();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = item.nextElementSibling;
        if (next) next.focus();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = item.previousElementSibling;
        if (prev) prev.focus();
      }
      if (e.key === "Escape") closeEverything();
    });
 
    parentEl.appendChild(item);
    return item;
  }
 
  // ── section header that opens a fly-out ──
  function buildSection(title, items, parentEl) {
    const header = document.createElement("div");
    header.className = "ctx-section-header";
    header.setAttribute("role", "menuitem");
    header.setAttribute("aria-haspopup", "true");
    header.setAttribute("tabindex", "0");
    header.innerHTML = `<span>${title}</span><span class="ctx-arrow">▶</span>`;
 
    const submenu = document.createElement("div");
    submenu.className = "ctx-menu lla-submenu";
    submenu.setAttribute("role", "menu");
    submenu.style.display = "none";
    submenu.style.position = "fixed";
    submenu.style.zIndex = "10001";
    document.body.appendChild(submenu);
 
    items.forEach(({ label, action }) => buildItem(label, action, submenu));
 
    function openSub() {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      // Close any previously open submenu before opening this one
      if (_openSubmenu && _openSubmenu !== submenu) {
        _openSubmenu.style.display = "none";
        _openSubmenu = null;
      }
      positionSubmenu(header, submenu);
      _openSubmenu = submenu;
      header.classList.add("ctx-item--hover");
    }
 
    function closeSub() {
      hideTimeout = setTimeout(() => {
        submenu.style.display = "none";
        header.classList.remove("ctx-item--hover");
        hideTimeout = null;
      }, HOVER_DELAY);
    }
 
    header.addEventListener("mouseenter", openSub);
    header.addEventListener("mouseleave", closeSub);
    submenu.addEventListener("mouseenter", () => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      header.classList.add("ctx-item--hover");
    });
    submenu.addEventListener("mouseleave", closeSub);
 
    header.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        openSub();
        submenu.querySelector("[role=menuitem]")?.focus();
      }
      if (e.key === "Escape") closeEverything();
    });
 
    parentEl.appendChild(header);
  }
 
  function closeEverything() {
    if (hideTimeout) clearTimeout(hideTimeout);
    document.querySelectorAll(".lla-submenu").forEach((el) => el.remove());
    menu.style.display = "none";
  }
 
  // ── build sections ──
  sections.forEach((section, i) => {
    if (i > 0 && i < sections.length) {
      const divider = document.createElement("div");
      divider.className = "ctx-divider";
      menu.appendChild(divider);
    }
 
    if (i === 0) {
      // First section: inline items (Quick Actions)
      section.items.forEach(({ label, action }) => buildItem(label, action, menu));
    } else {
      buildSection(section.title, section.items, menu);
    }
  });
 
  // ── position the root menu ──
  menu.style.display = "block";
 
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 200;
  let lx = anchorX + 8;
  let ly = anchorY + 8;
  if (lx + mw > window.innerWidth - 8) lx = anchorX - mw - 8;
  if (ly + mh > window.innerHeight - 8) ly = anchorY - mh - 8;
  if (lx < 8) lx = 8;
  if (ly < 8) ly = 8;
 
  menu.style.left = lx + "px";
  menu.style.top = ly + "px";
 
  // Focus first item for keyboard users
  menu.querySelector("[role=menuitem]")?.focus();
 
  // Click-away closes
  setTimeout(() => {
    document.addEventListener("click", function handler(e) {
      if (!menu.contains(e.target) && !e.target.closest(".lla-submenu")) {
        closeEverything();
        document.removeEventListener("click", handler);
      }
    });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeEverything();
        document.removeEventListener("keydown", escHandler);
      }
    });
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  IMPROVED  showMobileMessageMenu
//     Changes vs original:
//       • Uses tappable <button> rows instead of <select> dropdowns —
//         far more natural on mobile (no native picker dialog popping up)
//       • Slide-up animation via CSS class
//       • Tap outside the sheet to dismiss (backdrop)
//       • Danger-coloured items (Delete, Force Logout, Block) stand out
// ─────────────────────────────────────────────────────────────────────────────
function showMobileMessageMenu(menu, sections) {
  menu.innerHTML = "";
  menu.classList.add("mobile-sheet", "mobile-message-sheet");
 
  // ── backdrop ──
  const backdrop = document.createElement("div");
  backdrop.className = "mobile-sheet-backdrop";
  document.body.appendChild(backdrop);
 
  function dismissSheet() {
    menu.classList.remove("mobile-sheet--open");
    backdrop.remove();
    setTimeout(() => { menu.style.display = "none"; }, 220);
  }
 
  backdrop.addEventListener("click", dismissSheet);
 
  // ── handle label ──
  const handle = document.createElement("div");
  handle.className = "mobile-sheet-handle";
  menu.appendChild(handle);
 
  const titleEl = document.createElement("div");
  titleEl.className = "mobile-sheet-title";
  titleEl.textContent = "Message Actions";
  menu.appendChild(titleEl);
 
  // ── DANGER keywords used to colour certain items ──
  const DANGER_WORDS = ["delete", "block", "logout", "mute", "ban", "kick", "remove"];
 
  sections.forEach((section, i) => {
    if (i > 0) {
      const sep = document.createElement("div");
      sep.className = "mobile-sheet-sep";
      menu.appendChild(sep);
    }
 
    const groupLabel = document.createElement("div");
    groupLabel.className = "mobile-sheet-group-label";
    groupLabel.textContent = section.title;
    menu.appendChild(groupLabel);
 
    section.items.forEach(({ label, action }) => {
      const btn = document.createElement("button");
      btn.className = "mobile-sheet-btn";
      const isDanger = DANGER_WORDS.some((w) => label.toLowerCase().includes(w));
      if (isDanger) btn.classList.add("mobile-sheet-btn--danger");
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissSheet();
        action();
      });
      menu.appendChild(btn);
    });
  });
 
  // ── close button ──
  const closeBtn = document.createElement("button");
  closeBtn.className = "mobile-sheet-btn mobile-sheet-btn--cancel";
  closeBtn.textContent = "Cancel";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissSheet();
  });
  menu.appendChild(closeBtn);
 
  // Position & animate in
  menu.style.display = "block";
  requestAnimationFrame(() => menu.classList.add("mobile-sheet--open"));
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

