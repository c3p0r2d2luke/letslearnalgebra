/* script.js
   Integrates Supabase Google sign-in with the chatroom, and contains the chat logic.
   Paste this file at the site root (e.g. /script.js) and include it from your HTML as:
   <script src="/script.js"></script>
*/

"use strict";

/* === CONFIG === */
const SUPABASE_URL = "https://qjajtkdchvapthnidtwj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1HWGEhoX-b4jj05hDKsGYw_H004LgVz";

/* === CLIENT INIT === */
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* === DOM REFS === */
const googleSignInBtn = document.getElementById("googleSignIn");
const signOutBtn = document.getElementById("signOut");
const signedInAs = document.getElementById("signedInAs");

const input = document.getElementById("messageInput");
const button = document.getElementById("sendButton");
const messagesList = document.getElementById("messages");
const logBox = document.getElementById("logBox");

const namePrompt = document.getElementById("namePrompt");
const nameInput = document.getElementById("nameInput");
const saveNameBtn = document.getElementById("saveNameButton");

/* === STATE === */
let username = localStorage.getItem("chatUsername") || "";
let currentRole = localStorage.getItem("chatRole") || "User";
const messagesMap = new Map();
let channel = null;
let openControl = null; // currently open admin/manager control container

/* === UTILS === */
function log(msg, obj = null, type = "info") {
  const el = document.createElement("div");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (logBox) {
    logBox.appendChild(el);
    logBox.scrollTop = logBox.scrollHeight;
  }
  if (obj) console[type === "error" ? "error" : "log"](msg, obj);
}

/* Close any open admin/manager control */
function closeOpenControl() {
  if (openControl) {
    openControl.style.display = "none";
    openControl = null;
  }
}

/* Single global click handler to close open controls */
document.addEventListener("click", () => {
  closeOpenControl();
});

/* === AUTH FLOW === */

// Called after successful sign-in (session.user present)
async function onSignIn(supabaseUser) {
  const nameFromAuth = supabaseUser?.user_metadata?.name || supabaseUser?.email || "";
  username = nameFromAuth;
  localStorage.setItem("chatUsername", username);

  // Upsert user row (so role row exists)
  try {
    await supabaseClient
      .from("users")
      .upsert({ username, email: supabaseUser.email }, { onConflict: ["username"] });
    // Fetch role (exact match)
    const { data: userData } = await supabaseClient
      .from("users")
      .select("role")
      .eq("username", username)
      .maybeSingle();
    currentRole = userData?.role || "User";
    localStorage.setItem("chatRole", currentRole);
  } catch (err) {
    console.error("Failed to upsert/fetch user", err);
    currentRole = "User";
    localStorage.setItem("chatRole", "User");
  }

  // Update UI
  if (namePrompt) namePrompt.style.display = "none";
  if (googleSignInBtn) googleSignInBtn.style.display = "none";
  if (signOutBtn) signOutBtn.style.display = "inline-block";
  if (signedInAs) signedInAs.textContent = `Signed in as ${username} (${currentRole})`;
  if (logBox) logBox.style.display = currentRole === "Admin" ? "block" : "none";

  // Enable controls
  const controls = document.getElementById("controls");
  if (controls) controls.classList.add("visible");
  input.disabled = false;
  button.disabled = false;

  // Start chat
  await loadMessages();
  initRealtime();
}

function onSignOut() {
  localStorage.removeItem("chatUsername");
  localStorage.removeItem("chatRole");
  username = "";
  currentRole = "User";

  if (googleSignInBtn) googleSignInBtn.style.display = "inline-block";
  if (signOutBtn) signOutBtn.style.display = "none";
  if (signedInAs) signedInAs.textContent = "";
  if (namePrompt) namePrompt.style.display = "none";

  const controls = document.getElementById("controls");
  if (controls) controls.classList.remove("visible");
  input.disabled = true;
  button.disabled = true;

  if (channel) {
    try { supabaseClient.removeChannel(channel); } catch (e) {}
    channel = null;
  }
}

/* Init auth state and react to changes */
(async function initAuth() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user) {
      await onSignIn(session.user);
    } else {
      // show sign in option if present
      if (googleSignInBtn) googleSignInBtn.style.display = "inline-block";
      if (signOutBtn) signOutBtn.style.display = "none";
      // optionally show name prompt as fallback; we keep it hidden by default
    }
  } catch (err) {
    console.error("Auth initialization error", err);
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session?.user) onSignIn(session.user);
    else onSignOut();
  });
})();

/* Button handlers for sign in / sign out (if those elements exist) */
if (googleSignInBtn) {
  googleSignInBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
  });
}
if (signOutBtn) {
  signOutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    onSignOut();
  });
}

/* === CHAT LOGIC === */

/* Name fallback locking */
function updateMessageLock() {
  const hasName = (nameInput && nameInput.value?.trim().length > 0) || username;
  input.disabled = !hasName;
  button.disabled = !hasName;
}
if (nameInput) nameInput.addEventListener("input", updateMessageLock);
updateMessageLock();

/* Realtime */
function initRealtime() {
  if (channel) return;
  channel = supabaseClient.channel("messages-channel")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
      handleRealtimeMessage(payload.new || payload.record, payload.eventType);
      log(`📡 Live update: ${payload.eventType}`);
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED") log("✅ Subscribed to live updates");
      else if (status === "CLOSED") log("🔴 Connection closed");
    });
}

/* Load messages once */
async function loadMessages() {
  const { data, error } = await supabaseClient.from("messages").select("*").order("inserted_at", { ascending: true });
  if (error) return log("❌ Failed to load messages", error, "error");
  messagesList.innerHTML = "";
  messagesMap.clear();
  data.forEach(msg => renderMessage(msg));
  log("✅ Messages loaded");
}

/* Save name fallback */
async function saveName() {
  const name = nameInput.value.trim();
  if (!name) return alert("Enter a name!");
  username = name;
  localStorage.setItem("chatUsername", name);

  try {
    await supabaseClient
      .from("users")
      .upsert({ username: name }, { onConflict: ['username'] })
      .select();

    const { data: userData } = await supabaseClient
      .from("users")
      .select("role")
      .eq("username", name)
      .maybeSingle();

    currentRole = userData?.role || "User";
    localStorage.setItem("chatRole", currentRole);
  } catch (err) {
    console.error(err);
    currentRole = "User";
    localStorage.setItem("chatRole", "User");
  }

  if (namePrompt) namePrompt.style.display = "none";
  const controls = document.getElementById("controls");
  if (controls) controls.classList.add("visible");
  input.disabled = false;
  button.disabled = false;

  await loadMessages();
  initRealtime();

  if (logBox) logBox.style.display = currentRole === "Admin" ? "block" : "none";
  updateMessageLock();
  alert(`Welcome, ${name}! You are a ${currentRole}.`);
}
if (saveNameBtn) saveNameBtn.addEventListener("click", saveName);

/* Send message */
async function sendMessage() {
  const content = input.value.trim();
  if (!content || !username) return;

  // Check if the user is blocked
  const { data: user } = await supabaseClient.from("users").select("blocked").eq("username", username).maybeSingle();
  if (user?.blocked) {
    alert("❌ You are blocked from sending messages.");
    return;
  }

  let ip = "unknown";
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    ip = data.ip || "unknown";
  } catch {}

  try {
    const { data: insertResult, error } = await supabaseClient.from("messages")
      .insert([{ username, content, role: currentRole, is_pinned: false, ip }])
      .select();
    if (error) throw error;
    input.value = "";
    log("✅ Message sent to Supabase");
  } catch (e) {
    log("❌ Failed to send message", e, "error");
  }
}
if (button) button.addEventListener("click", sendMessage);
if (input) input.addEventListener("keypress", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

/* Render a message (creates li once, updates in-place) */
function renderMessage(msg) {
  if (!msg || !msg.id) return;
  let li = messagesMap.get(msg.id);
  const viewerRole = currentRole;

  if (!li) {
    li = document.createElement("li");
    messagesMap.set(msg.id, li);
    messagesList.appendChild(li);

    // li click toggles any attached control but stops propagation so document click won't close immediately
    li.addEventListener("click", (e) => { e.stopPropagation(); });
  }

  li.innerHTML = "";
  li.className = "";
  if (msg.role === "Admin") li.classList.add("admin");
  else if (msg.role === "Manager") li.classList.add("manager");
  li.dataset.pinned = msg.is_pinned ? "true" : "false";
  li.style.border = msg.is_pinned ? "2px solid red" : "";

  // Username
  const uname = document.createElement("div");
  uname.className = "username";
  uname.textContent = msg.username === "Frenchwizz" ? "Takeo" : msg.username;
  li.appendChild(uname);

  // Content (text only — avoids stored XSS)
  const contentDiv = document.createElement("div");
  contentDiv.className = "content";
  contentDiv.textContent = msg.content;
  li.appendChild(contentDiv);

  // Admin controls container
  const adminDiv = document.createElement("div");
  adminDiv.className = "adminControls";
  adminDiv.style.display = "none";

  if (viewerRole === "Admin") {
    // Delete
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (li.dataset.pinned === "true") return alert("Cannot delete pinned message.");
      try {
        await supabaseClient.from("messages").delete().eq("id", msg.id);
        li.remove();
        messagesMap.delete(msg.id);
        log(`🗑 Deleted message id=${msg.id}`);
      } catch (err) {
        log("❌ Delete failed", err, "error");
      }
    };
    adminDiv.appendChild(delBtn);

    // Edit
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.onclick = async (e) => {
      e.stopPropagation();
      const newText = prompt("Edit message:", msg.content);
      if (!newText) return;
      try {
        await supabaseClient.from("messages").update({ content: newText }).eq("id", msg.id);
        msg.content = newText;
        contentDiv.textContent = newText;
        log(`✏️ Edited message id=${msg.id}`);
      } catch (err) {
        log("❌ Edit failed", err, "error");
      }
    };
    adminDiv.appendChild(editBtn);

    // Change name
    const nameBtn = document.createElement("button");
    nameBtn.textContent = "Change Name";
    nameBtn.onclick = async (e) => {
      e.stopPropagation();
      const newName = prompt("New username for " + msg.username + ":", msg.username);
      if (!newName) return;
      try {
        await supabaseClient.from("users").upsert({ username: newName });
        await supabaseClient.from("messages").update({ username: newName }).eq("username", msg.username);
        uname.textContent = newName;
        log(`🔁 Changed username ${msg.username} → ${newName}`);
      } catch (err) {
        log("❌ Change name failed", err, "error");
      }
    };
    adminDiv.appendChild(nameBtn);

    // Block/unblock
    const blockBtn = document.createElement("button");
    blockBtn.className = "blockBtn";
    blockBtn.textContent = msg.blocked ? "Unblock" : "Block";
    blockBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const newBlocked = !msg.blocked;
        await supabaseClient.from("users").update({ blocked: newBlocked }).eq("username", msg.username);
        msg.blocked = newBlocked;
        blockBtn.textContent = newBlocked ? "Unblock" : "Block";
        log(`${newBlocked ? "🔒 Blocked" : "🔓 Unblocked"} ${msg.username}`);
      } catch (err) {
        log("❌ Block toggle failed", err, "error");
      }
    };
    adminDiv.appendChild(blockBtn);

    // Force logout
    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Force Logout";
    logoutBtn.onclick = async (e) => {
      e.stopPropagation();
      if (msg.username === username) return alert("Cannot logout yourself.");
      try {
        await supabaseClient.from("users").update({ forceLogout: true }).eq("username", msg.username);
        log(`🔌 Forced logout for ${msg.username}`);
      } catch (err) {
        log("❌ Force logout failed", err, "error");
      }
    };
    adminDiv.appendChild(logoutBtn);

    // Mute
    const muteBtn = document.createElement("button");
    muteBtn.textContent = "Mute 5min";
    muteBtn.onclick = (e) => {
      e.stopPropagation();
      const mutedUsers = (window.__mutedUsers = window.__mutedUsers || {});
      mutedUsers[msg.username] = Date.now() + 5 * 60 * 1000;
      log(`🔇 Muted ${msg.username} for 5 minutes`);
    };
    adminDiv.appendChild(muteBtn);

    // Export
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export Chat";
    exportBtn.onclick = (e) => {
      e.stopPropagation();
      const data = Array.from(messagesList.querySelectorAll("li")).map(liItem => ({
        username: liItem.querySelector(".username")?.textContent,
        content: liItem.querySelector(".content")?.textContent
      }));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "chat.json";
      a.click();
      log("📦 Exported chat.json");
    };
    adminDiv.appendChild(exportBtn);

    // Delete by keyword
    const massDelBtn = document.createElement("button");
    massDelBtn.textContent = "Delete by Keyword";
    massDelBtn.onclick = async (e) => {
      e.stopPropagation();
      const keyword = prompt("Enter keyword to delete:");
      if (!keyword) return;
      try {
        const { data } = await supabaseClient.from("messages").select("*");
        const ids = data.filter(m => m.content?.includes(keyword)).map(m => m.id);
        await supabaseClient.from("messages").delete().in("id", ids);
        document.querySelectorAll("#messages li").forEach(liItem => {
          if (liItem.querySelector(".content")?.textContent.includes(keyword)) liItem.remove();
        });
        log(`🧹 Deleted all messages containing "${keyword}"`);
      } catch (err) {
        log("❌ Mass delete failed", err, "error");
      }
    };
    adminDiv.appendChild(massDelBtn);

    // Delete user & messages (nuke)
    const nukeBtn = document.createElement("button");
    nukeBtn.textContent = "Delete User & Messages";
    nukeBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${msg.username} and all their messages?`)) return;
      try {
        await supabaseClient.from("messages").delete().eq("username", msg.username);
        await supabaseClient.from("users").delete().eq("username", msg.username);
        document.querySelectorAll("#messages li").forEach(liItem => {
          if (liItem.querySelector(".username")?.textContent === msg.username) liItem.remove();
        });
        log(`💣 Nuked ${msg.username}`);
      } catch (err) {
        log("❌ Nuke failed", err, "error");
      }
    };
    adminDiv.appendChild(nukeBtn);

    // Info
    const infoBtn = document.createElement("button");
    infoBtn.textContent = "User Info";
    infoBtn.onclick = (e) => {
      e.stopPropagation();
      alert(`Username: ${msg.username}\nRole: ${msg.role}\nIP: ${msg.ip}\nID: ${msg.id}`);
    };
    adminDiv.appendChild(infoBtn);

    // Promote/demote
    const promoteManagerBtn = document.createElement("button");
    promoteManagerBtn.textContent = "Promote → Manager";
    promoteManagerBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await supabaseClient.from("users").upsert({ username: msg.username, role: "Manager" });
        log(`👑 Promoted ${msg.username} to Manager`);
        await loadMessages();
      } catch (err) { log("❌ Promote failed", err, "error"); }
    };
    adminDiv.appendChild(promoteManagerBtn);

    const promoteAdminBtn = document.createElement("button");
    promoteAdminBtn.textContent = "Promote → Admin";
    promoteAdminBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await supabaseClient.from("users").upsert({ username: msg.username, role: "Admin" });
        log(`👑 Promoted ${msg.username} to Admin`);
        await loadMessages();
      } catch (err) { log("❌ Promote failed", err, "error"); }
    };
    adminDiv.appendChild(promoteAdminBtn);

    const demoteBtn = document.createElement("button");
    demoteBtn.textContent = "Demote → User";
    demoteBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await supabaseClient.from("users").upsert({ username: msg.username, role: "User" });
        log(`🔻 Demoted ${msg.username} to User`);
        await loadMessages();
      } catch (err) { log("❌ Demote failed", err, "error"); }
    };
    adminDiv.appendChild(demoteBtn);

    // Pin / Unpin
    const pinBtn = document.createElement("button");
    pinBtn.textContent = msg.is_pinned ? "Unpin" : "Pin";
    pinBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const isPinned = li.dataset.pinned === "true";
        await supabaseClient.from("messages").update({ is_pinned: !isPinned }).eq("id", msg.id);
        li.dataset.pinned = !isPinned ? "true" : "false";
        li.style.border = !isPinned ? "2px solid red" : "";
        pinBtn.textContent = !isPinned ? "Unpin" : "Pin";
        log(`${!isPinned ? "📌 Pinned" : "❌ Unpinned"} message id=${msg.id}`);
        if (!isPinned) messagesList.insertBefore(li, messagesList.firstChild);
        else await loadMessages();
      } catch (err) {
        log("❌ Pin toggle failed", err, "error");
      }
    };
    adminDiv.appendChild(pinBtn);
  }

  li.appendChild(adminDiv);

  /* Manager controls (only visible to Manager role) */
  if (viewerRole === "Manager") {
    const managerDiv = document.createElement("div");
    managerDiv.className = "managerControls";
    managerDiv.style.display = "none";

    // Delete own messages only
    const mDel = document.createElement("button");
    mDel.textContent = "Delete";
    mDel.onclick = async (e) => {
      e.stopPropagation();
      if (msg.username !== username) return alert("You can only delete your own messages.");
      try {
        await supabaseClient.from("messages").delete().eq("id", msg.id);
        li.remove();
        messagesMap.delete(msg.id);
        log(`🗑 Deleted your message id=${msg.id}`);
      } catch (err) {
        log("❌ Delete failed", err, "error");
      }
    };
    managerDiv.appendChild(mDel);

    // Report: inserts report row and sends EmailJS (best-effort)
    const reportBtn = document.createElement("button");
    reportBtn.textContent = "Report";
    reportBtn.onclick = async (e) => {
      e.stopPropagation();
      window.__lastReportTime = window.__lastReportTime || {};
      const now = Date.now();
      const cooldownMs = 30 * 1000;
      if (window.__lastReportTime[username] && now - window.__lastReportTime[username] < cooldownMs) {
        return alert("Please wait a bit before reporting again.");
      }
      const reason = prompt("Optional: provide a reason for reporting this message:");
      if (reason === null) return;
      reportBtn.disabled = true;
      try {
        let reporterName = username;
        try {
          const { data: { user } = {} } = await supabaseClient.auth.getUser();
          reporterName = user?.user_metadata?.name || user?.email || reporterName;
        } catch (err) {
          console.warn("Could not get auth user:", err);
        }
        const reportPayload = {
          reporter: reporterName,
          reported_user: msg.username,
          message_id: msg.id ?? null,
          content: msg.content ?? null,
          reason: reason || null
        };
        const { data: inserted, error: insertError } = await supabaseClient.from("reports").insert([reportPayload]).select().maybeSingle();
        if (insertError) throw insertError;
        log(`✅ Report inserted id=${inserted?.id || '(unknown)'}`);
        // attempt email send via emailjs if available
        const templateParams = {
          reporter: reporterName,
          reported_user: msg.username,
          message_content: msg.content,
          message_id: String(msg.id || ''),
          reason: reason || '',
          created_at: new Date().toISOString(),
          url: window.location.href
        };
        try {
          if (window.emailjs && typeof window.emailjs.send === "function") {
            await emailjs.send("service_fkhhdph", "template_kc760ra", templateParams);
            log("✉️ Email sent via EmailJS");
            if (inserted?.id) {
              await supabaseClient.from("reports").update({ email_sent: true }).eq("id", inserted.id);
            }
            alert("🚨 Message reported. Admins have been notified.");
          } else {
            log("⚠️ emailjs not available, report saved but no email sent");
            alert("Reported — admins can review the report in the admin panel.");
          }
        } catch (emailErr) {
          console.error("EmailJS send failed", emailErr);
          log("❌ EmailJS send failed", emailErr, "error");
          alert("Reported — failed to send notification email. Admins can still review the report in the admin panel.");
        }

        window.__lastReportTime[username] = now;
        log(`🚨 Report logged id=${inserted?.id} by ${reporterName}`);
      } catch (err) {
        console.error(err);
        log("❌ Report failed", err, "error");
        alert("Failed to submit report. Try again later.");
      } finally {
        reportBtn.disabled = false;
      }
    };
    managerDiv.appendChild(reportBtn);

    li.appendChild(managerDiv);

    // Attach click toggles for manager/admin controls
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      // toggle managerDiv specifically
      const isOpen = managerDiv.style.display === "flex";
      closeOpenControl();
      managerDiv.style.display = isOpen ? "none" : "flex";
      openControl = isOpen ? null : managerDiv;
    });
  }

  // Admin controls toggle (if viewer is admin)
  if (viewerRole !== "User") {
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = adminDiv.style.display === "flex";
      closeOpenControl();
      adminDiv.style.display = isOpen ? "none" : "flex";
      openControl = isOpen ? null : adminDiv;
    });
  }
}

/* Realtime message handling */
function handleRealtimeMessage(newMsg, eventType) {
  if (!newMsg) return;

  if (eventType === "INSERT") renderMessage(newMsg);
  else if (eventType === "UPDATE") {
    renderMessage(newMsg);
    const li = messagesMap.get(newMsg.id);
    if (li) {
      const blockBtn = li.querySelector(".blockBtn");
      if (blockBtn) blockBtn.textContent = newMsg.blocked ? "Unblock" : "Block";
    }
    if (newMsg.username === username && typeof newMsg.blocked !== "undefined") {
      input.disabled = newMsg.blocked;
      button.disabled = newMsg.blocked;
      if (newMsg.blocked) alert("❌ You have been blocked by an admin!");
    }
  } else if (eventType === "DELETE") {
    const existing = messagesMap.get(newMsg.id);
    if (existing) { existing.remove(); messagesMap.delete(newMsg.id); }
    if (newMsg.username === username && newMsg.forceLogout) {
      alert("⚠️ You have been forcefully logged out by an admin!");
      localStorage.removeItem("chatUsername");
      localStorage.removeItem("chatRole");
      supabaseClient.from("users").update({ forceLogout: false }).eq("username", username)
        .then(() => location.reload());
    }
  }
}

/* Secret sign-out shortcut */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    localStorage.removeItem("chatUsername");
    localStorage.removeItem("chatRole");

    alert("👋 You have been signed out!");
    if (namePrompt) namePrompt.style.display = "block";
    input.disabled = true;
    button.disabled = true;
    if (nameInput) nameInput.value = "";
    currentRole = null;

    if (logBox) logBox.style.display = "none";

    updateMessageLock();
    if (saveNameBtn) saveNameBtn.onclick = saveName;
  }
});