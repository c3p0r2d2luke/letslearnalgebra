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
    .select("username, blocked, muted_until, avatar_url, user_system_roles (role)")
    .eq("auth_id", authId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) {
    const roles = existing.user_system_roles;
    existing.sys_admin = Array.isArray(roles)
      ? roles.some(r => r?.role === "SysAdmin")
      : roles?.role === "SysAdmin";
    existing.sys_manager = Array.isArray(roles)
      ? roles.some(r => r?.role === "SysManager")
      : roles?.role === "SysManager";
    return existing;
  }

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
  if (authHandling) {
    console.log("Auth success already being handled — skipping duplicate event.");
    return;
  }
  authHandling = true;

  try {
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
    await waitForGlobalFunction("loadUser", 10000);
    const loadUserFn = window["loadUser"];
    if (typeof loadUserFn !== "function") {
      console.error("[auth] loadUser did not become available after waiting.");
      return;
    }
    await loadUserFn();
    subscribeToGlobalMentions();
  } finally {
    authHandling = false;
  }

    // ── TUTORIAL: show only on first-ever login ──
  // We check whether this auth_id has ever been seen before.
  // If userData was just created (no previous login), it's a new user.
  const isNewUser = !localStorage.getItem("lla_seen_before_" + user.id);
  if (isNewUser) {
    localStorage.setItem("lla_seen_before_" + user.id, "1");
    // Small delay so the app has finished rendering before we spotlight things
    setTimeout(() => startTutorial(), 800);
  }
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

async function waitForGlobalFunction(name, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window[name] === "function") return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

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
    let authUser = session?.user;

    if (!authUser) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      authUser = user;
      if (authUser) {
        console.log("✅ Restored auth user from getUser()");
      }
    }

    if (authUser) {
      await handleAuthSuccess(authUser);
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
let typingSubscription = null;
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
  try {
    // Resolve relative URLs and safely set/replace the cache-bust `t` param
    const resolved = new URL(url, window.location.href);
    resolved.searchParams.set('t', String(Date.now()));
    return resolved.href;
  } catch (e) {
    // Fallback: simple append
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}t=${Date.now()}`;
  }
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
    // Normalize and safely set src
    try {
      const safe = new URL(avatarUrl, window.location.href).href;
      img.src = safe;
    } catch (e) {
      img.src = encodeURI(avatarUrl);
    }
    img.onerror = () => {
      // Fallback: try removing query params and retry once
      try {
        const short = (new URL(img.src)).origin + (new URL(img.src)).pathname;
        if (short && short !== img.src) {
          img.onerror = null;
          img.src = short;
          return;
        }
      } catch (e) {}
      // Clear cached broken avatar to avoid repeated failing requests
      try { setAvatarUrl(usernameValue, ""); } catch (e) {}
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

  const nameDisplay = document.getElementById("userPanelUsername");
  if (nameDisplay) {
    nameDisplay.textContent = displayLabel;
  }

  // Remove existing fallback or image inside profileBtn
  const oldFallback = btn.querySelector(".avatar-fallback");
  if (oldFallback) oldFallback.remove();
  const oldImg = btn.querySelector(".avatar-image");
  if (oldImg) oldImg.remove();
  btn.classList.remove("has-image");

  const fallback = document.createElement("span");
  fallback.className = "avatar-fallback";
  fallback.textContent = getInitials(displayLabel);
  btn.insertBefore(fallback, btn.firstChild);

  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "avatar-image";
    img.alt = `${displayLabel} avatar`;
    img.src = avatarUrl;
    img.onload = () => btn.classList.add("has-image");
    img.onerror = () => {
      // Clear cached broken avatar for current user
      try { setAvatarUrl(username, ""); } catch (e) {}
      img.remove();
      btn.classList.remove("has-image");
    };
    btn.insertBefore(img, btn.firstChild);
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
    const iconUrl = (function() {
      try { return new URL('/logo.png', window.location.href).href; } catch (e) { return '/logo.png'; }
    })();

    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Notifications enabled", {
        body: "Local notification test successful.",
        tag: "local-notification-test",
        icon:  iconUrl,
        badge: iconUrl,
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
      .order("inserted_at", { ascending: false });

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
const supabaseKey = "sb_publishable_pAump1Ft6WZgP1bakuvBbg_PpfVxxHD"; 
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    console.log('Supabase auth state changed:', event);
    try {
      await handleAuthSuccess(session.user);
    } catch (err) {
      console.error('Auth state handler failed:', err);
    }
    return;
  }

  if (event === 'SIGNED_OUT') {
    console.log('Supabase auth state changed:', event);
    showAuthGate();
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
  
  // 1. Define Base Permissions for standard roles (Fallback only)
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

  // 2. CRITICAL: If customPerms exist, they OVERRULE the base completely.
  // We do NOT merge; we REPLACE the base with the custom role's definition.
  if (customPerms && typeof customPerms === "object") {
    // Start with a clean slate or the base, then apply custom.
    // To ensure custom roles rule, we start with base and overwrite EVERYTHING custom says.
    // However, to be safe, let's start with base and let customPerms override specific keys.
    // If you want custom roles to be ENTIRELY independent, uncomment the line below:
    // basePerms = { ...customPerms }; 
    
    // Better approach: Start with base, then apply custom. 
    // If customPerms has a key, it wins. If not, basePerms wins.
    Object.entries(customPerms).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        basePerms[key] = value;
      }
    });
  } else {
    // 3. If NO custom role, apply hardcoded logic based on role name
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


