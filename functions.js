
// functions.js - full, de-obfuscated, REST-only (proxy) client
// Uses `supaFetch(...)` to call your proxy at PROXY_BASE and keeps Supabase client only for realtime subscription.
// Copy-paste ready.

const input = document.getElementById('messageInput');
const button = document.getElementById('sendButton');
const messagesList = document.getElementById('messages');
const logBox = document.getElementById('logBox');
if (logBox) logBox.style.display = 'none';
const namePrompt = document.getElementById('namePrompt');
const nameInput = document.getElementById('nameInput');
const saveNameBtn = document.getElementById('saveNameButton');

// REST Proxy base (your vercel path to proxy)
const PROXY_BASE = 'https://letslearnalgebra.vercel.app/api/supa/rest/v1/';

// supaFetch: small wrapper to call your proxy and forward query params and JSON body
async function supaFetch(path, options = {}) {
  const url = new URL(PROXY_BASE + path);

  if (options.query) {
    Object.entries(options.query).forEach(([k, v]) => {
      // If value is undefined or null, skip it
      if (typeof v !== 'undefined' && v !== null) {
        url.searchParams.append(k, v);
      }
    });
  }

  const resp = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.method && options.method.toUpperCase() !== 'GET' ? JSON.stringify(options.body ?? {}) : undefined,
  });

  // Try to parse JSON, but return text if not JSON
  const text = await resp.text();
  try { return JSON.parse(text); } catch (e) { return text; }
}

// App state
let username = localStorage.getItem('chatUsername') || '';
let currentRole = localStorage.getItem('chatRole') || 'User';
const messagesMap = new Map();

// UI helpers
function updateMessageLock() {
  const hasName = !!(nameInput && nameInput.value && nameInput.value.trim().length > 0);
  if (input) input.disabled = !hasName;
  if (button) button.disabled = !hasName;
}
if (nameInput) nameInput.addEventListener('input', updateMessageLock);
updateMessageLock();

function log(message, data = null, level = 'info') {
  if (!logBox) return;
  const entry = document.createElement('div');
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
  if (data) console[level === 'error' ? 'error' : 'log'](message, data);
}

// Realtime channel (keeps using Supabase client only for realtime subscriptions)
// Make sure `supabase` is initialized elsewhere if you want realtime.
let channel = null;
function initRealtime() {
  if (typeof supabase === 'undefined') {
    log('Realtime skipped (supabase client not found).');
    return;
  }
  if (channel) return;
  channel = supabase
    .channel('messages-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
      const record = payload.new || payload.record;
      const eventType = payload.eventType || payload.type || payload.event;
      handleRealtimeMessage(record, eventType || payload.eventType || payload.type || payload.event);
      log('📡 Live update: ' + (eventType || 'unknown'));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') log('✅ Subscribed to live updates');
      else if (status === 'CLOSED') log('🔴 Connection closed');
    });
}

// Load messages from REST
async function loadMessages() {
  try {
    const data = await supaFetch('messages', { query: { select: '*', order: 'inserted_at.asc' } });
    if (!Array.isArray(data)) {
      log('❌ Unexpected messages response', data, 'error');
      return;
    }
    data.forEach(msg => renderMessage(msg));
    log('✅ Messages loaded');
  } catch (err) {
    log('❌ Failed to load messages', err, 'error');
  }
}

// Load logged-in user from localStorage and server for role
async function loadUser() {
  const stored = localStorage.getItem('chatUsername');
  if (!stored) {
    if (namePrompt) namePrompt.style.display = 'block';
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    return;
  }
  if (nameInput) nameInput.value = stored;
  if (namePrompt) namePrompt.style.display = 'none';
  const controls = document.getElementById('controls');
  if (controls) controls.classList.add('visible');
  if (input) input.disabled = false;
  if (button) button.disabled = false;

  try {
    // Use ilike to allow case-insensitive match similar to original
    const users = await supaFetch('users', { query: { select: 'role', username: `ilike.${stored}` } });
    const user = Array.isArray(users) ? users[0] : null;
    currentRole = user?.role || 'User';
    localStorage.setItem('chatRole', currentRole);
  } catch (err) {
    currentRole = 'User';
    localStorage.setItem('chatRole', 'User');
  }

  if (logBox) logBox.style.display = currentRole === 'Admin' ? 'block' : 'none';
  await loadMessages();
  initRealtime();
}

loadUser();

// Save name flow (register / read role)
async function saveName() {
  const entered = nameInput.value.trim();
  if (!entered) return alert('Enter a name!');
  username = entered;
  localStorage.setItem('chatUsername', entered);

  try {
    // Try to find existing user role
    const users = await supaFetch('users', { query: { select: 'role', username: `eq.${entered}` } });
    const user = Array.isArray(users) ? users[0] : null;
    currentRole = user?.role || 'User';
    localStorage.setItem('chatRole', currentRole);
  } catch (err) {
    console.error(err);
    currentRole = 'User';
    localStorage.setItem('chatRole', 'User');
  }

  if (namePrompt) namePrompt.style.display = 'none';
  const controls = document.getElementById('controls');
  if (controls) controls.classList.add('visible');
  if (input) input.disabled = false;
  if (button) button.disabled = false;
  await loadMessages();
  initRealtime();
  if (logBox) logBox.style.display = currentRole === 'Admin' ? 'block' : 'none';
  updateMessageLock();
  alert('Welcome, ' + entered + '! You are a ' + currentRole + '.');
}

// Send message using REST (POST /messages)
async function sendMessage() {
  const text = input.value.trim();
  if (!text || !username) return;

  try {
    const users = await supaFetch('users', { query: { select: 'blocked', username: `eq.${username}` } });
    const user = Array.isArray(users) ? users[0] : null;
    if (user?.blocked) {
      alert('❌ You are blocked from sending messages.');
      return;
    }
  } catch (err) {
    // ignore lookup failure, allow send (fallback)
  }

  let ip = 'unknown';
  try {
    const ipResp = await fetch('https://api.ipify.org?format=json');
    const ipJson = await ipResp.json();
    ip = ipJson.ip || 'unknown';
  } catch (e) { /* ignore */ }

  try {
    // Insert message
    await supaFetch('messages', {
      method: 'POST',
      body: { username, content: text, role: currentRole, is_pinned: false, ip }
    });
    input.value = '';
    log('✅ Message sent to REST proxy');
  } catch (err) {
    log('❌ Failed to send message', err, 'error');
  }
}

if (button) button.addEventListener('click', sendMessage);
if (input) input.addEventListener('keypress', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendMessage();
  }
});

// Render a single message and attach controls (admin / manager)
function renderMessage(message) {
  if (!message || typeof message.id === 'undefined') return;
  let li = messagesMap.get(message.id);
  const roleView = currentRole;

  if (!li) {
    li = document.createElement('li');
    messagesMap.set(message.id, li);
    messagesList.appendChild(li);
  }

  li.innerHTML = '';
  li.className = '';

  if (message.role === 'Admin') li.classList.add('admin');
  else if (message.role === 'Manager') li.classList.add('manager');

  li.dataset.pinned = message.is_pinned ? 'true' : 'false';
  li.style.border = message.is_pinned ? '2px solid red' : '';

  const usernameDiv = document.createElement('div');
  usernameDiv.className = 'username';
  usernameDiv.textContent = message.username === 'Frenchwizz' ? 'Takeo' : message.username;
  li.appendChild(usernameDiv);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  if (message.role === 'Admin') contentDiv.innerHTML = message.content;
  else contentDiv.textContent = message.content;
  li.appendChild(contentDiv);

  // Admin controls container
  const adminControls = document.createElement('div');
  adminControls.className = 'adminControls';
  adminControls.style.display = 'none';

  // --- Admin buttons ---
  if (roleView === 'Admin') {
    // Delete button
    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Delete';
    btnDelete.onclick = async () => {
      if (li.dataset.pinned === 'true') return alert('Cannot delete pinned message.');
      try {
        await supaFetch('messages', { method: 'DELETE', query: { id: `eq.${message.id}` } });
        li.remove();
        messagesMap.delete(message.id);
        log('🗑 Deleted message id=' + message.id);
      } catch (err) {
        log('❌ Delete failed', err, 'error');
      }
    };
    adminControls.appendChild(btnDelete);

    // Edit button
    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Edit';
    btnEdit.onclick = async () => {
      const newContent = prompt('Edit message:', message.content);
      if (!newContent) return;
      try {
        await supaFetch('messages', { method: 'PATCH', query: { id: `eq.${message.id}` }, body: { content: newContent } });
        message.content = newContent;
        li.querySelector('.content').textContent = newContent;
        log('✏️ Edited message id=' + message.id);
      } catch (err) {
        log('❌ Edit failed', err, 'error');
      }
    };
    adminControls.appendChild(btnEdit);

    // Change Name
    const btnChangeName = document.createElement('button');
    btnChangeName.textContent = 'Change Name';
    btnChangeName.onclick = async () => {
      const newName = prompt('New username for ' + message.username + ':', message.username);
      if (!newName) return;
      try {
        // Upsert user (POST with on_conflict=username)
        await supaFetch('users', { method: 'POST', query: { on_conflict: 'username' }, body: { username: newName } });
        // Update messages for that username
        await supaFetch('messages', { method: 'PATCH', query: { username: `eq.${message.username}` }, body: { username: newName } });
        li.querySelector('.username').textContent = newName;
        log('🔁 Changed username ' + message.username + ' → ' + newName);
      } catch (err) {
        log('❌ Change name failed', err, 'error');
      }
    };
    adminControls.appendChild(btnChangeName);

    // Block / Unblock
    const btnBlock = document.createElement('button');
    btnBlock.className = 'blockBtn';
    btnBlock.textContent = message.blocked ? 'Unblock' : 'Block';
    btnBlock.onclick = async () => {
      try {
        const newBlocked = !message.blocked;
        await supaFetch('users', { method: 'PATCH', query: { username: `eq.${message.username}` }, body: { blocked: newBlocked } });
        message.blocked = newBlocked;
        btnBlock.textContent = newBlocked ? 'Unblock' : 'Block';
        log((newBlocked ? '🔒 Blocked ' : '🔓 Unblocked ') + message.username);
      } catch (err) {
        log('❌ Block toggle failed', err, 'error');
      }
    };
    adminControls.appendChild(btnBlock);

    // Force Logout
    const btnForceLogout = document.createElement('button');
    btnForceLogout.textContent = 'Force Logout';
    btnForceLogout.onclick = async () => {
      if (message.username === username) return alert('Cannot logout yourself.');
      try {
        await supaFetch('users', { method: 'PATCH', query: { username: `eq.${message.username}` }, body: { forceLogout: true } });
        log('🔌 Forced logout for ' + message.username);
      } catch (err) {
        log('❌ Force logout failed', err, 'error');
      }
    };
    adminControls.appendChild(btnForceLogout);

    // Mute 5min (local only)
    const btnMute = document.createElement('button');
    btnMute.textContent = 'Mute 5min';
    btnMute.onclick = () => {
      const muted = (window.__mutedUsers = window.__mutedUsers || {});
      muted[message.username] = Date.now() + 300000;
      log('🔇 Muted ' + message.username + ' for 5 minutes');
    };
    adminControls.appendChild(btnMute);

    // Export Chat JSON
    const btnExport = document.createElement('button');
    btnExport.textContent = 'Export Chat';
    btnExport.onclick = () => {
      const snapshot = Array.from(messagesList.querySelectorAll('li')).map(liEl => ({
        username: liEl.querySelector('.username')?.textContent,
        content: liEl.querySelector('.content')?.textContent
      }));
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chat.json';
      a.click();
      log('📦 Exported chat.json');
    };
    adminControls.appendChild(btnExport);

    // Delete by Keyword
    const btnDeleteKeyword = document.createElement('button');
    btnDeleteKeyword.textContent = 'Delete by Keyword';
    btnDeleteKeyword.onclick = async () => {
      const keyword = prompt('Enter keyword to delete:');
      if (!keyword) return;
      try {
        const allMessages = await supaFetch('messages', { query: { select: '*' } });
        const matches = (Array.isArray(allMessages) ? allMessages : []).filter(m => m.content?.includes(keyword)).map(m => m.id);
        if (matches.length === 0) {
          alert('No messages found containing "' + keyword + '".');
          return;
        }
        await supaFetch('messages', { method: 'DELETE', query: { id: `in.(${matches.join(',')})` } });
        // Remove from DOM
        document.querySelectorAll('#messages li').forEach(liEl => {
          if (liEl.querySelector('.content')?.textContent.includes(keyword)) liEl.remove();
        });
        log('🧹 Deleted all messages containing "' + keyword + '"');
      } catch (err) {
        log('❌ Delete by keyword failed', err, 'error');
      }
    };
    adminControls.appendChild(btnDeleteKeyword);

    // Delete User & Messages (nuke)
    const btnNuke = document.createElement('button');
    btnNuke.textContent = 'Delete User & Messages';
    btnNuke.onclick = async () => {
      if (!confirm('Delete ' + message.username + ' and all their messages?')) return;
      try {
        await supaFetch('messages', { method: 'DELETE', query: { username: `eq.${message.username}` } });
        await supaFetch('users', { method: 'DELETE', query: { username: `eq.${message.username}` } });
        document.querySelectorAll('#messages li').forEach(liEl => {
          if (liEl.querySelector('.username')?.textContent === message.username) liEl.remove();
        });
        log('💣 Nuked ' + message.username);
      } catch (err) {
        log('❌ Nuke failed', err, 'error');
      }
    };
    adminControls.appendChild(btnNuke);

    // User Info
    const btnInfo = document.createElement('button');
    btnInfo.textContent = 'User Info';
    btnInfo.onclick = () => {
      alert('Username: ' + message.username + '\nRole: ' + message.role + '\nIP: ' + message.ip + '\nID: ' + message.id);
    };
    adminControls.appendChild(btnInfo);

    // Promote -> Manager
    const btnPromoteManager = document.createElement('button');
    btnPromoteManager.textContent = 'Promote → Manager';
    btnPromoteManager.onclick = async () => {
      try {
        await supaFetch('users', { method: 'POST', query: { on_conflict: 'username' }, body: { username: message.username, role: 'Manager' } });
        log('👑 Promoted ' + message.username + ' to Manager');
        await loadMessages();
      } catch (err) {
        log('❌ Promote failed', err, 'error');
      }
    };
    adminControls.appendChild(btnPromoteManager);

    // Promote -> Admin
    const btnPromoteAdmin = document.createElement('button');
    btnPromoteAdmin.textContent = 'Promote → Admin';
    btnPromoteAdmin.onclick = async () => {
      try {
        await supaFetch('users', { method: 'POST', query: { on_conflict: 'username' }, body: { username: message.username, role: 'Admin' } });
        log('👑 Promoted ' + message.username + ' to Admin');
        await loadMessages();
      } catch (err) {
        log('❌ Promote failed', err, 'error');
      }
    };
    adminControls.appendChild(btnPromoteAdmin);

    // Demote -> User
    const btnDemote = document.createElement('button');
    btnDemote.textContent = 'Demote → User';
    btnDemote.onclick = async () => {
      try {
        await supaFetch('users', { method: 'POST', query: { on_conflict: 'username' }, body: { username: message.username, role: 'User' } });
        log('🔽 Demoted ' + message.username + ' to User');
        await loadMessages();
      } catch (err) {
        log('❌ Demote failed', err, 'error');
      }
    };
    adminControls.appendChild(btnDemote);

    // Pin / Unpin
    const btnPin = document.createElement('button');
    btnPin.textContent = message.is_pinned ? 'Unpin' : 'Pin';
    if (message.is_pinned) {
      li.dataset.pinned = 'true';
      li.style.border = '2px solid red';
    }
    btnPin.onclick = async () => {
      try {
        const currentlyPinned = li.dataset.pinned === 'true';
        await supaFetch('messages', { method: 'PATCH', query: { id: `eq.${message.id}` }, body: { is_pinned: !currentlyPinned } });
        li.dataset.pinned = !currentlyPinned ? 'true' : 'false';
        li.style.border = !currentlyPinned ? '2px solid red' : '';
        btnPin.textContent = !currentlyPinned ? 'Unpin' : 'Pin';
        log((!currentlyPinned ? '📌 Pinned' : '❌ Unpinned') + ' message id=' + message.id);
        if (!currentlyPinned) messagesList.insertBefore(li, messagesList.firstChild);
        else await loadMessages();
      } catch (err) {
        log('❌ Pin toggle failed', err, 'error');
      }
    };
    adminControls.appendChild(btnPin);
  } // end Admin block

  li.appendChild(adminControls);

  // Manager controls (limited)
  if (roleView === 'Manager') {
    const managerControls = document.createElement('div');
    managerControls.className = 'managerControls';
    managerControls.style.display = 'none';

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Delete';
    btnDelete.onclick = async () => {
      if (message.username !== username) return alert('You can only delete your own messages.');
      try {
        await supaFetch('messages', { method: 'DELETE', query: { id: `eq.${message.id}` } });
        li.remove();
        messagesMap.delete(message.id);
        log('🗑 Deleted your message id=' + message.id);
      } catch (err) {
        log('❌ Delete failed', err, 'error');
      }
    };
    managerControls.appendChild(btnDelete);

    const btnReport = document.createElement('button');
    btnReport.textContent = 'Report';
    btnReport.onclick = async () => {
      alert('🚨 Reported message from ' + message.username + ': \"' + message.content + '\"');
      log('🚨 Reported message id=' + message.id + ' by ' + username);
    };
    managerControls.appendChild(btnReport);

    li.appendChild(managerControls);

    li.addEventListener('click', (e) => {
      e.stopPropagation();
      managerControls.style.display = managerControls.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', () => { managerControls.style.display = 'none'; });
  }

  // Toggle admin controls on click for non-User roles
  if (roleView !== 'User') {
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      adminControls.style.display = adminControls.style.display === 'none' ? 'flex' : 'none';
    });
    document.addEventListener('click', () => { adminControls.style.display = 'none'; });
  }
}

// Realtime message handler
function handleRealtimeMessage(record, eventType) {
  if (!record) return;
  if (eventType === 'INSERT') renderMessage(record);
  else if (eventType === 'UPDATE') {
    renderMessage(record);
    const el = messagesMap.get(record.id);
    if (el) {
      const blockBtn = el.querySelector('.blockBtn');
      if (blockBtn) blockBtn.textContent = record.blocked ? 'Unblock' : 'Block';
    }
  } else if (eventType === 'DELETE') {
    const el = messagesMap.get(record.id);
    if (el) {
      el.remove();
      messagesMap.delete(record.id);
    }
    if (record.username === username && record.forceLogout) {
      alert('⚠️ You have been forcefully logged out by an admin!');
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatRole');
      // Clear forceLogout flag server-side if desired
      supaFetch('users', { method: 'PATCH', query: { username: `eq.${username}` }, body: { forceLogout: false } })
        .then(() => location.reload())
        .catch(() => location.reload());
    }
  }

  // If the update contains blocked state for the current user, enforce it locally
  if (record.username === username && typeof record.blocked !== 'undefined') {
    if (input) input.disabled = record.blocked;
    if (button) button.disabled = record.blocked;
    if (record.blocked) alert('❌ You have been blocked by an admin!');
  }
}

// Hotkey: Ctrl+Alt+Shift+T to logout/clear
document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.altKey && ev.shiftKey && ev.key.toLowerCase() === 't') {
    ev.preventDefault();
    localStorage.removeItem('chatUsername');
    localStorage.removeItem('chatRole');
    alert('👋 You have been signed out!');
    if (namePrompt) namePrompt.style.display = 'block';
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    if (nameInput) nameInput.value = '';
    currentRole = null;
    if (logBox) logBox.style.display = 'none';
    updateMessageLock();
    if (saveNameBtn) saveNameBtn.onclick = saveName;
  }
});

// Wire save button
if (saveNameBtn) saveNameBtn.addEventListener('click', saveName);

// Export for debugging (optional)
window.__chat = { supaFetch, loadMessages, loadUser, sendMessage, renderMessage };
