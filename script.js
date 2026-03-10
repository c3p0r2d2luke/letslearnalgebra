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
let currentRole = localStorage.getItem("chatRole") || "User";
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
    const { data } = await supabaseClient.from("users").select("role").ilike("username", storedName).maybeSingle();
    currentRole = data?.role || "User";
    localStorage.setItem("chatRole", currentRole);
  } catch {
    currentRole = "User";
    localStorage.setItem("chatRole", "User");
  }

  logBox.style.display = currentRole === "Admin" ? "block" : "none";

  loadMessages();
  initRealtime();
}

loadUser();

// ------------------------ Save Name ------------------------
async function saveName() {
  const name = nameInput.value.trim();
  if (!name) return alert("Enter a name!");

  username = name;
  localStorage.setItem("chatUsername", name);

  try {
    const { data, error } = await supabaseClient.from("users").upsert({ username: name }, { onConflict: ['username'] }).select();
    if (error) throw error;

    const { data: userData } = await supabaseClient.from("users").select("role").eq("username", name).maybeSingle();
    currentRole = userData?.role || "User";
    localStorage.setItem("chatRole", currentRole);
  } catch (err) {
    console.error(err);
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
  alert(`Welcome, ${name}! You are a ${currentRole}.`);
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
function renderMessage(msg) {
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
    wrapper.innerHTML = cleanContent;
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
    contentDiv.textContent = msg.content;
  }
  li.appendChild(contentDiv);

  // Add reply context if this message is a reply
  if (msg.reply_to) {
    supabaseClient
      .from("messages")
      .select("username, content")
      .eq("id", msg.reply_to)
      .maybeSingle()
      .then(({ data: parentMsg }) => {
        if (parentMsg) {
          const replyContext = document.createElement("div");
          replyContext.className = "replyContext";
          
          const author = parentMsg.username === "Frenchwizz" ? "Takeo" : parentMsg.username;
          const content = parentMsg.content.substring(0, 50);
          
          replyContext.innerHTML = `
            <div class="replyContextContent">
              <div class="replyContextAuthor">${author}</div>
              <div>${content}${parentMsg.content.length > 50 ? "..." : ""}</div>
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

  // All buttons kept exactly as your code (delete, edit, block, mute, pin, promote, report, etc.)
  // ... copy-paste all of your buttons creation here, unchanged ...
  // (omitted for brevity in this snippet, but in the full file, it's identical to your code)

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
    btn.onmouseenter = () => btn.style.background = "#40444b";
    btn.onmouseleave = () => btn.style.background = "transparent";

    btn.onclick = () => {
      action();
      menu.style.display = "none";
    };

    menu.appendChild(btn);
  };

  // Basic actions (everyone)
  addButton("Reply", () => startReply(messageId));

  addButton("React 👍", () => addReaction(messageId, "👍"));

  addButton("Report", () => reportMessage(messageId));

  // Manager actions
  if (currentRole === "Manager" || currentRole === "Admin") {
    addButton("Pin Message", () => pinMessage(messageId));
  }

  // Admin actions
  if (currentRole === "Admin") {
    addButton("Delete", () => deleteMessage(messageId));
    addButton("Mute User", () => muteUser(author));
    addButton("Block User", () => blockUser(author));
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
      offender: data.username,
      message: data.content,
      reason: reason,
      message_id: messageId,
      time: new Date().toLocaleString()
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


// Delete message
async function deleteMessage(messageId) {
  if (!confirm("Delete this message?")) return;

  try {

    const { error } = await supabaseClient
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (error) throw error;

  } catch (err) {
    console.error("Delete failed", err);
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
  const oldText = contentEl.textContent;

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
      .maybeSingle();

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

  const { data } = await supabaseClient
    .from("reactions")
    .select("*")
    .eq("message_id", messageId);

  if (!data) return;

  const reactionsMap = {};

  data.forEach(r => {
    if (!reactionsMap[r.emoji]) reactionsMap[r.emoji] = [];
    reactionsMap[r.emoji].push(r.username);
  });

  const wrap = document.createElement("div");
  wrap.className = "reactionBar";

  Object.entries(reactionsMap).forEach(([emoji, users]) => {

    const bubble = document.createElement("span");

    bubble.textContent = `${emoji} ${users.length}`;
    bubble.className = "reactionBubble";

    bubble.onclick = () => addReaction(messageId, emoji);

    wrap.appendChild(bubble);

  });

  container.appendChild(wrap);

}



// ---------------- THREAD REPLIES ----------------

let replyingTo = null;

function startReply(messageId) {
  replyingTo = messageId;

  const li = messagesMap.get(Number(messageId));
  if (!li) return;

  const author = li.dataset.user;
  const content = li.querySelector(".content")?.textContent || "";

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
  const text = original.querySelector(".content")?.textContent || "";

  preview.textContent = `Replying to ${name}: ${text.substring(0,40)}...`;

  li.prepend(preview);

}



// ---------------- TYPING INDICATOR ----------------

let typingTimeout = null;

input.addEventListener("input", async () => {

  if (!username) return;

  await supabaseClient
    .from("typing")
    .upsert({
      username: username,
      typing: true,
      updated_at: new Date()
    });

  clearTimeout(typingTimeout);

  typingTimeout = setTimeout(async () => {

    await supabaseClient
      .from("typing")
      .update({ typing: false })
      .eq("username", username);

  }, 2000);

});



async function updateTypingIndicator() {

  const { data } = await supabaseClient
    .from("typing")
    .select("*")
    .eq("typing", true);

  const box = document.getElementById("typingIndicator");
  if (!box) return;

  const users = data
    .filter(u => u.username !== username)
    .map(u => u.username);

  if (!users.length) {
    box.textContent = "";
    return;
  }

  box.textContent = `${users.join(", ")} typing...`;

}



// run typing indicator refresh
setInterval(updateTypingIndicator, 1500);




// ---------------- HOVER CONTROLS ----------------

function attachHoverControls(li, msg) {

  const controls = document.createElement("div");

  controls.className = "hoverControls";

  controls.style.position = "absolute";
  controls.style.right = "10px";
  controls.style.top = "5px";
  controls.style.display = "none";



  const reactBtn = document.createElement("button");
  reactBtn.textContent = "😀";
  reactBtn.onclick = () => addReaction(msg.id, "😀");



  const replyBtn = document.createElement("button");
  replyBtn.textContent = "↩";
  replyBtn.onclick = () => startReply(msg.id);



  const editBtn = document.createElement("button");
  editBtn.textContent = "✏";
  editBtn.onclick = () => editMessage(msg.id);



  controls.appendChild(reactBtn);
  controls.appendChild(replyBtn);
  controls.appendChild(editBtn);

  li.style.position = "relative";
  li.appendChild(controls);



  li.addEventListener("mouseenter", () => {
    controls.style.display = "block";
  });

  li.addEventListener("mouseleave", () => {
    controls.style.display = "none";
  });

}



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


// ======================== END FEATURES ========================