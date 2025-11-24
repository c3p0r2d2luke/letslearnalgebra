const input = document.getElementById('messageInput')
const button = document.getElementById('sendButton')
const messagesList = document.getElementById('messages')
const logBox = document.getElementById('logBox')
logBox.style.display = 'none'
const namePrompt = document.getElementById('namePrompt')
const nameInput = document.getElementById('nameInput')
const saveNameBtn = document.getElementById('saveNameButton')
const supabase = window.supabase.createClient(
  'https://letslearnalgebra.vercel.app/api/supa/',
  'anon-key-doesnt-matter' // proxy handles the real key
)
let username = localStorage.getItem('chatUsername') || ''
let currentRole = localStorage.getItem('chatRole') || 'User'
const messagesMap = new Map()
function updateMessageLock() {
  const _0x2c13ce = nameInput.value.trim().length > 0
  input.disabled = !_0x2c13ce
  button.disabled = !_0x2c13ce
}
nameInput.addEventListener('input', updateMessageLock)
updateMessageLock()
function log(_0x450f73, _0x22a76f = null, _0x5f3e01 = 'info') {
  const _0x2df722 = document.createElement('div')
  _0x2df722.textContent =
    '[' + new Date().toLocaleTimeString() + '] ' + _0x450f73
  logBox.appendChild(_0x2df722)
  logBox.scrollTop = logBox.scrollHeight
  if (_0x22a76f) {
    console[_0x5f3e01 === 'error' ? 'error' : 'log'](_0x450f73, _0x22a76f)
  }
}
let channel = null
function initRealtime() {
  if (channel) {
    return
  }
  channel = supabase
    .channel('messages-channel')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'messages',
      },
      (_0x2bdab8) => {
        handleRealtimeMessage(
          _0x2bdab8.new || _0x2bdab8.record,
          _0x2bdab8.eventType
        )
        log('\uD83D\uDCE1 Live update: ' + _0x2bdab8.eventType)
      }
    )
    .subscribe((_0x1aefa4) => {
      if (_0x1aefa4 === 'SUBSCRIBED') {
        log('\u2705 Subscribed to live updates')
      } else {
        if (_0x1aefa4 === 'CLOSED') {
          log('\uD83D\uDD34 Connection closed')
        }
      }
    })
}
async function loadMessages() {
  const { data: _0x3f0654, error: _0x32de71 } = await supabase
    .from('messages')
    .select('*')
    .order('inserted_at', { ascending: true })
  if (_0x32de71) {
    return log('\u274C Failed to load messages', _0x32de71, 'error')
  }
  _0x3f0654.forEach((_0x42359d) => renderMessage(_0x42359d))
  log('\u2705 Messages loaded')
}
async function loadUser() {
  const _0xcb6991 = localStorage.getItem('chatUsername')
  if (!_0xcb6991) {
    namePrompt.style.display = 'block'
    input.disabled = true
    button.disabled = true
    return
  }
  nameInput.value = _0xcb6991
  namePrompt.style.display = 'none'
  const _0x5ac635 = document.getElementById('controls')
  _0x5ac635.classList.add('visible')
  input.disabled = false
  button.disabled = false
  try {
    const { data: _0x3b7b26 } = await supabase
      .from('users')
      .select('role')
      .ilike('username', _0xcb6991)
      .maybeSingle()
    currentRole = _0x3b7b26?.role || 'User'
    localStorage.setItem('chatRole', currentRole)
  } catch {
    currentRole = 'User'
    localStorage.setItem('chatRole', 'User')
  }
  logBox.style.display = currentRole === 'Admin' ? 'block' : 'none'
  loadMessages()
  initRealtime()
}
loadUser()
async function saveName() {
  const _0x3d32ab = nameInput.value.trim()
  if (!_0x3d32ab) {
    return alert('Enter a name!')
  }
  username = _0x3d32ab
  localStorage.setItem('chatUsername', _0x3d32ab)
  try {
    const { data: _0x544bea, error: _0x49d025 } = await supabase
      .from('users')
      .upsert({ username: _0x3d32ab }, { onConflict: ['username'] })
      .select()
    if (_0x49d025) {
      throw _0x49d025
    }
    const { data: _0x3bb830 } = await supabase
      .from('users')
      .select('role')
      .eq('username', _0x3d32ab)
      .maybeSingle()
    currentRole = _0x3bb830?.role || 'User'
    localStorage.setItem('chatRole', currentRole)
  } catch (_0x6e376) {
    console.error(_0x6e376)
    currentRole = 'User'
    localStorage.setItem('chatRole', 'User')
  }
  namePrompt.style.display = 'none'
  const _0x481653 = document.getElementById('controls')
  _0x481653.classList.add('visible')
  input.disabled = false
  button.disabled = false
  loadMessages()
  initRealtime()
  logBox.style.display = currentRole === 'Admin' ? 'block' : 'none'
  updateMessageLock()
  alert('Welcome, ' + _0x3d32ab + '! You are a ' + currentRole + '.')
}
async function sendMessage() {
  const _0x1426c2 = input.value.trim()
  if (!_0x1426c2 || !username) {
    return
  }
  const { data: _0x288178 } = await supabase
    .from('users')
    .select('blocked')
    .eq('username', username)
    .maybeSingle()
  if (_0x288178?.blocked) {
    alert('\u274C You are blocked from sending messages.')
    return
  }
  let _0x2dba55 = 'unknown'
  try {
    const _0x339a0a = await fetch('https://api.ipify.org?format=json')
    const _0x5c8409 = await _0x339a0a.json()
    _0x2dba55 = _0x5c8409.ip || 'unknown'
  } catch {}
  try {
    const { data: _0x1bebe9, error: _0x120841 } = await supabase
      .from('messages')
      .insert([
        {
          username: username,
          content: _0x1426c2,
          role: currentRole,
          is_pinned: false,
          ip: _0x2dba55,
        },
      ])
      .select()
    if (!_0x120841) {
      input.value = ''
      log('\u2705 Message sent to Supabase')
    }
  } catch (_0xe3a767) {
    log('\u274C Failed to send message', _0xe3a767, 'error')
  }
}
button.addEventListener('click', sendMessage)
input.addEventListener('keypress', (_0x43773d) => {
  if (_0x43773d.key === 'Enter' && !_0x43773d.shiftKey) {
    _0x43773d.preventDefault()
    sendMessage()
  }
})
function renderMessage(_0x5d3775) {
  let _0xb4e6e5 = messagesMap.get(_0x5d3775.id)
  const _0x105251 = currentRole
  if (!_0xb4e6e5) {
    _0xb4e6e5 = document.createElement('li')
    messagesMap.set(_0x5d3775.id, _0xb4e6e5)
    messagesList.appendChild(_0xb4e6e5)
  }
  _0xb4e6e5.innerHTML = ''
  _0xb4e6e5.className = ''
  if (_0x5d3775.role === 'Admin') {
    _0xb4e6e5.classList.add('admin')
  } else {
    if (_0x5d3775.role === 'Manager') {
      _0xb4e6e5.classList.add('manager')
    }
  }
  _0xb4e6e5.dataset.pinned = _0x5d3775.is_pinned ? 'true' : 'false'
  if (_0x5d3775.is_pinned) {
    _0xb4e6e5.style.border = '2px solid red'
  } else {
    _0xb4e6e5.style.border = ''
  }
  const _0x380205 = document.createElement('div')
  _0x380205.className = 'username'
  _0x380205.textContent =
    _0x5d3775.username === 'Frenchwizz' ? 'Takeo' : _0x5d3775.username
  _0xb4e6e5.appendChild(_0x380205)
  const _0x44e9e7 = document.createElement('div')
  _0x44e9e7.className = 'content'
  if (_0x5d3775.role === 'Admin') {
    _0x44e9e7.innerHTML = _0x5d3775.content
  } else {
    _0x44e9e7.textContent = _0x5d3775.content
  }
  _0xb4e6e5.appendChild(_0x44e9e7)
  const _0x133421 = document.createElement('div')
  _0x133421.className = 'adminControls'
  _0x133421.style.display = 'none'
  if (_0x105251 === 'Admin') {
    const _0x5960eb = document.createElement('button')
    _0x5960eb.textContent = 'Delete'
    _0x5960eb.onclick = async () => {
      if (_0xb4e6e5.dataset.pinned === 'true') {
        return alert('Cannot delete pinned message.')
      }
      try {
        await supabase.from('messages').delete().eq('id', _0x5d3775.id)
        _0xb4e6e5.remove()
        log('\uD83D\uDDD1 Deleted message id=' + _0x5d3775.id)
      } catch (_0x11eb61) {
        log('\u274C Delete failed', _0x11eb61, 'error')
      }
    }
    _0x133421.appendChild(_0x5960eb)
    const _0x1d4e49 = document.createElement('button')
    _0x1d4e49.textContent = 'Edit'
    _0x1d4e49.onclick = async () => {
      const _0x1be030 = prompt('Edit message:', _0x5d3775.content)
      if (!_0x1be030) {
        return
      }
      try {
        await supabase
          .from('messages')
          .update({ content: _0x1be030 })
          .eq('id', _0x5d3775.id)
        _0x5d3775.content = _0x1be030
        _0xb4e6e5.querySelector('.content').textContent = _0x1be030
        log('\u270F️ Edited message id=' + _0x5d3775.id)
      } catch (_0x4deb7c) {
        log('\u274C Edit failed', _0x4deb7c, 'error')
      }
    }
    _0x133421.appendChild(_0x1d4e49)
    const _0x1dc98b = document.createElement('button')
    _0x1dc98b.textContent = 'Change Name'
    _0x1dc98b.onclick = async () => {
      const _0xff3dc7 = prompt(
        'New username for ' + _0x5d3775.username + ':',
        _0x5d3775.username
      )
      if (!_0xff3dc7) {
        return
      }
      try {
        await supabase.from('users').upsert({ username: _0xff3dc7 })
        await supabase
          .from('messages')
          .update({ username: _0xff3dc7 })
          .eq('username', _0x5d3775.username)
        _0xb4e6e5.querySelector('.username').textContent = _0xff3dc7
        log(
          '\uD83D\uDD01 Changed username ' +
            _0x5d3775.username +
            ' \u2192 ' +
            _0xff3dc7
        )
      } catch (_0x348cd7) {
        log('\u274C Change name failed', _0x348cd7, 'error')
      }
    }
    _0x133421.appendChild(_0x1dc98b)
    const _0x4ba6a4 = document.createElement('button')
    _0x4ba6a4.className = 'blockBtn'
    _0x4ba6a4.textContent = _0x5d3775.blocked ? 'Unblock' : 'Block'
    _0x4ba6a4.onclick = async () => {
      try {
        const _0x3b9b24 = !_0x5d3775.blocked
        await supabase
          .from('users')
          .update({ blocked: _0x3b9b24 })
          .eq('username', _0x5d3775.username)
        _0x5d3775.blocked = _0x3b9b24
        _0x4ba6a4.textContent = _0x3b9b24 ? 'Unblock' : 'Block'
        log(
          (_0x3b9b24 ? '\uD83D\uDD12 Blocked' : '\uD83D\uDD13 Unblocked') +
            ' ' +
            _0x5d3775.username
        )
      } catch (_0x338735) {
        log('\u274C Block toggle failed', _0x338735, 'error')
      }
    }
    _0x133421.appendChild(_0x4ba6a4)
    const _0xd3e70b = document.createElement('button')
    _0xd3e70b.textContent = 'Force Logout'
    _0xd3e70b.onclick = async () => {
      if (_0x5d3775.username === username) {
        return alert('Cannot logout yourself.')
      }
      await supabase
        .from('users')
        .update({ forceLogout: true })
        .eq('username', _0x5d3775.username)
      log('\uD83D\uDD0C Forced logout for ' + _0x5d3775.username)
    }
    _0x133421.appendChild(_0xd3e70b)
    const _0x31a69a = document.createElement('button')
    _0x31a69a.textContent = 'Mute 5min'
    _0x31a69a.onclick = () => {
      const _0x4f20d5 = (window.__mutedUsers = window.__mutedUsers || {})
      _0x4f20d5[_0x5d3775.username] = Date.now() + 300000
      log('\uD83D\uDD07 Muted ' + _0x5d3775.username + ' for 5 minutes')
    }
    _0x133421.appendChild(_0x31a69a)
    const _0x4a179b = document.createElement('button')
    _0x4a179b.textContent = 'Export Chat'
    _0x4a179b.onclick = () => {
      const _0x3e45cb = Array.from(messagesList.querySelectorAll('li')).map(
        (_0x9f8f16) => ({
          username: _0x9f8f16.querySelector('.username')?.textContent,
          content: _0x9f8f16.querySelector('.content')?.textContent,
        })
      )
      const _0x17ed45 = new Blob([JSON.stringify(_0x3e45cb, null, 2)], {
        type: 'application/json',
      })
      const _0x5897f0 = document.createElement('a')
      _0x5897f0.href = URL.createObjectURL(_0x17ed45)
      _0x5897f0.download = 'chat.json'
      _0x5897f0.click()
      log('\uD83D\uDCE6 Exported chat.json')
    }
    _0x133421.appendChild(_0x4a179b)
    const _0x45da32 = document.createElement('button')
    _0x45da32.textContent = 'Delete by Keyword'
    _0x45da32.onclick = async () => {
      const _0xb03120 = prompt('Enter keyword to delete:')
      if (!_0xb03120) {
        return
      }
      const { data: _0x49ac9c } = await supabase.from('messages').select('*')
      const _0x1be8ef = _0x49ac9c
        .filter((_0x138eae) => _0x138eae.content?.includes(_0xb03120))
        .map((_0x10a082) => _0x10a082.id)
      await supabase.from('messages').delete().in('id', _0x1be8ef)
      document.querySelectorAll('#messages li').forEach((_0x367f38) => {
        if (
          _0x367f38.querySelector('.content')?.textContent.includes(_0xb03120)
        ) {
          _0x367f38.remove()
        }
      })
      log('\uD83E\uDDF9 Deleted all messages containing "' + _0xb03120 + '"')
    }
    _0x133421.appendChild(_0x45da32)
    const _0x250b3a = document.createElement('button')
    _0x250b3a.textContent = 'Delete User & Messages'
    _0x250b3a.onclick = async () => {
      if (
        !confirm('Delete ' + _0x5d3775.username + ' and all their messages?')
      ) {
        return
      }
      await supabase
        .from('messages')
        .delete()
        .eq('username', _0x5d3775.username)
      await supabase.from('users').delete().eq('username', _0x5d3775.username)
      document.querySelectorAll('#messages li').forEach((_0x455791) => {
        if (
          _0x455791.querySelector('.username')?.textContent ===
          _0x5d3775.username
        ) {
          _0x455791.remove()
        }
      })
      log('\uD83D\uDCA3 Nuked ' + _0x5d3775.username)
    }
    _0x133421.appendChild(_0x250b3a)
    const _0x1771e8 = document.createElement('button')
    _0x1771e8.textContent = 'User Info'
    _0x1771e8.onclick = () =>
      alert(
        'Username: ' +
          _0x5d3775.username +
          '\nRole: ' +
          _0x5d3775.role +
          '\nIP: ' +
          _0x5d3775.ip +
          '\nID: ' +
          _0x5d3775.id
      )
    _0x133421.appendChild(_0x1771e8)
    const _0x3393ee = document.createElement('button')
    _0x3393ee.textContent = 'Promote \u2192 Manager'
    _0x3393ee.onclick = async () => {
      await supabase.from('users').upsert({
        username: _0x5d3775.username,
        role: 'Manager',
      })
      log('\uD83D\uDC51 Promoted ' + _0x5d3775.username + ' to Manager')
      loadMessages()
    }
    _0x133421.appendChild(_0x3393ee)
    const _0x12c889 = document.createElement('button')
    _0x12c889.textContent = 'Promote \u2192 Admin'
    _0x12c889.onclick = async () => {
      await supabase.from('users').upsert({
        username: _0x5d3775.username,
        role: 'Admin',
      })
      log('\uD83D\uDC51 Promoted ' + _0x5d3775.username + ' to Admin')
      loadMessages()
    }
    _0x133421.appendChild(_0x12c889)
    const _0x47f7e4 = document.createElement('button')
    _0x47f7e4.textContent = 'Demote \u2192 User'
    _0x47f7e4.onclick = async () => {
      await supabase.from('users').upsert({
        username: _0x5d3775.username,
        role: 'User',
      })
      log('\uD83D\uDD3B Demoted ' + _0x5d3775.username + ' to User')
      loadMessages()
    }
    _0x133421.appendChild(_0x47f7e4)
    const _0x2d7daf = document.createElement('button')
    _0x2d7daf.textContent = _0x5d3775.is_pinned ? 'Unpin' : 'Pin'
    if (_0x5d3775.is_pinned) {
      _0xb4e6e5.dataset.pinned = 'true'
      _0xb4e6e5.style.border = '2px solid red'
    }
    _0x2d7daf.onclick = async () => {
      const _0x243ee1 = _0xb4e6e5.dataset.pinned === 'true'
      await supabase
        .from('messages')
        .update({ is_pinned: !_0x243ee1 })
        .eq('id', _0x5d3775.id)
      _0xb4e6e5.dataset.pinned = !_0x243ee1 ? 'true' : 'false'
      _0xb4e6e5.style.border = !_0x243ee1 ? '2px solid red' : ''
      _0x2d7daf.textContent = !_0x243ee1 ? 'Unpin' : 'Pin'
      log(
        (!_0x243ee1 ? '\uD83D\uDCCC Pinned' : '\u274C Unpinned') +
          ' message id=' +
          _0x5d3775.id
      )
      if (!_0x243ee1) {
        messagesList.insertBefore(_0xb4e6e5, messagesList.firstChild)
      } else {
        loadMessages()
      }
    }
    _0x133421.appendChild(_0x2d7daf)
  }
  _0xb4e6e5.appendChild(_0x133421)
  if (_0x105251 === 'Manager') {
    const _0x52c784 = document.createElement('div')
    _0x52c784.className = 'managerControls'
    _0x52c784.style.display = 'none'
    const _0x5eab85 = document.createElement('button')
    _0x5eab85.textContent = 'Delete'
    _0x5eab85.onclick = async () => {
      if (_0x5d3775.username !== username) {
        return alert('You can only delete your own messages.')
      }
      try {
        await supabase.from('messages').delete().eq('id', _0x5d3775.id)
        _0xb4e6e5.remove()
        log('\uD83D\uDDD1 Deleted your message id=' + _0x5d3775.id)
      } catch (_0x3db447) {
        log('\u274C Delete failed', _0x3db447, 'error')
      }
    }
    _0x52c784.appendChild(_0x5eab85)
    const _0x36e21e = document.createElement('button')
    _0x36e21e.textContent = 'Report'
    _0x36e21e.onclick = async () => {
      alert(
        '\uD83D\uDEA8 Reported message from ' +
          _0x5d3775.username +
          ': "' +
          _0x5d3775.content +
          '"'
      )
      log(
        '\uD83D\uDEA8 Reported message id=' + _0x5d3775.id + ' by ' + username
      )
    }
    _0x52c784.appendChild(_0x36e21e)
    _0xb4e6e5.appendChild(_0x52c784)
    _0xb4e6e5.addEventListener('click', (_0x3da874) => {
      _0x3da874.stopPropagation()
      _0x52c784.style.display =
        _0x52c784.style.display === 'none' ? 'flex' : 'none'
    })
    document.addEventListener('click', () => {
      _0x52c784.style.display = 'none'
    })
  }
  if (_0x105251 !== 'User') {
    _0xb4e6e5.addEventListener('click', (_0x39a01a) => {
      _0x39a01a.stopPropagation()
      _0x133421.style.display =
        _0x133421.style.display === 'none' ? 'flex' : 'none'
    })
    document.addEventListener('click', () => {
      _0x133421.style.display = 'none'
    })
  }
}
function handleRealtimeMessage(_0x4ae04c, _0x3003bb) {
  if (!_0x4ae04c) {
    return
  }
  if (_0x3003bb === 'INSERT') {
    renderMessage(_0x4ae04c)
  } else {
    if (_0x3003bb === 'UPDATE') {
      renderMessage(_0x4ae04c)
      const _0x4c8c0b = messagesMap.get(_0x4ae04c.id)
      if (_0x4c8c0b) {
        const _0x328b1b = _0x4c8c0b.querySelector('.blockBtn')
        if (_0x328b1b) {
          _0x328b1b.textContent = _0x4ae04c.blocked ? 'Unblock' : 'Block'
        }
        if (_0x328b1b && 'textContent' in _0x328b1b) {
          _0x328b1b.textContent = _0x4ae04c.blocked ? 'Unblock' : 'Block'
        }
      }
    }
  }
  if (
    _0x4ae04c.username === username &&
    typeof _0x4ae04c.blocked !== 'undefined'
  ) {
    input.disabled = _0x4ae04c.blocked
    button.disabled = _0x4ae04c.blocked
    if (_0x4ae04c.blocked) {
      alert('\u274C You have been blocked by an admin!')
    }
  } else {
    if (_0x3003bb === 'DELETE') {
      const _0x8d2cc8 = messagesMap.get(_0x4ae04c.id)
      if (_0x8d2cc8) {
        _0x8d2cc8.remove()
        messagesMap.delete(_0x4ae04c.id)
      }
      if (_0x4ae04c.username === username && _0x4ae04c.forceLogout) {
        alert('\u26A0️ You have been forcefully logged out by an admin!')
        localStorage.removeItem('chatUsername')
        localStorage.removeItem('chatRole')
        supabase
          .from('users')
          .update({ forceLogout: false })
          .eq('username', username)
          .then(() => location.reload())
      }
    }
  }
}
document.addEventListener('keydown', (_0x217ee0) => {
  if (
    _0x217ee0.ctrlKey &&
    _0x217ee0.altKey &&
    _0x217ee0.shiftKey &&
    _0x217ee0.key.toLowerCase() === 't'
  ) {
    _0x217ee0.preventDefault()
    localStorage.removeItem('chatUsername')
    localStorage.removeItem('chatRole')
    alert('\uD83D\uDC4B You have been signed out!')
    namePrompt.style.display = 'block'
    input.disabled = true
    button.disabled = true
    nameInput.value = ''
    currentRole = null
    if (logBox) {
      logBox.style.display = 'none'
    }
    updateMessageLock()
    saveNameBtn.onclick = saveName
  }
})
saveNameBtn.addEventListener('click', saveName)
