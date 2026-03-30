/* global supabase, requestAnimationFrame, localStorage, console, alert, prompt, confirm, fetch, document, window, Date, Blob, URL, Notification, emailjs, TextEncoder, crypto */
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
  } else {
    alert("❌ Wrong password");
  }
});

let channels = [];
let currentChannelId = null;
let isBlocked = false;
let mutedUntil = null;
let muteInterval = null;
const threadMap = new Map(); // parentId → { parent, replies }
const messageDataMap = new Map(); // id → full message object
const NO_EMBED_PHRASE = "potatoheadman";
const input = document.getElementById("messageInput");
const button = document.getElementById("sendButton");
const messagesList = document.getElementById("messages");
const logBox = document.getElementById("logBox");
const threadsContainer = document.getElementById("threadsContainer");
logBox.style.display = "none";

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ======================== TAB SYSTEM ========================
let currentTab = "messages";

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const tabName = tab.dataset.tab;
    currentTab = tabName;

    // Update active tab styling
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    // Update panes
    document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));
    document.getElementById(`${tabName}-pane`).classList.add("active");

    // Refresh threads view if switching to threads
    if (tabName === "threads") {
      
    }
  });
});

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

// ------------------------ Logging ------------------------
function log(msg, obj = null, type = "info") {
  const el = document.createElement("div");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logBox.appendChild(el);
  logBox.scrollTop = logBox.scrollHeight;
  if (obj) console[type === "error" ? "error" : "log"](msg, obj);
}

// ------------------------ Realtime ------------------------
let channel = null;
function initRealtime() {
  if (channel) return;
  channel = supabaseClient.channel("messages-channel")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => handleRealtimeMessage(payload.new, "INSERT"))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, payload => handleRealtimeMessage(payload.new, "UPDATE"))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, payload => handleRealtimeMessage(payload.old, "DELETE"))
    .subscribe(status => {
      log(`Channel status: ${status}`);
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

async function loadChannels() {
  const { data, error } = await supabaseClient
    .from("channels")
    .select("*")
    .order("name");

  if (error) {
    console.error(error);
    return;
  }

  channels = data;

  channelList.innerHTML = "";

  data.forEach(ch => {
    const div = document.createElement("div");
    div.textContent = "# " + ch.name;
    div.className = "channel";
    div.dataset.id = ch.id;

    div.onclick = () => switchChannel(ch.id);

    channelList.appendChild(div);
  });

  if (data.length > 0) {
    switchChannel(data[0].id);
  }
}

function switchChannel(channelId) {
  currentChannelId = channelId;

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

  messagesList.innerHTML = "";
  messagesMap.clear();

  loadMessages();
}

// ------------------------ Load Messages ------------------------
async function loadMessages() {
  if (!currentChannelId) return;

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("channel_id", currentChannelId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  renderMessage(data);
}

function buildInitialThreads() {
  messageDataMap.forEach(msg => {
    if (msg.is_thread && msg.reply_to) {
      if (!threadMap.has(msg.reply_to)) {
        threadMap.set(msg.reply_to, { parent: null, replies: [] });
      }
      threadMap.get(msg.reply_to).replies.push(msg);
    } else {
      // parent message
      if (threadMap.has(msg.id)) {
        threadMap.get(msg.id).parent = msg;
      }
    }
  });
}

// ------------------------ Auto-load saved name ------------------------
async function loadUser() {
  const storedName = localStorage.getItem("chatUsername");
  if (!storedName) {
    namePrompt.style.display = "block";
    input.disabled = true;
    button.disabled = true;
    return;
  }

  nameInput.value = storedName;
  namePrompt.style.display = "none";
  const controls = document.getElementById("controls");
  controls.classList.add("visible");
  input.disabled = false;
  button.disabled = false;

try {
  const { data, error } = await supabaseClient
    .from("users")
    .select("role, blocked, muted_until")
    .eq("username", storedName)
    .single();

isBlocked = data?.blocked || false;
mutedUntil = data?.muted_until || null;

  if (error) {
    console.error("Failed to fetch user role:", error);
    currentRole = "User";
    localStorage.setItem("chatRole", "User");
  } else {
    currentRole = data?.role || "User";
    localStorage.setItem("chatRole", currentRole);
  }
} catch (err) {
  console.error("Exception fetching user:", err);
  currentRole = "User";
  localStorage.setItem("chatRole", "User");
}

  logBox.style.display = currentRole === "Admin" ? "block" : "none";

  loadMessages();
  initRealtime();
  watchForceLogout(storedName);
  subscribeToUserStatus();
applyMuteBlockUI();
loadChannels();
loadDefaultChannel();
}

loadUser().then(() => {
  console.log("Final role:", currentRole);
  console.log("Username:", username);
});

// ------------------------ Save Name ------------------------
async function saveName() {
  const name = nameInput.value.trim();
  if (!name) return alert("❌ Enter a name first!");

  username = name;
  localStorage.setItem("chatUsername", name);

  alert(`📝 Starting save for: ${name}`);

  try {
    // First check if user exists
    const { data: existingUser, error: checkError } = await supabaseClient
      .from("users")
      .select("role")
      .eq("username", name)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      alert(`⚠️ Check error: ${checkError.message}`);
      console.error("Check error:", checkError);
    }

    alert(`🔍 User exists: ${existingUser ? 'YES' : 'NO'}`);

    // If user exists, update role; if not, insert with default role
    const { data, error } = await supabaseClient
      .from("users")
      .upsert({ 
        username: name,
        role: existingUser?.role || "User"
      }, { 
        onConflict: ['username']
      })
      .select("role");

    if (error) {
      alert(`❌ UPSERT FAILED!\n\nError: ${error.message}\n\nCheck your Supabase RLS policies!`);
      console.error("Failed to save user:", error);
      currentRole = "User";
    } else {
      alert(`✅ UPSERT SUCCESS!\n\nRole: ${data?.[0]?.role || "User"}`);
      currentRole = data?.[0]?.role || "User";
    }

    localStorage.setItem("chatRole", currentRole);
    alert(`💾 Saved to localStorage - Role: ${currentRole}`);

  } catch (err) {
    alert(`💥 EXCEPTION CAUGHT!\n\n${err.message}`);
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

  logBox.style.display = currentRole === "Admin" ? "block" : "none";

  updateMessageLock();
  alert(`🎉 Welcome, ${name}! You are a ${currentRole}.`);
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
  let content = input.value.trim();
  if (!content || !username) return;

if (isUserBlockedOrMutedSync()) {
  alert("❌ You cannot send messages.");
  return;
}

  if (currentRole !== "Admin" && containsPlainTextUrl(content)) {
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
    if (threadReplyingTo) {
      messageData.reply_to = threadReplyingTo;
      messageData.is_thread = true;
    } else if (replyingTo) {
      messageData.reply_to = replyingTo;
    }

    const { error } = await supabaseClient.from("messages").insert([messageData]);
    if (!error) {
      input.value = "";
      log("✅ Message sent to Supabase");

    // 🔥 ADD THIS - Scroll to bottom after sending
    setTimeout(() => {
      messagesList.scrollTop = messagesList.scrollHeight;
    }, 100);

      if (threadReplyingTo) {
  clearThreadReply();

  if (currentTab === "threads") {
    renderSingleThread(threadReplyingTo);
  }

} else if (replyingTo) {
  clearReply();
}
    
      // --- Push Notification Logic (Admin Broadcast) ---
      const isImportant = currentRole === "Admin" && content.includes("!important!");
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

      if (currentTab === "threads") {
        
      }
    }
  } catch (e) {
    log("❌ Failed to send message", e, "error");
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

  // Thread replies only appear in the Threads tab, not the main channel
  if (msg.is_thread) return;

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

   // --- Username ---
  const uname = document.createElement("div");
  uname.className = "username";
  uname.textContent = msg.username === "Frenchwizz" ? "Takeo" : msg.username;
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
    wrapper.innerHTML = `
      <img src="${url}" 
           style="max-width:300px;border-radius:8px;cursor:pointer;">
    `;
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

  if (currentRole === "Admin") li.appendChild(adminDiv);
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
    updateThreadForMessage(newMsg);
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
    updateThreadForMessage(newMsg);
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

    removeThreadMessage(newMsg.id);
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
    if (logBox) logBox.style.display = "none";
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
  if (picker && !picker.contains(e.target) && !e.target.classList.contains("emoji-trigger")) {
    picker.style.display = "none";
  }
});

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
      .single();

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
      "YOUR_SERVICE_ID",     // replace
      "YOUR_TEMPLATE_ID",    // replace
      {
        reporter: reportData.reporter,
        offender: reportData.reported_user,
        message: reportData.content,
        reason: reportData.reason,
        message_id: reportData.message_id,
        time: new Date().toLocaleString()
      },
      "YOUR_PUBLIC_KEY"      // replace
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
      .single();

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

  if (currentRole !== "Admin" && !(currentRole === "Manager" && author === username)) {
    alert("❌ Access Denied: You can only delete your own messages.");
    return;
  }

  try {
    // 🧠 1. Get message FIRST (so we know if it has a file)
    const { data: msg, error: fetchError } = await supabaseClient
      .from("messages")
      .select("content")
      .eq("id", messageId)
      .single();

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
      .single();

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
      .single();

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
      bubble.textContent = `${emoji} ${info.count}`;
      bubble.title = info.users.join(", ");
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


// ---------------- THREAD REPLIES ----------------

let replyingTo = null;
let threadReplyingTo = null;

function clearReply() {
  replyingTo = null;
  document.getElementById("replyBanner").style.display = "none";
  input.placeholder = "Message #general";
}

function clearThreadReply() {
  threadReplyingTo = null;
  document.getElementById("threadBanner").style.display = "none";
  input.placeholder = "Message #general";
}

async function startReply(messageId) {
  if (isUserBlockedOrMutedSync()) {
  alert("❌ You are muted.");
  return;
}
  clearThreadReply();
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

async function startThread(messageId) {
  if (isUserBlockedOrMutedSync()) {
  alert("❌ You are muted.");
  return;
}
  clearReply();
  threadReplyingTo = messageId;

  const li = messagesMap.get(Number(messageId));
  if (!li) return;

  const author = li.dataset.user === "Frenchwizz" ? "Takeo" : li.dataset.user;
  const content = li.querySelector(".content")?.textContent || "";

  document.getElementById("threadBannerText").textContent =
    `${author}: ${content.substring(0, 50)}${content.length > 50 ? "…" : ""}`;
  document.getElementById("threadBanner").style.display = "flex";
  input.placeholder = "Reply in thread…";
  input.focus();
}

// Cancel buttons and Escape key
document.getElementById("cancelReplyBtn").addEventListener("click", clearReply);
document.getElementById("cancelThreadBtn").addEventListener("click", clearThreadReply);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    clearReply();
    clearThreadReply();
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
  controls.style.position = "absolute";
  controls.style.right = "10px";
  controls.style.top = "5px";
  controls.style.display = "none";
  controls.style.zIndex = "1000"; // Ensure it's on top

  // React Button (Triggers Picker)
  const reactBtn = document.createElement("button");
  reactBtn.textContent = "😀";
  reactBtn.className = "emoji-trigger";
  reactBtn.style.background = "transparent";
  reactBtn.style.border = "none";
  reactBtn.style.cursor = "pointer";
  reactBtn.style.fontSize = "18px";

  reactBtn.onclick = (e) => {
    e.stopPropagation();
    const picker = document.getElementById("emojiPicker");
    if (!picker) return;
    picker.style.position = "fixed";
    picker.style.top = "50%";
    picker.style.left = "50%";
    picker.style.transform = "translate(-50%, -50%)";
    picker.dataset.targetMessageId = msg.id;
    picker.style.display = "block";
  };

  const replyBtn = document.createElement("button");
  replyBtn.textContent = "↩";
  replyBtn.style.background = "transparent";
  replyBtn.style.border = "none";
  replyBtn.style.cursor = "pointer";
  replyBtn.style.fontSize = "18px";
  replyBtn.onclick = () => startReply(msg.id);

  controls.appendChild(reactBtn);
  controls.appendChild(replyBtn);

  li.style.position = "relative";
  li.appendChild(controls);

  li.addEventListener("mouseenter", () => {
    controls.style.display = "block";
  });

  li.addEventListener("mouseleave", () => {
    controls.style.display = "none";
  });
}

// Handle Emoji Selection from Picker
document.querySelectorAll(".emoji-option").forEach(option => {
  option.addEventListener("click", function() {
    const picker = document.getElementById("emojiPicker");
    const messageId = picker.dataset.targetMessageId;
    const emoji = this.textContent;

    if (messageId && emoji) {
      addReaction(messageId, emoji);
      picker.style.display = "none";
    }
  });
});

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

async function getAllThreads() {
  // Only fetch messages explicitly marked as thread replies
  const { data: threadReplies } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("is_thread", true)
    .order("inserted_at", { ascending: true });

  if (!threadReplies || threadReplies.length === 0) return [];

  const parentIds = [...new Set(threadReplies.map(r => r.reply_to))].filter(Boolean);
  if (parentIds.length === 0) return [];

  const { data: parents } = await supabaseClient
    .from("messages")
    .select("*")
    .in("id", parentIds);

  if (!parents) return [];

  const parentMap = {};
  parents.forEach(p => { parentMap[p.id] = p; });

  const threads = {};
  threadReplies.forEach(r => {
    if (!r.reply_to || !parentMap[r.reply_to]) return;
    if (!threads[r.reply_to]) {
      threads[r.reply_to] = { parent: parentMap[r.reply_to], replies: [] };
    }
    threads[r.reply_to].replies.push(r);
  });

  return Object.values(threads).filter(t => t.parent);
}

async function renderAllThreads() {
  threadsContainer.innerHTML = "";
  const threads = await getAllThreads();

  if (threads.length === 0) {
    threadsContainer.innerHTML = `
      <p style="color: var(--text-muted); padding: 16px; text-align: center;">
        No threads yet.<br>
        Right-click any message and choose <strong>Reply in Thread</strong> to start one.
      </p>`;
    return;
  }

  threads.forEach(thread => {
    const threadEl = document.createElement("div");
    threadEl.className = "thread-item";

    const count = thread.replies.length;
    const parentText = thread.parent.content.substring(0, 80) +
      (thread.parent.content.length > 80 ? "…" : "");

    // Clickable header — expands/collapses replies
    const headerDiv = document.createElement("div");
    headerDiv.className = "thread-header";
    headerDiv.innerHTML = `
      <div style="flex:1; min-width:0;">
        <span class="reply-author">${escapeHTML(displayName(thread.parent.username))}</span>
        <span style="color:var(--text-muted); font-weight:400;"> — ${escapeHTML(parentText)}</span>
      </div>
      <div class="thread-reply-count">${count} ${count === 1 ? "reply" : "replies"} ▾</div>
    `;

    // Replies panel (hidden by default)
    const repliesDiv = document.createElement("div");
    repliesDiv.className = "thread-replies";
    repliesDiv.style.display = "none";

    thread.replies.forEach(reply => {
      const replyEl = document.createElement("div");
replyEl.className = "thread-reply";

// 🔥 ADD THIS
replyEl.dataset.id = reply.id;
replyEl.dataset.user = reply.username;
      replyEl.innerHTML = `
        <div class="reply-author">${escapeHTML(displayName(reply.username))}</div>
        <div>${escapeHTML(reply.content)}</div>
      `;
      repliesDiv.appendChild(replyEl);
    });

    // Toggle on click
    headerDiv.style.cursor = "pointer";
    headerDiv.addEventListener("click", () => {
      const isOpen = repliesDiv.style.display !== "none";
      repliesDiv.style.display = isOpen ? "none" : "block";
      headerDiv.querySelector(".thread-reply-count").textContent =
        `${count} ${count === 1 ? "reply" : "replies"} ${isOpen ? "▾" : "▴"}`;
    });

    threadEl.appendChild(headerDiv);
    threadEl.appendChild(repliesDiv);
    threadsContainer.appendChild(threadEl);
  });
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
      ip: "unknown" // You could fetch IP here if needed
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

    log("✅ File uploaded successfully");

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
    .select("username")
    .eq("typing", true)
    .then(({ data }) => {
      if (!data) {
        box.textContent = "";
        return;
      }

      const typingUsers = data
        .filter(u => u.username !== username)
        .map(u => u.username);

      box.textContent = typingUsers.length > 0 
        ? `${typingUsers.join(", ")} typing...` 
        : "";
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

document.addEventListener("click", (e) => {
  if (e.target.tagName === "IMG") {
    const src = e.target.src;
    const overlay = document.createElement("div");

    overlay.style.position = "fixed";
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.background = "rgba(0,0,0,0.8)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    overlay.innerHTML = `<img src="${src}" style="max-width: 90%; max-height: 90%;">`;

    overlay.onclick = () => overlay.remove();

    document.body.appendChild(overlay);
  }
});

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

function refreshUI() {
  if (currentTab === "threads") {
    
  } else {
    // main chat already updates incrementally
    // but you *can* force consistency if needed:
    // messagesList.innerHTML = "";
    // messagesMap.clear();
    // loadMessages();
  }
}

function updateThreadForMessage(msg) {
  if (!msg.reply_to && !msg.is_thread) {
    // this is a parent message
    if (!threadMap.has(msg.id)) {
      threadMap.set(msg.id, { parent: msg, replies: [] });
    } else {
      threadMap.get(msg.id).parent = msg;
    }
    return;
  }

  if (!msg.reply_to) return;

  if (!threadMap.has(msg.reply_to)) {
    threadMap.set(msg.reply_to, { parent: null, replies: [] });
  }

  const thread = threadMap.get(msg.reply_to);

  if (msg.is_thread) {
    const existingIndex = thread.replies.findIndex(r => r.id === msg.id);

    if (existingIndex !== -1) {
      thread.replies[existingIndex] = msg;
    } else {
      thread.replies.push(msg);
    }

    if (currentTab === "threads") {
      renderSingleThread(msg.reply_to);
    }
  }
}

function removeThreadMessage(messageId) {
  threadMap.forEach((thread, parentId) => {
    thread.replies = thread.replies.filter(r => r.id !== messageId);

    if (thread.parent?.id === messageId) {
      threadMap.delete(parentId);
      removeThreadFromUI(parentId);
    } else {
      if (currentTab === "threads") {
        renderSingleThread(parentId);
      }
    }
  });
}

function renderSingleThread(parentId) {
  const thread = threadMap.get(parentId);
  if (!thread || !thread.parent) return;

  let existing = document.querySelector(`[data-thread-id="${parentId}"]`);

  if (!existing) {
    existing = document.createElement("div");
    existing.className = "thread-item";
    existing.dataset.threadId = parentId;
    threadsContainer.appendChild(existing);
  }

  existing.innerHTML = "";

  const header = document.createElement("div");
  header.className = "thread-header";
  header.textContent = `${thread.parent.username}: ${thread.parent.content}`;

  existing.appendChild(header);

  thread.replies.forEach(reply => {
    const replyEl = document.createElement("div");
    replyEl.className = "thread-reply";
    replyEl.dataset.id = reply.id;
    replyEl.dataset.user = reply.username;
    replyEl.textContent = reply.content;

    existing.appendChild(replyEl);
  });
}

function removeThreadFromUI(parentId) {
  const el = document.querySelector(`[data-thread-id="${parentId}"]`);
  if (el) el.remove();
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

document.addEventListener("contextmenu", (e) => {
  const message = e.target.closest("[data-id]");
  if (!message) return; // Only trigger on messages

  e.preventDefault();

  const menu = document.getElementById("adminMenu");
  if (!menu) return;

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
  addButton("Reply in Thread", () => startThread(messageId));

  addButton("React", () => {
    const picker = document.getElementById("emojiPicker");
    if (!picker) return;

    picker.style.position = "fixed";
    picker.style.top = e.clientY + 10 + "px";
    picker.style.left = e.clientX + 10 + "px";
    picker.dataset.targetMessageId = messageId;
    picker.style.display = "block";
  });

  addButton("Report", () => reportMessage(messageId));

  // ================= ROLE-BASED =================
  if (currentRole === "Manager" && author === username) {
    addSection("Manager");
    addButton("Delete My Message", () => deleteMessage(messageId));
  }

  if (currentRole === "Admin") {
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
    addButton("Mute User", () => muteUser(author));
    addButton("Block User", () => blockUser(author));
    addButton("Unblock User", () => unblockUser(author));
    addButton("Force Logout", () => forceLogout(author));
  }

  // ================= SCREEN BOUNDARY DETECTION =================
  const menuWidth = 200; // Approximate width including padding
  const menuHeight = 300; // Approximate height - adjust based on actual content
  const submenuWidth = 180;
  
  let leftPos = e.clientX + 10;
  let topPos = e.clientY + 10;
  
  // Check if menu would go off right edge
  if (leftPos + menuWidth > window.innerWidth) {
    leftPos = e.clientX - menuWidth - 10;
  }
  
  // Check if menu would go off bottom edge
  if (topPos + menuHeight > window.innerHeight) {
    topPos = e.clientY - menuHeight - 10;
  }
  
  // Ensure we don't go off left/top edges either
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
});

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
    .single();

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
  const sendBtn = document.getElementById("sendBtn");

  const muted = mutedUntil && new Date(mutedUntil) > new Date();

  if (isBlocked) {
    input.disabled = true;
    sendBtn.disabled = true;
    input.placeholder = "🚫 You are blocked";
    return;
  }

  if (muted) {
    input.disabled = true;
    sendBtn.disabled = true;
    startMuteCountdownUI();
    return;
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.placeholder = "Type a message...";
  stopMuteCountdownUI();
}
document.getElementById("createChannelBtn").onclick = async () => {
  if (currentRole !== "Admin") {
    alert("❌ Only admins can create channels");
    return;
  }

  const name = prompt("Channel name:");
  if (!name) return;

  const { error } = await supabaseClient
    .from("channels")
    .insert({
      name,
      created_by: username
    });

  if (error) {
    alert("❌ Failed: " + error.message);
  } else {
    loadChannels();
  }
};

async function loadDefaultChannel() {
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("name", "general")
    .single();

  if (error) {
    console.error("Channel load error:", error);
    return;
  }

  currentChannelId = data.id;

  document.getElementById("currentChannelName").textContent =
    "# " + data.name;

  loadMessages(); // 👈 IMPORTANT
}
// ======================== END FEATURES ========================