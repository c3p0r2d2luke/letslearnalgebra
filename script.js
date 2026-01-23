
  const input = document.getElementById("messageInput");
  const button = document.getElementById("sendButton");
  const messagesList = document.getElementById("messages");
  const logBox = document.getElementById("logBox");
  logBox.style.display = "none";
  
  const namePrompt = document.getElementById("namePrompt");
  const nameInput = document.getElementById("nameInput");
  const saveNameBtn = document.getElementById("saveNameButton");
  
  // ------------------------ Supabase Setup ------------------------
  const supabaseUrl = "http://127.0.0.1:54321";
  const supabaseKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"; // replace with your key
  // Use a unique variable name to avoid redeclaration conflicts
  const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

  
  // ------------------------ User data ------------------------
  let username = localStorage.getItem("chatUsername") || "";
  let currentRole = localStorage.getItem("chatRole") || "User";
  const messagesMap = new Map(); // store message DOM elements
  
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
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        handleRealtimeMessage(payload.new || payload.record, payload.eventType);
        log(`📡 Live update: ${payload.eventType}`);
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") log("✅ Subscribed to live updates");
        else if (status === "CLOSED") log("🔴 Connection closed");
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
    const { data } = await supabaseClient
      .from("users")
      .select("role")
      .ilike("username", storedName)
      .maybeSingle();

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
    // Upsert ensures the user exists and role is preserved if already there
    const { data, error } = await supabaseClient
      .from("users")
      .upsert({ username: name }, { onConflict: ['username'] })
      .select();

    if (error) throw error;

    // Fetch role
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

  
  // ------------------------ Send Message ------------------------
  async function sendMessage() {
    const content = input.value.trim();
    if (!content || !username) return;

    // Check if the user is blocked
const { data: user } = await supabaseClient.from("users")
  .select("blocked")
  .eq("username", username)
  .maybeSingle();

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
      const { data, error } = await supabaseClient.from("messages")
        .insert([{ username, content, role: currentRole, is_pinned: false, ip }])
        .select();
      if (!error) {
        input.value = "";
        log("✅ Message sent to Supabase");
      }
    } catch (e) {
      log("❌ Failed to send message", e, "error");
    }
  }
  
  button.addEventListener("click", sendMessage);
  input.addEventListener("keypress", e => { if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});
  
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
    if (msg.role === "Admin") li.classList.add("admin");
    else if (msg.role === "Manager") li.classList.add("manager");
    li.dataset.pinned = msg.is_pinned ? "true" : "false";
    if (msg.is_pinned) li.style.border = "2px solid red"; else li.style.border = "";
  
    // Username
    const uname = document.createElement("div");
    uname.className = "username";
    uname.textContent = msg.username === "Frenchwizz" ? "Takeo" : msg.username;
    li.appendChild(uname);
  
    // Message content
    const contentDiv = document.createElement("div");
    contentDiv.className = "content";
    if (msg.role === "Admin") contentDiv.innerHTML = msg.content;
    else contentDiv.textContent = msg.content;
    li.appendChild(contentDiv);
  
    // Admin panel
    const adminDiv = document.createElement("div");
    adminDiv.className = "adminControls";
    adminDiv.style.display = "none";
  
    if (viewerRole === "Admin") {
          // 🗑 Delete
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.onclick = async () => {
      if (li.dataset.pinned === "true") return alert("Cannot delete pinned message.");
      try {
        await supabaseClient.from("messages").delete().eq("id", msg.id);
        li.remove();
        log(`🗑 Deleted message id=${msg.id}`);
      } catch (e) {
        log("❌ Delete failed", e, "error");
      }
    };
    adminDiv.appendChild(delBtn);

    // ✏️ Edit
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.onclick = async () => {
      const newText = prompt("Edit message:", msg.content);
      if (!newText) return;
      try {
        await supabaseClient.from("messages").update({ content: newText }).eq("id", msg.id);
        msg.content = newText;
        li.querySelector(".content").textContent = newText;
        log(`✏️ Edited message id=${msg.id}`);
      } catch (e) {
        log("❌ Edit failed", e, "error");
      }
    };
    adminDiv.appendChild(editBtn);

    // 👤 Change Name
    const nameBtn = document.createElement("button");
    nameBtn.textContent = "Change Name";
    nameBtn.onclick = async () => {
      const newName = prompt("New username for " + msg.username + ":", msg.username);
      if (!newName) return;
      try {
        await supabaseClient.from("users").upsert({ username: newName });
        await supabaseClient.from("messages").update({ username: newName }).eq("username", msg.username);
        li.querySelector(".username").textContent = newName;
        log(`🔁 Changed username ${msg.username} → ${newName}`);
      } catch (e) {
        log("❌ Change name failed", e, "error");
      }
    };
    adminDiv.appendChild(nameBtn);

// 🔒 Block / Unblock User
const blockBtn = document.createElement("button");
blockBtn.className = "blockBtn";
blockBtn.textContent = msg.blocked ? "Unblock" : "Block";
blockBtn.onclick = async () => {
  try {
    const newBlocked = !msg.blocked;
    await supabaseClient.from("users").update({ blocked: newBlocked }).eq("username", msg.username);
    msg.blocked = newBlocked;
    blockBtn.textContent = newBlocked ? "Unblock" : "Block";
    log(`${newBlocked ? "🔒 Blocked" : "🔓 Unblocked"} ${msg.username}`);
  } catch (e) {
    log("❌ Block toggle failed", e, "error");
  }
};
adminDiv.appendChild(blockBtn);



    // 🔌 Force Logout
    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Force Logout";
    logoutBtn.onclick = async () => {
      if (msg.username === username) return alert("Cannot logout yourself.");
      await supabaseClient.from("users").update({ forceLogout: true }).eq("username", msg.username);
      log(`🔌 Forced logout for ${msg.username}`);
    };
    adminDiv.appendChild(logoutBtn);

    // 🔇 Mute
    const muteBtn = document.createElement("button");
    muteBtn.textContent = "Mute 5min";
    muteBtn.onclick = () => {
      const mutedUsers = (window.__mutedUsers = window.__mutedUsers || {});
      mutedUsers[msg.username] = Date.now() + 5 * 60 * 1000;
      log(`🔇 Muted ${msg.username} for 5 minutes`);
    };
    adminDiv.appendChild(muteBtn);

    // 📦 Export Chat
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export Chat";
    exportBtn.onclick = () => {
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

    // 🧹 Delete by Keyword
    const massDelBtn = document.createElement("button");
    massDelBtn.textContent = "Delete by Keyword";
    massDelBtn.onclick = async () => {
      const keyword = prompt("Enter keyword to delete:");
      if (!keyword) return;
      const { data } = await supabaseClient.from("messages").select("*");
      const ids = data.filter(m => m.content?.includes(keyword)).map(m => m.id);
      await supabaseClient.from("messages").delete().in("id", ids);
      document.querySelectorAll("#messages li").forEach(liItem => {
        if (liItem.querySelector(".content")?.textContent.includes(keyword)) liItem.remove();
      });
      log(`🧹 Deleted all messages containing "${keyword}"`);
    };
    adminDiv.appendChild(massDelBtn);

    // 💣 Delete User & Messages
    const nukeBtn = document.createElement("button");
    nukeBtn.textContent = "Delete User & Messages";
    nukeBtn.onclick = async () => {
      if (!confirm(`Delete ${msg.username} and all their messages?`)) return;
      await supabaseClient.from("messages").delete().eq("username", msg.username);
      await supabaseClient.from("users").delete().eq("username", msg.username);
      document.querySelectorAll("#messages li").forEach(liItem => {
        if (liItem.querySelector(".username")?.textContent === msg.username) liItem.remove();
      });
      log(`💣 Nuked ${msg.username}`);
    };
    adminDiv.appendChild(nukeBtn);

    // ℹ️ Info
    const infoBtn = document.createElement("button");
    infoBtn.textContent = "User Info";
    infoBtn.onclick = () => alert(
      `Username: ${msg.username}\nRole: ${msg.role}\nIP: ${msg.ip}\nID: ${msg.id}`
    );
    adminDiv.appendChild(infoBtn);

    // 👑 Promote / Demote
    const promoteManagerBtn = document.createElement("button");
    promoteManagerBtn.textContent = "Promote → Manager";
    promoteManagerBtn.onclick = async () => {
      await supabaseClient.from("users").upsert({ username: msg.username, role: "Manager" });
      log(`👑 Promoted ${msg.username} to Manager`);
      loadMessages();
    };
    adminDiv.appendChild(promoteManagerBtn);

    const promoteAdminBtn = document.createElement("button");
    promoteAdminBtn.textContent = "Promote → Admin";
    promoteAdminBtn.onclick = async () => {
      await supabaseClient.from("users").upsert({ username: msg.username, role: "Admin" });
      log(`👑 Promoted ${msg.username} to Admin`);
      loadMessages();
    };
    adminDiv.appendChild(promoteAdminBtn);

    const demoteBtn = document.createElement("button");
    demoteBtn.textContent = "Demote → User";
    demoteBtn.onclick = async () => {
      await supabaseClient.from("users").upsert({ username: msg.username, role: "User" });
      log(`🔻 Demoted ${msg.username} to User`);
      loadMessages();
    };
    adminDiv.appendChild(demoteBtn);

    // 📌 Pin / Unpin
    const pinBtn = document.createElement("button");
    pinBtn.textContent = msg.is_pinned ? "Unpin" : "Pin";
    if (msg.is_pinned) {
      li.dataset.pinned = "true";
      li.style.border = "2px solid red";
    }
    pinBtn.onclick = async () => {
      const isPinned = li.dataset.pinned === "true";
      await supabaseClient.from("messages").update({ is_pinned: !isPinned }).eq("id", msg.id);
      li.dataset.pinned = !isPinned ? "true" : "false";
      li.style.border = !isPinned ? "2px solid red" : "";
      pinBtn.textContent = !isPinned ? "Unpin" : "Pin";
      log(`${!isPinned ? "📌 Pinned" : "❌ Unpinned"} message id=${msg.id}`);
      if (!isPinned) messagesList.insertBefore(li, messagesList.firstChild);
      else loadMessages();
    };
    adminDiv.appendChild(pinBtn);
    }
  
    li.appendChild(adminDiv);

    if (viewerRole === "Manager") {
  const managerDiv = document.createElement("div");
  managerDiv.className = "managerControls";
  managerDiv.style.display = "none";

  // 🗑 Delete own messages only
  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete";
  delBtn.onclick = async () => {
  // Managers can only delete their own messages
  if (msg.username !== username) return alert("You can only delete your own messages.");
  try {
    await supabaseClient.from("messages").delete().eq("id", msg.id);
    li.remove();
    log(`🗑 Deleted your message id=${msg.id}`);
  } catch (e) {
    log("❌ Delete failed", e, "error");
  }
};
  managerDiv.appendChild(delBtn);

const reportBtn = document.createElement("button");
reportBtn.textContent = "Report";
reportBtn.onclick = async () => {
  // cooldown to reduce spam
  window.__lastReportTime = window.__lastReportTime || {};
  const now = Date.now();
  const cooldownMs = 30 * 1000; // 30 seconds
  if (window.__lastReportTime[username] && now - window.__lastReportTime[username] < cooldownMs) {
    return alert("Please wait a bit before reporting again.");
  }

  const reason = prompt("Optional: provide a reason for reporting this message:");
  if (reason === null) return; // cancelled

  reportBtn.disabled = true;

  try {
    // Try to get the authoritative username from the Supabase auth user (if available)
    let reporterName = username; // fallback
    try {
      const { data: { user } = {} } = await supabaseClient.auth.getUser();
      // adjust this if your username is stored somewhere else in the JWT/user_metadata
      reporterName = user?.user_metadata?.username || user?.email || reporterName;
    } catch (e) {
      // non-fatal: proceed with local username
      console.warn("Could not fetch auth user, using local username", e);
    }

    // 1) Insert the report into Supabase
    const reportPayload = {
      reporter: reporterName,
      reported_user: msg.username,
      message_id: msg.id ?? null,
      content: msg.content ?? null,
      reason: reason || null
    };

    const { data: inserted, error: insertError } = await supabaseClient
      .from("reports")
      .insert([reportPayload])
      .select()
      .maybeSingle();

    if (insertError) throw insertError;
    log(`✅ Report inserted id=${inserted?.id || '(unknown)'}`);

    // 2) Send an email via EmailJS (best-effort)
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
      await emailjs.send("service_fkhhdph", "template_kc760ra", templateParams);
      log("✉️ Email sent via EmailJS");

      // mark email_sent true in DB (best-effort)
      if (inserted?.id) {
        await supabaseClient
          .from("reports")
          .update({ email_sent: true })
          .eq("id", inserted.id);
      }

      alert("🚨 Message reported. Admins have been notified.");
    } catch (emailErr) {
      console.error("EmailJS send failed", emailErr);
      log("❌ EmailJS send failed", emailErr, "error");
      alert("Reported — failed to send notification email. Admins can still review the report in the admin panel.");
    }

    // set cooldown timestamp
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

  // <-- Add this here:
  li.addEventListener("click", e => {
    e.stopPropagation();
    managerDiv.style.display = managerDiv.style.display === "none" ? "flex" : "none";
  });
  document.addEventListener("click", () => {
    managerDiv.style.display = "none";
  });
}


    if(viewerRole !== "User"){
      li.addEventListener("click", e => { e.stopPropagation(); adminDiv.style.display = adminDiv.style.display==="none"?"flex":"none"; });
      document.addEventListener("click", ()=>{ adminDiv.style.display="none"; });
    }
  }
  
  // ------------------------ Realtime Message Handler ------------------------
  function handleRealtimeMessage(newMsg, eventType) {
    if (!newMsg) return;
  
    if (eventType === "INSERT") renderMessage(newMsg);
    else if (eventType === "UPDATE") {
  renderMessage(newMsg);

  // If blocked status changed, update the button text in real-time
  const li = messagesMap.get(newMsg.id);
  if (li) {
    const blockBtn = li.querySelector(".blockBtn");
if (blockBtn) blockBtn.textContent = newMsg.blocked ? "Unblock" : "Block";
    if (blockBtn && "textContent" in blockBtn) {
      blockBtn.textContent = newMsg.blocked ? "Unblock" : "Block";
    }
  }
}
if(newMsg.username === username && typeof newMsg.blocked !== "undefined") {
  input.disabled = newMsg.blocked;
  button.disabled = newMsg.blocked;
  if(newMsg.blocked) alert("❌ You have been blocked by an admin!");
}

    else if (eventType === "DELETE") {
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
  
  // ------------------------ Secret Sign-Out Shortcut ------------------------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === "t") {
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

  saveNameBtn.addEventListener("click", saveName);

  
