// functions.js — FIXED Supabase v2 client (no CORS, no REST fetches)

const input = document.getElementById('messageInput');
const button = document.getElementById('sendButton');
const messagesList = document.getElementById('messages');
const logBox = document.getElementById('logBox');
if (logBox) logBox.style.display = 'none';

const namePrompt = document.getElementById('namePrompt');
const nameInput = document.getElementById('nameInput');
const saveNameBtn = document.getElementById('saveNameButton');

let username = localStorage.getItem('chatUsername') || '';
let currentRole = localStorage.getItem('chatRole') || 'User';
const messagesMap = new Map();

function log(msg, data = null, level = 'info') {
  if (!logBox) return;
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
  if (data) console[level === 'error' ? 'error' : 'log'](msg, data);
}

function updateMessageLock() {
  const ok = Boolean(nameInput?.value?.trim());
  if (input) input.disabled = !ok;
  if (button) button.disabled = !ok;
}
if (nameInput) nameInput.addEventListener('input', updateMessageLock);
updateMessageLock();

/* ============================
   REALTIME
============================ */
let channel = null;

function initRealtime() {
  if (!window.supabase || channel) return;

  channel = window.supabase
    .channel('messages-channel')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      payload => {
        handleRealtimeMessage(payload.new, payload.eventType);
        log('📡 Live update: ' + payload.eventType);
      }
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') log('✅ Realtime connected');
    });
}

/* ============================
   LOAD MESSAGES
============================ */
async function loadMessages() {
  const { data, error } = await window.supabase
    .from('messages')
    .select('*')
    .order('inserted_at', { ascending: true });

  if (error) {
    log('❌ Failed to load messages', error, 'error');
    return;
  }

  messagesList.innerHTML = '';
  messagesMap.clear();
  data.forEach(renderMessage);
  log('✅ Messages loaded');
}

/* ============================
   LOAD USER
============================ */
async function loadUser() {
  const stored = localStorage.getItem('chatUsername');

  if (!stored) {
    if (namePrompt) namePrompt.style.display = 'block';
    updateMessageLock();
    return;
  }

  username = stored;
  if (nameInput) nameInput.value = stored;
  if (namePrompt) namePrompt.style.display = 'none';

  const { data } = await window.supabase
    .from('users')
    .select('role')
    .ilike('username', stored)
    .limit(1)
    .single();

  currentRole = data?.role || 'User';
  localStorage.setItem('chatRole', currentRole);

  if (logBox) logBox.style.display = currentRole === 'Admin' ? 'block' : 'none';

  await loadMessages();
  initRealtime();
}

loadUser();

/* ============================
   SAVE NAME
============================ */
async function saveName() {
  const entered = nameInput.value.trim();
  if (!entered) return alert('Enter a name');

  username = entered;
  localStorage.setItem('chatUsername', entered);

  const { data } = await window.supabase
    .from('users')
    .select('role')
    .eq('username', entered)
    .limit(1)
    .single();

  currentRole = data?.role || 'User';
  localStorage.setItem('chatRole', currentRole);

  if (namePrompt) namePrompt.style.display = 'none';
  if (logBox) logBox.style.display = currentRole === 'Admin' ? 'block' : 'none';

  await loadMessages();
  initRealtime();
  updateMessageLock();
  alert(`Welcome ${entered} (${currentRole})`);
}

/* ============================
   SEND MESSAGE
============================ */
async function sendMessage() {
  const text = input.value.trim();
  if (!text || !username) return;

  const { data: blockedUser } = await window.supabase
    .from('users')
    .select('blocked')
    .eq('username', username)
    .limit(1)
    .single();

  if (blockedUser?.blocked) {
    alert('❌ You are blocked.');
    return;
  }

  let ip = 'unknown';
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    ip = (await r.json()).ip || 'unknown';
  } catch {}

  const { error } = await window.supabase
    .from('messages')
    .insert({ username, content: text, role: currentRole, ip });

  if (error) {
    log('❌ Send failed', error, 'error');
    return;
  }

  input.value = '';
  log('✅ Message sent');
}

if (button) button.addEventListener('click', sendMessage);
if (input) input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* ============================
   RENDER MESSAGE
============================ */
function renderMessage(message) {
  if (!message || messagesMap.has(message.id)) return;

  const li = document.createElement('li');
  messagesMap.set(message.id, li);
  messagesList.appendChild(li);

  if (message.role === 'Admin') li.classList.add('admin');
  if (message.role === 'Manager') li.classList.add('manager');

  const userDiv = document.createElement('div');
  userDiv.className = 'username';
  userDiv.textContent =
    message.username === 'Frenchwizz' ? 'Takeo' : message.username;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  contentDiv.textContent = message.content;

  li.appendChild(userDiv);
  li.appendChild(contentDiv);
}

/* ============================
   REALTIME HANDLER
============================ */
function handleRealtimeMessage(record, type) {
  if (!record) return;
  if (type === 'INSERT') renderMessage(record);
  if (type === 'DELETE') {
    const li = messagesMap.get(record.id);
    if (li) li.remove();
    messagesMap.delete(record.id);
  }
}

/* ============================
   EVENTS
============================ */
if (saveNameBtn) saveNameBtn.addEventListener('click', saveName);

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
    localStorage.clear();
    alert('Signed out');
    location.reload();
  }
});

window.__chat = { loadMessages, loadUser, sendMessage };
