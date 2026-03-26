/* global requestAnimationFrame, localStorage, console, alert, prompt, confirm, fetch, document, window, NodeFilter, Date, Blob, URL */
const NO_EMBED_PHRASE = "potatoheadman";
const input = document.getElementById("messageInput");
const button = document.getElementById("sendButton");
const messagesList = document.getElementById("messages");
const logBox = document.getElementById("logBox");
const threadsContainer = document.getElementById("threadsContainer");
logBox.style.display = "none";

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
      renderAllThreads();
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

// ------------------------ Load Messages ------------------------
async function loadMessages() {
  const { data, error } = await supabaseClient.from("messages").select("*").order("inserted_at",{ascending:true});
  if (error) return log("❌ Failed to load messages", error, "error");
  data.forEach(msg => renderMessage(msg));
  log("✅ Messages loaded");
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
    .select("role, blocked")
    .eq("username", storedName)
    .single();

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

// ------------------------ Send Message ------------------------
async function sendMessage() {
  let content = input.value.trim();
  if (!content || !username) return;

  if (currentRole !== "Admin" && containsPlainTextUrl(content)) {
    alert("❌ Only admins are allowed to send links.");
    return;
  }

  const { data: user } = await supabaseClient.from("users").select("blocked").eq("username", username).single();
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
    const messageData = { username, content, role: currentRole, is_pinned: false, ip };
    
    // Include reply_to field if replying to another message
    if (replyingTo) {
      messageData.reply_to = replyingTo;
    }
    
    const { error } = await supabaseClient.from("messages").insert([messageData]);
    if (!error) {
      input.value = "";
      log("✅ Message sent to Supabase");
      
      // Reset reply text
      if (replyingTo) {
        replyingTo = null;
        input.placeholder = "Message #general";
      }

      const isImportant = currentRole === "Admin" && content.includes("!important!");
      fetch("https://qjajtkdchvapthnidtwj.supabase.co/functions/v1/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: isImportant ? "🚨 IMPORTANT ANNOUNCEMENT" : "New message",
          body: `${username}: ${content.replace("!important!", "")}`,
          important: isImportant
        })
      });
      
      // Refresh threads view if currently viewing threads
      if (currentTab === "threads") {
        renderAllThreads();
      }
    }
  } catch (e) {
    log("❌ Failed to send message", e, "error");
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
  let li = messagesMap.get(msg.id);
  const viewerRole = currentRole;

  if (!li) {
    li = document.createElement("li");
    messagesMap.set(msg.id, li);
    messagesList.appendChild(li);
  }

  li.innerHTML = "";
  li.className = "";
  li.dataset.id = msg.id;
  li.dataset.user = msg.username;
  if (msg.role === "Admin") li.classList.add("admin");
  else if (msg.role === "Manager") li.classList.add("manager");
  li.dataset.pinned = msg.is_pinned ? "true" : "false";
  li.style.border = msg.is_pinned ? "2px solid red" : "";

  const uname = document.createElement("div");
  uname.className = "username";
  uname.textContent = msg.username === "Frenchwizz" ? "Takeo" : msg.username;
  li.appendChild(uname);

  const contentDiv = document.createElement("div");
  contentDiv.className = "content";
  if (msg.role === "Admin") {
const wrapper = document.createElement("div");
const cleanContent = msg.content.replaceAll(NO_EMBED_PHRASE, "");

// Match: [📄 filename](url)
const fileMatch = cleanContent.match(/\[📄 (.*?)\]\((.*?)\)/);

if (fileMatch) {
  let fileName = fileMatch[1];
  let url = fileMatch[2].trim();

  // 🔧 Fix your broken URLs (this was your original bug)
  url = url.replace(/[)\]\s]+$/, "");

  const type = getFileType(url);

  console.log("Fixed URL:", url);
  console.log("Type:", type);

  // 💥 FULL REPLACEMENT — no text, no preview, JUST media
  if (type === "image") {
    wrapper.innerHTML = `
      <img src="${url}" style="max-width: 300px; border-radius: 8px; cursor: pointer;">
    `;
  } 
  else if (type === "video") {
    wrapper.innerHTML = `
      <video controls style="max-width: 300px; border-radius: 8px;">
        <source src="${url}">
      </video>
    `;
  } 
  else if (type === "audio") {
    wrapper.innerHTML = `
      <audio controls>
        <source src="${url}">
      </audio>
    `;
  } 
  else {
    wrapper.innerHTML = `
      <a href="${url}" target="_blank">📄 ${fileName}</a>
    `;
  }

} else {
  // Normal text message
  wrapper.textContent = cleanContent;
}

contentDiv.appendChild(wrapper);

    const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, null);
    let foundUrl = null;
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue;
      const match = text.match(/\bhttps?:\/\/[^\s<]+/);
      if (match) { foundUrl = match[0]; break; }
    }

    const skipEmbed = msg.content.includes(NO_EMBED_PHRASE);
    if (foundUrl && !skipEmbed) {
      buildLinkPreview(foundUrl).then(preview => {
        if (preview) contentDiv.appendChild(document.createRange().createContextualFragment(preview));
      });
    }
  } else {
    const wrapper = document.createElement("div");
    const cleanContent = msg.content.replaceAll(NO_EMBED_PHRASE, "");
const fileMatch = cleanContent.match(/\[📄 (.*?)\]\((.*?)\)/);

let url = fileMatch[2].trim();

// Remove trailing ) or weird characters
url = url.replace(/[)\]\s]+$/, "");

if (fileMatch) {
  const fileName = fileMatch[1];
  const url = fileMatch[2];

  const type = getFileType(url);

console.log("URL:", url);
console.log("Detected type:", type);

  if (type === "image") {
    wrapper.innerHTML = `
      <img src="${url}" style="max-width: 300px; border-radius: 8px; cursor: pointer;">
    `;
  } 
  else if (type === "video") {
    wrapper.innerHTML = `
      <video controls style="max-width: 300px; border-radius: 8px;">
        <source src="${url}">
      </video>
    `;
  } 
  else if (type === "audio") {
    wrapper.innerHTML = `
      <audio controls>
        <source src="${url}">
      </audio>
    `;
  } 
  else {
    wrapper.innerHTML = `
      <a href="${url}" target="_blank">📄 ${fileName}</a>
    `;
  }

} else {
  wrapper.textContent = cleanContent;
}    contentDiv.appendChild(wrapper);
  }
  li.appendChild(contentDiv);

  // Add reply context if this message is a reply
  if (msg.reply_to) {
    supabaseClient
      .from("messages")
      .select("username, content")
      .eq("id", msg.reply_to)
      .single()
      .then(({ data: parentMsg }) => {
        if (parentMsg) {
          const replyContext = document.createElement("div");
          replyContext.className = "replyContext";
          
          const author = parentMsg.username === "Frenchwizz" ? "Takeo" : parentMsg.username;
          const content = parentMsg.content.substring(0, 50);
          
          replyContext.innerHTML = `
            <div class="replyContextContent">
              <div class="replyContextAuthor">${author}</div>
              <div>$${content}$${parentMsg.content.length > 50 ? "..." : ""}</div>
            </div>
          `;
          
          li.style.position = "relative";
          li.appendChild(replyContext);
        }
      });
  }

  // ---------------- Admin / Manager Controls ----------------
  const adminDiv = document.createElement("div");
  adminDiv.className = "adminControls";
  adminDiv.style.display = "none";

  const managerDiv = document.createElement("div");
  managerDiv.className = "managerControls";
  managerDiv.style.display = "none";

async function forceLogout(user) {

  if (!confirm(`Force logout ${user}?`)) return;

  try {

    await supabaseClient
      .from("users")
      .update({ forceLogout: true })
      .eq("username", user);

    alert(`${user} will be logged out.`);

  } catch (err) {
    console.error("Force logout failed", err);
  }

}

async function changeName(user) {
  const newName = prompt(`Enter a new name for ${user}:`);
  if (!newName || newName === user) return;

  try {
    // 1️⃣ Update the username in the users table
    await supabaseClient
      .from("users")
      .update({ username: newName })
      .eq("username", user);

    // 2️⃣ Update all messages by that user
    await supabaseClient
      .from("messages")
      .update({ username: newName })
      .eq("username", user);

    // 3️⃣ Update messagesMap locally for live view
    messagesMap.forEach((el) => {
      if (el.dataset.user === user) {
        el.dataset.user = newName;
        const unameDiv = el.querySelector(".username");
        if (unameDiv) unameDiv.textContent = newName;
      }
    });

    // 4️⃣ Update localStorage if the admin is renaming themselves
    if (user === username) {
      username = newName;
      localStorage.setItem("chatUsername", newName);
    }

    alert(`Username changed from "${user}" to "${newName}"`);
  } catch (err) {
    console.error("Change name failed", err);
    alert("❌ Failed to change name.");
  }
}

async function exportChat() {

  try {

    const { data, error } = await supabaseClient
      .from("messages")
      .select("*");

    if (error) throw error;

    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "chat_export.json";
    a.click();

    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Export failed", err);
  }

}

async function deleteKeyword() {
  const keyword = prompt("Enter keyword to delete:");
  if (!keyword) return;

  try {
    // Use ilike for case-insensitive partial matching
    const { data, error } = await supabaseClient
      .from("messages")
      .select("id")
      .ilike("content", `%${keyword}%`); // ✅ Partial match

    if (error) throw error;

    if (!data.length) {
      alert("No messages found.");
      return;
    }

    if (!confirm(`Delete ${data.length} messages containing "${keyword}"?`)) return;

    // Delete each message individually with proper ID filter
    const ids = data.map(msg => msg.id);

const { error: deleteError } = await supabaseClient
  .from("messages")
  .delete()
  .in("id", ids);

if (deleteError) throw deleteError;

    // Remove from local cache
    data.forEach(msg => {
      const li = messagesMap.get(msg.id);
      if (li) li.remove();
    });

    alert(`✅ Deleted ${data.length} messages.`);
  } catch (err) {
    console.error("Delete keyword failed", err);
    alert("❌ Failed to delete messages.");
  }
}

async function deleteUser(user) {

  if (!confirm(`Delete ${user} and all their messages?`)) return;

  try {

    await supabaseClient
      .from("messages")
      .delete()
      .eq("username", user);

    await supabaseClient
      .from("users")
      .delete()
      .eq("username", user);

    messagesMap.forEach((el) => {
      if (el.dataset.user === user) el.remove();
    });

  } catch (err) {
    console.error("Delete user failed", err);
  }

}

async function promote(user) {

  const role = prompt("Set role (User / Manager / Admin):", "User");

  if (!role || !["User","Manager","Admin"].includes(role)) {
    alert("Invalid role.");
    return;
  }

  try {

    await supabaseClient
      .from("users")
      .update({ role })
      .eq("username", user);

    alert(`${user} is now ${role}`);

  } catch (err) {
    console.error("Role change failed", err);
  }

}

async function userInfo(user) {

  try {

    const { data } = await supabaseClient
  .from("users")
  .select("role")
  .eq("username", user)
  .single();

    if (!data) return alert("User not found.");

    alert(
      `User: ${user}
Role: ${data.role || "User"}
Blocked: ${data.blocked || false}
Muted Until: ${data.muted_until || "None"}`
    );

  } catch (err) {
    console.error("User info failed", err);
  }

}

  if(viewerRole === "Admin") li.appendChild(adminDiv);
  else if(viewerRole === "Manager") li.appendChild(managerDiv);

  // Right-click menu for Discord-style
  li.addEventListener("contextmenu", (e) => {
  const message = e.target.closest("li");
  if (!message) return;

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

    btn.onclick = () => {
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
    header.style.background = "transparent";

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

// Inside the contextmenu event listener, find this section:

// Basic actions (everyone)
addButton("Reply", () => startReply(messageId));

// ✅ Fixed React button - captures event coordinates properly
addButton("React", () => {
  const picker = document.getElementById("emojiPicker");
  if (!picker) {
    console.error("Emoji picker not found!");
    return;
  }

  // Use the original contextmenu event coordinates
  const x = e.clientX + 10;
  const y = e.clientY + 10;
  
  // Ensure picker stays within viewport bounds
  const pickerRect = picker.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Adjust if picker would go off-screen
  const adjustedX = x + pickerRect.width > viewportWidth ? x - pickerRect.width : x;
  const adjustedY = y + pickerRect.height > viewportHeight ? y - pickerRect.height : y;
  
  picker.style.position = "fixed";
  picker.style.top = adjustedY + "px";
  picker.style.left = adjustedX + "px";
  picker.style.zIndex = "9999"; // Make sure it's on top
  
  // Store the message ID on the picker
  picker.dataset.targetMessageId = messageId;
  
  picker.style.display = "block";
  
  // Focus the picker so keyboard navigation works
  picker.focus();
});

addButton("Report", () => reportMessage(messageId));

// Manager actions (only for managers on their own messages)
if (currentRole === "Manager" && author === username) {
  addSection("Manager");
  addButton("Delete My Message", () => deleteMessage(messageId));
}

  // Admin actions
  if (currentRole === "Admin") {

    addSection("Delete");
    addButton("Delete", () => deleteMessage(messageId));
    addButton("Delete By Keyword", () => deleteKeyword(message));
    addButton("Delete User + Messages", () => deleteUser(author));

    addSection("Info");
    addButton("User Info", () => userInfo(author));
    addButton("Export Chat", () => exportChat(message));

    addSection("Edit");
    addButton("Edit Message", () => editMessage(messageId));
    addButton("Change Name", () => changeName(author));
    addButton("Promote / Demote", () => promote(author));
    addButton("Mute User", () => muteUser(author));
    addButton("Block User", () => blockUser(author));
    addButton("Force Logout", () => forceLogout(author));
  }

  enhanceMessage(li, msg);

  menu.style.position = "fixed";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.style.background = "#2f3136";
  menu.style.border = "1px solid #444";
  menu.style.padding = "4px";
  menu.style.display = "block";
});

  // Use requestAnimationFrame to ensure DOM is stable before enhancing
  requestAnimationFrame(() => {
    enhanceMessage(li, msg);
  });
}

// ------------------------ Realtime Handler ------------------------
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
    if(newMsg.username === username && typeof newMsg.blocked !== "undefined") {
      input.disabled = newMsg.blocked;
      button.disabled = newMsg.blocked;
      if(newMsg.blocked) alert("❌ You have been blocked by an admin!");
    }
  }
  else if (eventType === "DELETE") {
    const existing = messagesMap.get(newMsg.id);
    if (existing) { existing.remove(); messagesMap.delete(newMsg.id); }
    if (newMsg.username === username && newMsg.forceLogout) {
      alert("⚠️ You have been forcefully logged out!");
      localStorage.removeItem("chatUsername");
      localStorage.removeItem("chatRole");
      supabaseClient.from("users").update({ forceLogout: false }).eq("username", username).then(() => location.reload());
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
        offender: reportData.offender,
        message: reportData.message,
        reason: reportData.reason,
        message_id: reportData.message_id,
        time: reportData.time
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

  // 1. STRICT ROLE CHECK (Client Side)
  if (currentRole !== "Admin") {
    alert("❌ Access Denied: Only Admins can delete messages.");
    return;
  }

  // 2. Perform the delete
  const { data, error } = await supabaseClient
    .from("messages")
    .delete()
    .eq("id", messageId)
    .select(); // Select to confirm deletion

  if (error) {
    console.error("Delete error:", error);
    alert(`❌ Delete failed: ${error.message}`);
  } else {
    // 3. Verify rows were actually deleted
    if (data && data.length > 0) {
      alert(`✅ Success! Deleted 1 message.`);
      // Remove from local cache
      const li = messagesMap.get(Number(messageId));
      if (li) {
        li.remove();
        messagesMap.delete(Number(messageId));
      }
    } else {
      // This happens if RLS blocks it (0 rows affected)
      alert("⚠️ Delete command sent, but 0 rows were affected. \nThis usually means RLS is blocking the delete.\n\nCheck your Supabase Policies.");
    }
  }
}


// Mute user
async function muteUser(user) {
  const minutes = prompt("Mute user for how many minutes?");
  if (!minutes) return;

  try {

    const muteUntil = new Date(Date.now() + minutes * 60000);

    await supabaseClient
      .from("users")
      .update({ muted_until: muteUntil })
      .eq("username", user);

    alert(`${user} muted for ${minutes} minutes.`);

  } catch (err) {
    console.error("Mute failed", err);
  }
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

// ======================== DISCORD STYLE FEATURES ========================


// ---------------- EDIT MESSAGE ----------------
async function editMessage(messageId) {

  const li = messagesMap.get(Number(messageId));
  if (!li) return;

  const contentEl = li.querySelector(".content");
  const oldText = contentEl.innerHTML;

  const newText = prompt("Edit message:", oldText);
  if (!newText || newText === oldText) return;

  try {

    const { error } = await supabaseClient
      .from("messages")
      .update({ content: newText })
      .eq("id", messageId);

    if (error) throw error;

  } catch (err) {
    console.error("Edit failed", err);
  }

}



// ---------------- REACTION BUBBLES ----------------

async function addReaction(messageId, emoji) {

  try {

    const { data } = await supabaseClient
      .from("reactions")
      .select("*")
      .eq("message_id", messageId)
      .eq("username", username)
      .eq("emoji", emoji)
      .single();

    if (data) {
      await supabaseClient
        .from("reactions")
        .delete()
        .eq("id", data.id);
      return;
    }

    await supabaseClient
      .from("reactions")
      .insert({
        message_id: messageId,
        username: username,
        emoji: emoji
      });

  } catch (err) {
    console.error("Reaction error", err);
  }

}



async function renderReactions(messageId, container) {
  // 1. Clear existing reactions to prevent duplicates on re-render
  const existingBar = container.querySelector(".reactionBar");
  if (existingBar) {
    existingBar.remove();
  }

  try {
    const { data, error } = await supabaseClient
      .from("reactions")
      .select("*")
      .eq("message_id", messageId);

    if (error) {
      console.error("Error fetching reactions:", error);
      return;
    }

    if (!data || data.length === 0) return;

    const reactionsMap = {};
    data.forEach(r => {
      if (!reactionsMap[r.emoji]) reactionsMap[r.emoji] = [];
      reactionsMap[r.emoji].push(r.username);
    });

    const wrap = document.createElement("div");
    wrap.className = "reactionBar";
    wrap.style.marginTop = "8px"; // Add some spacing
    wrap.style.display = "flex";
    wrap.style.gap = "8px";

    Object.entries(reactionsMap).forEach(([emoji, users]) => {
      const bubble = document.createElement("span");
      bubble.textContent = `${emoji} ${users.length}`;
      bubble.className = "reactionBubble";
      bubble.style.cursor = "pointer";
      bubble.style.padding = "4px 8px";
      bubble.style.borderRadius = "12px";
      bubble.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      bubble.style.fontSize = "14px";
      
      // Toggle reaction on click
      bubble.onclick = () => addReaction(messageId, emoji);

      wrap.appendChild(bubble);
    });

    container.appendChild(wrap);
  } catch (err) {
    console.error("Render reactions error", err);
  }
}



// ---------------- THREAD REPLIES ----------------

let replyingTo = null;

function startReply(messageId) {
  replyingTo = messageId;

  const li = messagesMap.get(Number(messageId));
  if (!li) return;

  const author = li.dataset.user;
  const content = li.querySelector(".content")?.innerHTML || "";

  input.value = `@${author} `;
  input.placeholder = `Replying to ${author}: ${content.substring(0, 40)}...`;
  input.focus();
}



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
  controls.style.zIndex = "1000";

  // React Button (Triggers Picker)
  const reactBtn = document.createElement("button");
  reactBtn.textContent = "😀"; // Icon for the button itself
  reactBtn.className = "emoji-trigger"; // Tag to prevent closing when clicking it
  reactBtn.style.background = "transparent";
  reactBtn.style.border = "none";
  reactBtn.style.cursor = "pointer";
  reactBtn.style.fontSize = "18px";
  
  reactBtn.onclick = (e) => {
    e.stopPropagation(); // Prevent immediate closure
    const picker = document.getElementById("emojiPicker");
    
    // Position picker near the button
    const rect = reactBtn.getBoundingClientRect();
    picker.style.top = (rect.bottom + 5) + "px";
    picker.style.left = rect.left + "px";
    picker.style.display = "block";
    
    // Store the message ID on the picker for the selection handler
    picker.dataset.targetMessageId = msg.id;
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

  renderReactions(msg.id, li);

}


// ======================== THREAD SYSTEM ========================

// Get all threads (messages with replies)
async function getAllThreads() {
  const { data: allMessages } = await supabaseClient
    .from("messages")
    .select("*")
    .order("inserted_at", { ascending: true });

  if (!allMessages) return [];

  // Group messages by reply_to
  const threads = {};
  allMessages.forEach(msg => {
    if (msg.reply_to) {
      if (!threads[msg.reply_to]) threads[msg.reply_to] = { parent: null, replies: [] };
      threads[msg.reply_to].replies.push(msg);
    }
  });

  // Get parent messages
  allMessages.forEach(msg => {
    if (threads[msg.id]) {
      threads[msg.id].parent = msg;
    }
  });

  return Object.values(threads).filter(t => t.parent);
}

// Render all threads in the threads tab
async function renderAllThreads() {
  threadsContainer.innerHTML = "";
  const threads = await getAllThreads();

  if (threads.length === 0) {
    threadsContainer.innerHTML = "<p style='color: var(--text-muted); padding: 16px;'>No threads yet. Start a thread by replying to a message!</p>";
    return;
  }

  threads.forEach(thread => {
    const threadEl = document.createElement("div");
    threadEl.className = "thread-item";

    // Parent message
    const parentDiv = document.createElement("div");
    parentDiv.className = "thread-header";
    parentDiv.innerHTML = `
      <div>
        <strong>${thread.parent.username === "Frenchwizz" ? "Takeo" : thread.parent.username}</strong>: ${thread.parent.content.substring(0, 100)}${thread.parent.content.length > 100 ? "..." : ""}
      </div>
      <div class="thread-reply-count">${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}</div>
    `;
    threadEl.appendChild(parentDiv);

    // Replies
    const repliesDiv = document.createElement("div");
    repliesDiv.className = "thread-replies";

    thread.replies.forEach(reply => {
      const replyEl = document.createElement("div");
      replyEl.className = "thread-reply";
      replyEl.innerHTML = `
        <div class="reply-author">${reply.username === "Frenchwizz" ? "Takeo" : reply.username}</div>
        <div>${reply.content}</div>
      `;
      repliesDiv.appendChild(replyEl);
    });

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

let typingTimeout = null;

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
// ======================== END FEATURES ========================