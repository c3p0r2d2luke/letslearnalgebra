// ======================== /gif SLASH COMMAND (FORCED POSITION FIX) ========================
(function setupGifSlashCommand() {
  const TENOR_API_KEY = "LIVDSRZULELA"; 
  const TENOR_LIMIT = 24;
  const DEBOUNCE_MS = 300;

  const inputEl = document.getElementById("messageInput");
  const controlsEl = document.getElementById("controls");

  if (!inputEl) {
    console.warn("[gif-picker] Input element missing.");
    return;
  }

  // 1. CREATE PICKER INSIDE BODY (Bypasses parent overflow:hidden)
  const picker = document.createElement("div");
  picker.id = "gifPicker";
  picker.className = "hidden";

  // FORCE STYLES IN-JS TO OVERRIDE CSS
  picker.style.position = "fixed"; 
  picker.style.zIndex = "9999999"; // Higher than everything
  picker.style.backgroundColor = "#2f3136";
  picker.style.border = "1px solid #40444b";
  picker.style.borderRadius = "8px";
  picker.style.boxShadow = "0 8px 32px rgba(0,0,0,0.5)";
  picker.style.width = "320px";
  picker.style.maxHeight = "360px";
  picker.style.overflowY = "auto";
  picker.style.display = "none"; // Start hidden
  picker.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))";
  picker.style.gap = "8px";
  picker.style.padding = "10px";
  picker.style.left = "0";
  picker.style.top = "0";

  // Prevent focus loss
  picker.addEventListener("mousedown", (e) => e.preventDefault());

  // Inject into BODY, not controlsEl
  document.body.appendChild(picker);

  const tenorCache = new Map();
  let searchTimer = null;
  let searchSeq = 0;

  const isOpen = () => picker.style.display !== "none";

  const open = (targetRect) => {
    picker.style.display = "grid"; // Force grid layout

    // Position it right above the input
    if (targetRect) {
      const bottom = window.innerHeight - targetRect.bottom;
      const left = targetRect.left;

      // Ensure it fits on screen
      const pickerHeight = 360;
      const spaceAbove = targetRect.top;

      if (spaceAbove > pickerHeight) {
        // Show above input
        picker.style.bottom = `${bottom + targetRect.height + 8}px`;
        picker.style.top = "auto";
        picker.style.left = `${left}px`;
      } else {
        // Show below input (if no space above)
        picker.style.top = `${targetRect.bottom + 8}px`;
        picker.style.bottom = "auto";
        picker.style.left = `${left}px`;
      }
    }
  };

  const close = () => {
    picker.style.display = "none";
    picker.innerHTML = "";
  };

  function setState(html, kind = "") {
    picker.innerHTML = `
      <div style="grid-column: 1/-1; padding: 8px; font-size: 12px; color: #949ba4; text-transform: uppercase; border-bottom: 1px solid #40444b; margin-bottom: 8px;">
        GIF Search <span style="float:right; opacity:0.6">Powered by Tenor</span>
      </div>
      <div class="gif-state ${kind}" style="padding: 20px; text-align: center; color: #dbdee1;">${html}</div>
    `;
  }

  function renderResults(results, query) {
    if (!results.length) {
      setState(`No results for "${query}".`);
      return;
    }

    // Clear header
    const header = document.createElement("div");
    header.style.gridColumn = "1/-1";
    header.style.padding = "8px";
    header.style.fontSize = "12px";
    header.style.color = "#949ba4";
    header.style.textTransform = "uppercase";
    header.style.borderBottom = "1px solid #40444b";
    header.style.marginBottom = "8px";
    header.innerHTML = `GIFs for "${query}" <span style="float:right; opacity:0.6">Powered by Tenor</span>`;
    picker.innerHTML = "";
    picker.appendChild(header);

    results.forEach((r) => {
      const m = (r.media && r.media[0]) || null;
      if (!m) return;
      const thumb = m.tinygif?.url || m.nanogif?.url || m.gif?.url;
      const full  = m.gif?.url || m.tinygif?.url;
      if (!thumb || !full) return;

      const item = document.createElement("div");
      item.className = "gif-item";
      item.style.cursor = "pointer";
      item.style.borderRadius = "8px";
      item.style.overflow = "hidden";
      item.style.position = "relative";
      item.style.aspectRatio = "1/1";
      item.style.background = "#202225";
      item.style.border = "2px solid transparent";
      item.style.transition = "border-color 0.12s, transform 0.12s";

      item.onmouseover = () => {
        item.style.borderColor = "#5865f2";
        item.style.transform = "translateY(-2px)";
      };
      item.onmouseout = () => {
        item.style.borderColor = "transparent";
        item.style.transform = "translateY(0)";
      };

      const img = document.createElement("img");
      img.src = thumb;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.display = "block";

      item.appendChild(img);
      item.addEventListener("click", () => sendGif(full));
      picker.appendChild(item);
    });
  }

  async function fetchTenor(query) {
    if (tenorCache.has(query)) return tenorCache.get(query);
    const url = `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}`
      + `&key=${TENOR_API_KEY}&limit=${TENOR_LIMIT}`
      + `&media_filter=minimal&contentfilter=high`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Tenor HTTP ${res.status}`);
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      tenorCache.set(query);
      return results;
    } catch (e) {
      console.error("[gif-picker] Fetch failed:", e);
      return [];
    }
  }

  async function sendGif(gifUrl) {
    close();
    inputEl.value = "";
    try {
      await sendMessage({ overrideContent: gifUrl, bypassLinkCheck: true });
    } catch (e) {
      console.error("[gif-picker] Failed to send GIF:", e);
    }
    inputEl.focus();
  }

  function handleInput() {
    const value = inputEl.value.trim();
  const match = value.match(/^\/gif(?:\s+(.*))?$/i);

  if (!match) {
    if (isOpen()) close();
    return;
  }

  // --- /gif permission gate (honors per-server "Send GIFs" role permission) ---
  const _legacyGifAllowed = ["Manager", "Admin", "SysManager", "SysAdmin"].includes(currentRole);
  if (!(userPermissions.send_gifs || _legacyGifAllowed)) {
    if (isOpen()) close();
    return;
  }
  // -----------------------------------------

  const query = (match[1] || "").trim();
  open(inputEl.getBoundingClientRect());

    if (!query) {
      setState("Type a search after <b>/gif</b> — e.g. <b>/gif cats</b>");
      return;
    }

    setState("Searching...");
    const seq = ++searchSeq;

    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (seq !== searchSeq) return;
      try {
        const results = await fetchTenor(query);
        if (seq !== searchSeq) return;
        if (isOpen()) renderResults(results, query);
      } catch (e) {
        if (seq !== searchSeq) return;
        if (isOpen()) setState("GIF search failed.", "error");
      }
    }, DEBOUNCE_MS);
  }

  // Keydown handler
  inputEl.addEventListener("keydown", (e) => {
    if (!isOpen()) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const first = picker.querySelector(".gif-item");
      if (first) first.click();
      else close();
    }
  }, true);

  inputEl.addEventListener("input", handleInput);

  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== inputEl && !picker.contains(document.activeElement)) {
        close();
      }
    }, 150);
  });

  document.addEventListener("mousedown", (e) => {
    if (!isOpen()) return;
    if (picker.contains(e.target) || e.target === inputEl) return;
    close();
  });

  console.log("✅ GIF Picker (Forced) Initialized!");
})();

// Add this helper near your other helper functions
async function markCurrentChannelAsRead() {
  if (!currentServerId || !currentChannelId) return;

  // If we have messages loaded, take the highest ID
  if (messagesMap.size > 0) {
    const maxId = Math.max(...Array.from(messagesMap.keys()));
    setServerCheckpoint(currentServerId, maxId);
    markServerMentionsRead(currentServerId); // Clears the badge
  }
}

// ================= EDGE FUNCTION PATCHES =================

async function censorContent(text, serverId = currentServerId) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("censor-message", {
      body: { text, serverId }
    });
    if (error) throw error;
    return data?.text || text;
  } catch (err) {
    console.warn("Censor fallback:", err);
    return text;
  }
}

async function resolveGifEdge(query) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("resolve-gif", {
      body: { query }
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn("GIF error:", err);
    return null;
  }
}

async function logIpEdge() {
  if (window._logIpUnavailable) return;
  try {
    await supabaseClient.functions.invoke("log-ip", {
      body: { username }
    });
  } catch (err) {
    try {
      const status = err?.status || (err?.response && err.response.status) || null;
      if (status === 404) {
        // Mark unavailable to avoid noisy repeated 404s
        window._logIpUnavailable = true;
        console.debug('[log-ip] function not found (404). Disabling further attempts.');
        return;
      }
    } catch (e) {}
    console.warn("IP log failed:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (typeof username !== "undefined") logIpEdge();
  }, 2000);
});

// ================= END PATCH =================

// --- GLOBAL VARIABLES FOR WEBRTC ---
let currentPeerConnections = new Map(); // Map: username -> RTCPeerConnection
let currentVoiceChannelId = null;
let localStream = null;
let voiceSignalingSub = null; // To track the subscription

// --- Voice participant state map: username -> {is_muted, is_deafened, is_admin_muted, is_admin_deafened}
let voiceParticipantState = new Map();
let voiceRoomSub = null; // realtime sub for voice_room_participants
let voiceOutputVolume = 1.0; // 0..1 — applied to all incoming audio elements
let selfDeafened = false;

// --- WebRTC connection state management ---
let pendingIceCandidates = new Map(); // Map: username -> Array of ICE candidates
let connectionStates = new Map(); // Map: username -> {remoteDescriptionSet: boolean}

function getVoiceParticipantBadges(state) {
  const badges = [];
  if (state.is_admin_muted) badges.push({ icon: '🔇', danger: true, title: 'Server Muted' });
  else if (state.is_muted) badges.push({ icon: '🎤', danger: false, title: 'Muted' });
  if (state.is_admin_deafened) badges.push({ icon: '🛑', danger: true, title: 'Server Deafened' });
  else if (state.is_deafened) badges.push({ icon: '🎧', danger: false, title: 'Deafened' });
  return badges;
}

function renderVoiceParticipant(usernameVal, state) {
  const grid = document.getElementById('voiceParticipantGrid');
  if (!grid) return;
  let el = grid.querySelector(`.voice-participant[data-username="${usernameVal}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'voice-participant';
    el.dataset.username = usernameVal;
    if (usernameVal === username) el.classList.add('is-self');

    const avatar = buildAvatarElement(usernameVal, 'voice-participant-avatar');
    const name = document.createElement('div');
    name.className = 'voice-participant-name';
    name.textContent = displayName(usernameVal);

    const badgeRow = document.createElement('div');
    badgeRow.className = 'voice-participant-badges';

    el.appendChild(avatar);
    el.appendChild(name);
    el.appendChild(badgeRow);
    grid.appendChild(el);

    // Right-click / long-press for admin actions
    el.addEventListener('contextmenu', (e) => {
      if (usernameVal === username) return; // can't admin-act on self via context menu
      e.preventDefault();
      openVoiceParticipantMenu(usernameVal, e.clientX, e.clientY);
    });
    let touchTimer = null;
    el.addEventListener('touchstart', (e) => {
      if (usernameVal === username) return;
      const touch = e.touches[0];
      touchTimer = setTimeout(() => {
        openVoiceParticipantMenu(usernameVal, touch.clientX, touch.clientY);
      }, 600);
    });
    el.addEventListener('touchend', () => { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } });
    el.addEventListener('touchmove', () => { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } });
  }

  // Refresh badges
  const badgeRow = el.querySelector('.voice-participant-badges');
  badgeRow.innerHTML = '';
  for (const b of getVoiceParticipantBadges(state || {})) {
    const span = document.createElement('span');
    span.className = 'vp-badge' + (b.danger ? ' danger' : '');
    span.textContent = b.icon;
    span.title = b.title;
    badgeRow.appendChild(span);
  }
}

function removeVoiceParticipant(usernameVal) {
  const grid = document.getElementById('voiceParticipantGrid');
  if (!grid) return;
  const el = grid.querySelector(`.voice-participant[data-username="${usernameVal}"]`);
  if (el) el.remove();
  voiceParticipantState.delete(usernameVal);
}

// Backwards-compatible alias used elsewhere in the file
function addParticipantToGrid(usernameVal) {
  const state = voiceParticipantState.get(usernameVal) || {};
  renderVoiceParticipant(usernameVal, state);
}

// --- SUBSCRIBE TO SIGNALING (FIXED ORDER) ---
function subscribeToVoiceSignaling(channelId) {
  if (voiceSignalingSub) {
    try { voiceSignalingSub.unsubscribe(); } catch {}
    voiceSignalingSub = null;
  }

  console.log(`📡 Subscribing to voice signaling for channel ${channelId}...`);

  voiceSignalingSub = supabaseClient
    .channel(`voice-signaling-${channelId}`)
    .on(
      "postgres_changes",
      { 
        event: "INSERT", 
        schema: "public", 
        table: "voice_signaling",
        filter: `channel_id=eq.${channelId}` 
      },
      async (payload) => {
        const data = payload.new;

        // Only process messages intended for me
        if (data.to_username !== username) return;

        let peerConn = currentPeerConnections.get(data.from_username);

        // If we don't have a PeerConnection yet, try to handle two cases:
        // - Incoming ICE candidate before PC exists -> buffer it
        // - Incoming SDP offer -> create/initiate a connection as the callee
        if (!peerConn) {
          if (data.ice_candidate) {
            const pending = pendingIceCandidates.get(data.from_username) || [];
            pending.push(data.ice_candidate);
            pendingIceCandidates.set(data.from_username, pending);
            console.log(`🧊 Buffered ICE candidate for ${data.from_username} (no peer yet)`);
            return;
          }

          if (data.sdp) {
            try {
              const sdpProbe = JSON.parse(data.sdp);
              if (sdpProbe.type === 'offer') {
                // Create a peer connection and wiring for incoming offer
                try {
                  await initiateConnection(data.from_username, channelId);
                  peerConn = currentPeerConnections.get(data.from_username);
                  if (!peerConn) {
                    console.warn('⚠️ initiateConnection did not create a peer connection for', data.from_username);
                    return;
                  }
                } catch (initErr) {
                  console.warn('⚠️ Failed to init peer connection for incoming offer:', initErr);
                  return;
                }
              } else {
                console.warn('⚠️ Received SDP for unknown peer (not an offer):', data.from_username, sdpProbe.type);
                return;
              }
            } catch (e) {
              console.warn('⚠️ Malformed SDP payload from', data.from_username);
              return;
            }
          } else {
            console.warn('⚠️ Received signaling for unknown user:', data.from_username);
            return;
          }
        }

        try {
          if (data.sdp) {
            // Received SDP Offer or Answer
            const sdpObj = JSON.parse(data.sdp);
            console.log(`📩 Processing SDP from ${data.from_username}: ${sdpObj.type}`);

            // For offers, set remote description first, then create an answer.
            try {
              if (sdpObj.type === 'offer') {
                await peerConn.setRemoteDescription(sdpObj);

                // Mark that remote description is set only after successful setRemoteDescription
                const state = connectionStates.get(data.from_username) || {};
                state.remoteDescriptionSet = true;
                connectionStates.set(data.from_username, state);

                const answer = await peerConn.createAnswer();
                await peerConn.setLocalDescription(answer);

                // Send Answer back
                await supabaseClient
                  .from("voice_signaling")
                  .insert({
                    channel_id: channelId,
                    from_username: username,
                    to_username: data.from_username,
                    sdp: JSON.stringify(answer)
                  });
              } else if (sdpObj.type === 'answer') {
                // Answers should be applied as remote description
                await peerConn.setRemoteDescription(sdpObj);

                const state = connectionStates.get(data.from_username) || {};
                state.remoteDescriptionSet = true;
                connectionStates.set(data.from_username, state);
              } else {
                // Unexpected SDP type — ignore
                console.warn('⚠️ Unsupported SDP type:', sdpObj.type);
              }
            } catch (sdpErr) {
              console.error('❌ Failed to process incoming SDP:', sdpErr);
            }

            // Process any pending ICE candidates (if remote description now set)
            const pending = pendingIceCandidates.get(data.from_username) || [];
            if (pending.length > 0) {
              console.log(`🧊 Processing ${pending.length} pending ICE candidates for ${data.from_username}`);
              for (const candidate of pending) {
                try {
                  await peerConn.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (iceErr) {
                  console.warn(`⚠️ Failed to add pending ICE candidate:`, iceErr.message);
                }
              }
              pendingIceCandidates.set(data.from_username, []);
            }
          } else if (data.ice_candidate) {
            // Received ICE Candidate
            console.log(`📩 Received ICE candidate from ${data.from_username}`);
            
            const state = connectionStates.get(data.from_username) || {};
            if (state.remoteDescriptionSet) {
              // Remote description is set, add candidate immediately
              await peerConn.addIceCandidate(new RTCIceCandidate(data.ice_candidate));
            } else {
              // Buffer ICE candidate until remote description is set
              const pending = pendingIceCandidates.get(data.from_username) || [];
              pending.push(data.ice_candidate);
              pendingIceCandidates.set(data.from_username, pending);
              console.log(`🧊 Buffering ICE candidate for ${data.from_username} (pending: ${pending.length})`);
            }
          }
        } catch (e) {
          console.error("❌ Error processing signal:", e);
        }
      }
    )
    .subscribe((status) => {
      console.log(`Realtime Status: ${status}`);
    });
}

// --- SUBSCRIBE TO VOICE ROOM PARTICIPANT CHANGES ---
function subscribeToVoiceRoom(channelId) {
  if (voiceRoomSub) {
    try { voiceRoomSub.unsubscribe(); } catch {}
    voiceRoomSub = null;
  }

  console.log(`📡 Subscribing to voice room participants for channel ${channelId}...`);

  voiceRoomSub = supabaseClient
    .channel(`voice-room-${channelId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "voice_room_participants",
        filter: `channel_id=eq.${channelId}`
      },
      async (payload) => {
        const p = payload.new;
        if (!p || !p.username) return;
        console.log(`🔊 voice room INSERT: ${p.username}`);
        voiceParticipantState.set(p.username, {
          is_muted: !!p.is_muted,
          is_deafened: !!p.is_deafened,
          is_admin_muted: !!p.is_admin_muted,
          is_admin_deafened: !!p.is_admin_deafened
        });
        renderVoiceParticipant(p.username, voiceParticipantState.get(p.username));

        // If a new user joined and we're already in the room, open a peer connection to them.
        if (p.username !== username && currentVoiceChannelId === channelId && !currentPeerConnections.has(p.username)) {
          try { await initiateConnection(p.username, channelId); }
          catch (e) { console.warn("⚠️ initiateConnection failed for", p.username, e); }
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "voice_room_participants",
        filter: `channel_id=eq.${channelId}`
      },
      (payload) => {
        const p = payload.new;
        if (!p || !p.username) return;
        const next = {
          is_muted: !!p.is_muted,
          is_deafened: !!p.is_deafened,
          is_admin_muted: !!p.is_admin_muted,
          is_admin_deafened: !!p.is_admin_deafened
        };
        voiceParticipantState.set(p.username, next);
        renderVoiceParticipant(p.username, next);

        // If admin-muted my own mic, force-mute locally and refresh the bar.
        if (p.username === username) {
          try { applyLocalMicState(); } catch {}
          try { applyLocalDeafenState(); } catch {}
          try { refreshVoiceControlButtons(); } catch {}
          try { updateSelfMuteBadge(); } catch {}
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "voice_room_participants",
        filter: `channel_id=eq.${channelId}`
      },
      (payload) => {
        const p = payload.old || {};
        if (!p.username) return;
        console.log(`👋 voice room DELETE: ${p.username}`);
        // Close peer connection if any
        const conn = currentPeerConnections.get(p.username);
        if (conn) {
          try { conn.close(); } catch {}
          currentPeerConnections.delete(p.username);
        }
        // Remove audio element
        const audioEl = document.getElementById(`audio-${p.username}`);
        if (audioEl) audioEl.remove();
        // Remove tile
        if (typeof removeVoiceParticipant === "function") removeVoiceParticipant(p.username);
        else voiceParticipantState.delete(p.username);
      }
    )
    .subscribe((status) => {
      console.log(`Voice Room Realtime Status: ${status}`);
    });
}

// --- CONNECT TO EXISTING USERS ---
async function connectToExistingUsers(channelId) {
  // Get all other participants
  const { data: participants, error } = await supabaseClient
    .from("voice_room_participants")
    .select("username")
    .eq("channel_id", channelId)
    .neq("username", username);

  if (error) {
    console.error("❌ Failed to fetch participants:", error);
    return;
  }

  if (!participants || participants.length === 0) {
    console.log("ℹ️ No other users in this voice channel yet.");
    return;
  }

  console.log(`🔗 Connecting to ${participants.length} users...`);

  for (const p of participants) {
    // Avoid connecting to myself or duplicate connections
    if (p.username === username || currentPeerConnections.has(p.username)) continue;

    await initiateConnection(p.username, channelId);
  }
}

// --- INITIATE CONNECTION (ROBUST VERSION) ---
async function initiateConnection(targetUsername, channelId) {
  console.log(`🤝 Initiating connection to ${targetUsername}...`);

  if (!localStream) {
    console.error("❌ initiateConnection failed: No localStream available.");
    return;
  }

  // Initialize connection state
  connectionStates.set(targetUsername, { remoteDescriptionSet: false });
  pendingIceCandidates.set(targetUsername, []);

  const peerConn = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });

window.activeConnections = window.activeConnections || {};
window.activeConnections[targetUsername] = peerConn;

  // Add local tracks
  localStream.getTracks().forEach(track => {
    peerConn.addTrack(track, localStream);
  });

  // Handle incoming remote stream
peerConn.ontrack = (event) => {
  console.log(`🎵 Received track from ${targetUsername}`);

  let stream = event.streams[0];
  if (!stream) {
    console.warn(`⚠️ No stream for ${targetUsername}, creating manually.`);
    stream = new MediaStream();
    if (event.track) stream.addTrack(event.track);
  }

  // Remove any existing audio element for this user
  const existingAudio = document.getElementById(`audio-${targetUsername}`);
  if (existingAudio) existingAudio.remove();

  const audio = document.createElement('audio');
  audio.srcObject = stream;
  audio.id = `audio-${targetUsername}`;
  audio.className = 'remote-voice';
  audio.autoplay = true;
  audio.muted = selfDeafened;
  audio.volume = Math.min(1, ((cachedUserVoiceVolume || 100) / 100) * 0.75);
  document.body.appendChild(audio);

  // Unlock AudioContext and force playback
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  audio.play().catch(err => console.warn(`⚠️ Autoplay blocked for ${targetUsername}:`, err.message));

  // Speaking indicator via MediaStream analyser (does NOT re-route audio)
  const analyser = ctx.createAnalyser();
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  analyser.fftSize = 256;
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  let wasSpeaking = false;

  function checkSpeaking() {
    if (!currentPeerConnections.has(targetUsername)) {
      try { ctx.close(); } catch {}
      return;
    }
    analyser.getByteFrequencyData(freqData);
    const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;
    const isSpeaking = avg > 20;
    const tile = document.querySelector(`.voice-participant[data-username="${targetUsername}"]`);
    if (tile) {
      const avatar = tile.querySelector('.voice-participant-avatar');
      if (avatar) avatar.classList.toggle('speaking', isSpeaking);
    }
    wasSpeaking = isSpeaking;
    requestAnimationFrame(checkSpeaking);
  }
  checkSpeaking();
};

  peerConn.onicecandidate = async (event) => {
    if (event.candidate) {
      try {
        await supabaseClient
          .from("voice_signaling")
          .insert({
            channel_id: channelId,
            from_username: username,
            to_username: targetUsername,
            ice_candidate: event.candidate.toJSON()
          });
      } catch (err) {
        console.error("Failed to send ICE candidate:", err);
      }
    }
  };

  try {
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);

    await supabaseClient
      .from("voice_signaling")
      .insert({
        channel_id: channelId,
        from_username: username,
        to_username: targetUsername,
        sdp: JSON.stringify(offer)
      });

    currentPeerConnections.set(targetUsername, peerConn);
    console.log(`✅ Offer sent to ${targetUsername}`);
  } catch (err) {
    console.error("❌ Failed to create/send offer:", err);
  }
}

// --- JOIN VOICE CHANNEL (UPDATED) ---
async function joinVoiceChannel(channelId) {
  const channel = channels.find(c => c.id === channelId);
  
  if (!channel || channel.channel_type !== 'voice') {
    console.error("❌ Cannot join: Not a voice channel");
    alert("❌ This is not a voice channel.");
    return;
  }

  if (currentVoiceChannelId && currentVoiceChannelId !== channelId) {
    leaveVoiceChannel();
  }

  try {
    console.log("🎤 Requesting microphone access...");
    const voiceConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      },
      video: false
    };
    localStream = await navigator.mediaDevices.getUserMedia(voiceConstraints);
    console.log("✅ Microphone access granted.");

    // CALL THE HELPER HERE
    await unlockAudioContext();

    const messagesList = document.getElementById('messages');
    const controlsBar = document.getElementById('controls');
    const replyBanner = document.getElementById('replyBanner');
    const voiceGrid = document.getElementById('voiceParticipantGrid');
    const voiceBar = document.getElementById('voiceControlBar');
    const vcStatusChannel = document.getElementById('vcStatusChannel');
    const currentChannelName = document.getElementById('currentChannelName');
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendButton');

    if (messagesList) messagesList.style.display = 'none';
    if (controlsBar) controlsBar.style.display = 'none';
    if (replyBanner) replyBanner.style.display = 'none';

    if (voiceGrid) {
      voiceGrid.style.display = 'flex';
      voiceGrid.innerHTML = ''; 
      voiceParticipantState.clear(); 
    }
    if (voiceBar) voiceBar.style.display = 'flex';
    
    if (vcStatusChannel) vcStatusChannel.textContent = channel.name;
    if (currentChannelName) {
      currentChannelName.textContent = `🎤 ${channel.name}`;
      currentChannelName.style.color = 'var(--success)'; 
    }
    if (input) {
      input.disabled = true;
      input.value = ''; 
    }
    if (sendBtn) sendBtn.disabled = true;

    try {
      await supabaseClient
        .from("voice_room_participants")
        .delete()
        .eq("channel_id", channelId)
        .eq("username", username);

      const { error: insertError } = await supabaseClient
        .from("voice_room_participants")
        .insert({
          channel_id: channelId,
          username: username,
          is_muted: false,
          is_deafened: false,
          is_admin_muted: false,
          is_admin_deafened: false
        });

      if (insertError) {
        console.error("DB Insert Error:", insertError);
        if (insertError.message.includes("column") && insertError.message.includes("does not exist")) {
          alert("❌ Database Error: Missing columns. Run SQL migration.");
          leaveVoiceChannel();
          return;
        }
        throw insertError;
      }
    } catch (dbErr) {
      console.error("Failed to update DB presence:", dbErr);
      alert("❌ Could not update voice status in database.");
      leaveVoiceChannel();
      return;
    }

    currentVoiceChannelId = channelId;
    selfMuted = false;
    selfDeafened = false;

    // Update channel_presence so the members tab shows this voice channel
    updateChannelPresence(channelId);

    subscribeToVoiceSignaling(channelId);
    subscribeToVoiceRoom(channelId);

    await connectToExistingUsers(channelId);

    const { data: participants, error: fetchError } = await supabaseClient
      .from("voice_room_participants")
      .select("username, is_muted, is_deafened, is_admin_muted, is_admin_deafened")
      .eq("channel_id", channelId);

    if (fetchError) {
      console.error("❌ Failed to fetch participants:", fetchError);
      voiceParticipantState.set(username, { is_muted: false, is_deafened: false, is_admin_muted: false, is_admin_deafened: false });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
    } else if (participants) {
      for (const p of participants) {
        if (p.username === username) continue;

        voiceParticipantState.set(p.username, {
          is_muted: !!p.is_muted,
          is_deafened: !!p.is_deafened,
          is_admin_muted: !!p.is_admin_muted,
          is_admin_deafened: !!p.is_admin_deafened
        });
        renderVoiceParticipant(p.username, voiceParticipantState.get(p.username));

        if (!currentPeerConnections.has(p.username)) {
          await initiateConnection(p.username, channelId);
        }
      }
      
      voiceParticipantState.set(username, { is_muted: false, is_deafened: false, is_admin_muted: false, is_admin_deafened: false });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
    } else {
      voiceParticipantState.set(username, { is_muted: false, is_deafened: false, is_admin_muted: false, is_admin_deafened: false });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
    }

    if (selfMuted) {
      const st = voiceParticipantState.get(username) || {};
      voiceParticipantState.set(username, { ...st, is_muted: true });
      renderVoiceParticipant(username, voiceParticipantState.get(username));
      await supabaseClient
        .from("voice_room_participants")
        .update({ is_muted: true })
        .eq("channel_id", channelId)
        .eq("username", username);
    }

    applyLocalMicState();
    applyLocalDeafenState();
    refreshVoiceControlButtons();

    console.log(`✅ Joined voice channel: ${channel.name}`);

  } catch (err) {
    console.error("Voice connection failed:", err);
    alert("Failed to join voice chat: " + err.message);
    leaveVoiceChannel();
    return;
  }
}

// --- LEAVE VOICE CHANNEL ---
function leaveVoiceChannel() {
  // 1. Capture IDs before clearing state
  const channelIdToLeave = currentVoiceChannelId;

  // 2. Delete DB presence row (async, fire-and-forget)
  if (channelIdToLeave && username) {
    supabaseClient
      .from("voice_room_participants")
      .delete()
      .eq("channel_id", channelIdToLeave)
      .eq("username", username)
      .then(({ error }) => {
        if (error) console.error("Failed to remove voice participant from DB:", error);
      });
  }

  // 3. Unsubscribe realtime channels
  if (voiceSignalingSub) {
    supabaseClient.removeChannel(voiceSignalingSub);
    voiceSignalingSub = null;
  }
  if (voiceRoomSub) {
    supabaseClient.removeChannel(voiceRoomSub);
    voiceRoomSub = null;
  }

  // 4. Close peer connections
  currentPeerConnections.forEach(conn => conn.close());
  currentPeerConnections.clear();
  
  // Clear WebRTC state maps
  pendingIceCandidates.clear();
  connectionStates.clear();

  // 5. Stop local media stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // 6. Hide voice UI, show text UI
  const voiceGrid = document.getElementById('voiceParticipantGrid');
  const voiceBar = document.getElementById('voiceControlBar');
  if (voiceGrid) voiceGrid.style.display = 'none';
  if (voiceBar) voiceBar.style.display = 'none';

  const messagesList = document.getElementById('messages');
  const controlsBar = document.getElementById('controls');
  const replyBanner = document.getElementById('replyBanner');
  if (messagesList) messagesList.style.display = 'block';
  if (controlsBar) controlsBar.style.display = 'flex';
  if (replyBanner) replyBanner.style.display = 'none';

  // 7. Re-enable text input
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendButton');
  if (input) {
    input.disabled = false;
    input.focus();
  }
  if (sendBtn) sendBtn.disabled = false;

  // 8. Reset header to the current text channel name
  const currentChannelNameEl = document.getElementById('currentChannelName');
  if (currentChannelNameEl) {
    const lastTextChannel = channels.find(c => c.id === lastTextChannelId);
    currentChannelNameEl.textContent = `# ${lastTextChannel?.name || 'general'}`;
    currentChannelNameEl.style.color = 'var(--text-main)';
  }

  // 9. Clear state
  voiceParticipantState.clear();
  currentVoiceChannelId = null;
  selfMuted = false;
  selfDeafened = false;
}

/* ======================================================================
   VOICE — local mic / deafen state, control bar wiring, admin menu
   ====================================================================== */
function applyLocalMicState() {
  // Mic should be off if either the user self-muted OR an admin server-muted them.
  const st = voiceParticipantState.get(username) || {};
  const shouldMute = !!selfMuted || !!st.is_admin_muted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !shouldMute; });
  }
}

function applyLocalDeafenState() {
  const st = voiceParticipantState.get(username) || {};
  const isDeafened = !!st.is_deafened || !!st.is_admin_deafened;
  // Mute every remote audio element when deafened.
  document.querySelectorAll('audio.remote-voice').forEach(a => {
    a.muted = isDeafened;
    if (!isDeafened) {
      a.volume = (cachedUserVoiceVolume || 100) / 100;
    }
  });
  // Deafened implies muted mic (Discord behavior): if we became deafened, also mute outgoing audio.
  if (isDeafened && localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = false; });
  } else {
    applyLocalMicState();
  }
}

function refreshVoiceControlButtons() {
  const st = voiceParticipantState.get(username) || {};
  const muteBtn = document.getElementById('vcMuteBtn');
  const deafBtn = document.getElementById('vcDeafenBtn');

  const isAdminMuted = !!st.is_admin_muted;
  const isAdminDeafened = !!st.is_admin_deafened;
  const isMuted = !!selfMuted || isAdminMuted;
  const isDeafened = !!st.is_deafened || isAdminDeafened;

  if (muteBtn) {
    muteBtn.classList.toggle('active', isMuted);
    muteBtn.classList.toggle('admin-locked', isAdminMuted);
    muteBtn.disabled = isAdminMuted;
    const icon = muteBtn.querySelector('.vc-icon');
    if (icon) icon.textContent = isMuted ? '🔇' : '🎤';
    muteBtn.title = isAdminMuted ? 'Server muted by admin' : (isMuted ? 'Unmute microphone' : 'Mute microphone');
    muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  }
  if (deafBtn) {
    deafBtn.classList.toggle('active', isDeafened);
    deafBtn.classList.toggle('admin-locked', isAdminDeafened);
    deafBtn.disabled = isAdminDeafened;
    const icon = deafBtn.querySelector('.vc-icon');
    if (icon) icon.textContent = isDeafened ? '🔇' : '🎧';
    deafBtn.title = isAdminDeafened ? 'Server deafened by admin' : (isDeafened ? 'Undeafen' : 'Deafen');
    deafBtn.setAttribute('aria-pressed', isDeafened ? 'true' : 'false');
  }
}

async function toggleVoiceMute() {
  if (!currentVoiceChannelId) return;
  const st = voiceParticipantState.get(username) || {};
  if (st.is_admin_muted) return; // can't override admin mute
  selfMuted = !selfMuted;
  localStorage.setItem("chatSelfMuted", selfMuted ? "true" : "false");
  const next = { ...st, is_muted: selfMuted };
  voiceParticipantState.set(username, next);
  applyLocalMicState();
  refreshVoiceControlButtons();
  renderVoiceParticipant(username, next);
  updateSelfMuteBadge();
  try {
    await supabaseClient
      .from("voice_room_participants")
      .update({ is_muted: selfMuted })
      .eq("channel_id", currentVoiceChannelId)
      .eq("username", username);
  } catch (err) { console.warn("mute sync failed:", err.message); }
}

async function toggleVoiceDeafen() {
  if (!currentVoiceChannelId) return;
  const st = voiceParticipantState.get(username) || {};
  if (st.is_admin_deafened) return;
  const newDeafened = !st.is_deafened;
  // Discord-style: deafen forces mute on, undeafen restores prior self-mute choice.
  const newMuted = newDeafened ? true : !!selfMuted;
  if (newDeafened) selfMuted = true;
  localStorage.setItem("chatSelfMuted", selfMuted ? "true" : "false");
  const next = { ...st, is_deafened: newDeafened, is_muted: newMuted };
  voiceParticipantState.set(username, next);
  applyLocalDeafenState();
  refreshVoiceControlButtons();
  renderVoiceParticipant(username, next);
  updateSelfMuteBadge();
  try {
    await supabaseClient
      .from("voice_room_participants")
      .update({ is_deafened: newDeafened, is_muted: newMuted })
      .eq("channel_id", currentVoiceChannelId)
      .eq("username", username);
  } catch (err) { console.warn("deafen sync failed:", err.message); }
}

// --- Admin context menu on a remote voice participant ---
let _activeVoiceMenuTarget = null;
function openVoiceParticipantMenu(targetUsername, x, y) {
  const menu = document.getElementById('voiceParticipantMenu');
  if (!menu) return;
  // Only Admin / SysAdmin / Manager (or Manager scoped to others) may use this menu.
  const canAdmin = ["Admin", "SysAdmin", "Manager"].includes(currentRole);
  if (!canAdmin) return;
  _activeVoiceMenuTarget = targetUsername;

  const st = voiceParticipantState.get(targetUsername) || {};
  // Toggle visibility of mute/unmute, deafen/undeafen based on current state.
  menu.querySelector('[data-action="server-mute"]').style.display    = st.is_admin_muted    ? 'none' : 'block';
  menu.querySelector('[data-action="server-unmute"]').style.display  = st.is_admin_muted    ? 'block' : 'none';
  menu.querySelector('[data-action="server-deafen"]').style.display  = st.is_admin_deafened ? 'none' : 'block';
  menu.querySelector('[data-action="server-undeafen"]').style.display= st.is_admin_deafened ? 'block' : 'none';

  // Position within viewport.
  menu.style.display = 'block';
  const w = menu.offsetWidth || 200;
  const h = menu.offsetHeight || 160;
  const px = Math.min(x, window.innerWidth - w - 8);
  const py = Math.min(y, window.innerHeight - h - 8);
  menu.style.left = px + 'px';
  menu.style.top  = py + 'px';
}

function closeVoiceParticipantMenu() {
  const menu = document.getElementById('voiceParticipantMenu');
  if (menu) menu.style.display = 'none';
  _activeVoiceMenuTarget = null;
}

async function applyAdminVoiceAction(targetUsername, action) {
  if (!currentVoiceChannelId || !targetUsername) return;
  const updates = {};
  if (action === 'server-mute')      updates.is_admin_muted    = true;
  if (action === 'server-unmute')    updates.is_admin_muted    = false;
  if (action === 'server-deafen')  { updates.is_admin_deafened = true;  updates.is_admin_muted = true; }
  if (action === 'server-undeafen')  updates.is_admin_deafened = false;

  if (action === 'disconnect') {
    try {
      await supabaseClient
        .from("voice_room_participants")
        .delete()
        .eq("channel_id", currentVoiceChannelId)
        .eq("username", targetUsername);
    } catch (err) { alert("❌ Disconnect failed: " + err.message); }
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("voice_room_participants")
      .update(updates)
      .eq("channel_id", currentVoiceChannelId)
      .eq("username", targetUsername);
    if (error) throw error;
  } catch (err) {
    alert("❌ Voice admin action failed: " + err.message);
  }
}

// Wire VC control bar + participant menu (idempotent).
(function wireVoiceControlsOnce() {
  function init() {
    const muteBtn  = document.getElementById('vcMuteBtn');
    const deafBtn  = document.getElementById('vcDeafenBtn');
    const leaveBtn = document.getElementById('vcLeaveBtn');
    if (muteBtn  && !muteBtn.dataset.wired)  { muteBtn.dataset.wired = "1";  muteBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggleVoiceMute(); }); }
    if (deafBtn  && !deafBtn.dataset.wired)  { deafBtn.dataset.wired = "1";  deafBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggleVoiceDeafen(); }); }
    if (leaveBtn && !leaveBtn.dataset.wired) { leaveBtn.dataset.wired = "1"; leaveBtn.addEventListener('click', (e) => { e.stopPropagation(); leaveVoiceChannel(); }); }

    const menu = document.getElementById('voiceParticipantMenu');
    if (menu && !menu.dataset.wired) {
      menu.dataset.wired = "1";
      menu.querySelectorAll('button[data-action]').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = b.dataset.action;
          const target = _activeVoiceMenuTarget;
          closeVoiceParticipantMenu();
          if (target) await applyAdminVoiceAction(target, action);
        });
      });
      // Close on outside click / scroll / esc.
      document.addEventListener('click', (e) => {
        if (menu.style.display === 'block' && !menu.contains(e.target)) closeVoiceParticipantMenu();
      });
      window.addEventListener('scroll', closeVoiceParticipantMenu, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVoiceParticipantMenu(); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ======================================================================
   GLOBAL MUTE (SysAdmin only) — uses users.muted_until
   ====================================================================== */
async function globalMuteUser(user) {
  if (currentSystemRole !== "SysAdmin") {
    alert("❌ Only SysAdmins can apply a global mute.");
    return;
  }
  const minutes = parseInt(prompt(`Globally mute ${user} for how many minutes? (applies everywhere)`), 10);
  if (!minutes || minutes <= 0) return;
  const until = new Date(Date.now() + minutes * 60000).toISOString();
  const { error } = await supabaseClient
    .from("users")
    .update({ muted_until: until })
    .eq("username", user);
  if (error) { alert("❌ Global mute failed: " + error.message); return; }
  alert(`🔇 ${user} has been globally muted for ${minutes} minutes.`);
}

async function globalUnmuteUser(user) {
  if (currentSystemRole !== "SysAdmin") {
    alert("❌ Only SysAdmins can clear a global mute.");
    return;
  }
  if (!confirm(`Clear the global mute on ${user}?`)) return;
  const { error } = await supabaseClient
    .from("users")
    .update({ muted_until: null })
    .eq("username", user);
  if (error) { alert("❌ Global unmute failed: " + error.message); return; }
  alert(`🔊 ${user}'s global mute has been cleared.`);
}

async function loadThemesAndApply() {
  let dbThemes = [];
  try {
    const { data, error } = await supabaseClient
      .from("themes")
      .select("id, name, display_name, css_variables, is_default")
      .order("is_default", { ascending: false })
      .order("display_name", { ascending: true });
    
    if (!error && Array.isArray(data)) {
      // Filter out any accidental built-in IDs just in case
      dbThemes = data.filter(theme => theme && theme.css_variables && !theme.id.startsWith("__builtin_"));
    }
  } catch (err) { 
    console.warn("Themes table unavailable:", err.message); 
  }

  // Since we removed built-ins, availableThemes is purely DB-driven
  availableThemes = dbThemes;

  // --- FALLBACK LOGIC ---
  // If the DB is empty, we don't want a broken UI. 
  // We will apply a hardcoded "Safe Default" style immediately.
  if (availableThemes.length === 0) {
    console.warn("⚠️ No themes found in DB. Applying safe fallback style.");
    applyFallbackStyle();
    // We do NOT set currentThemeId here so the user knows to pick one later
    return; 
  }

  // --- THEME SELECTION ---
  let chosen = null;
  const localThemeId = localStorage.getItem("chatThemeId");
  const preferredThemeId = currentThemeId || localThemeId;

  // 1. Prefer the user's saved custom theme from their profile
  if (preferredThemeId) {
    chosen = availableThemes.find(t => t.id === preferredThemeId);
  }

  // 2. Fall back to local storage if the saved profile theme was unavailable
  if (!chosen && localThemeId) {
    chosen = availableThemes.find(t => t.id === localThemeId);
  }

  // 3. Fallback to the DB's default flag
  if (!chosen) {
    chosen = availableThemes.find(t => t.is_default === true);
  }

  // 4. Fallback to the first theme if no default exists
  if (!chosen) {
    chosen = availableThemes[0];
  }

  if (chosen) {
    applyThemeVariables(chosen);
    currentThemeId = chosen.id;
    localStorage.setItem("chatThemeId", chosen.id);
  }

  // Refresh settings modal if open
  if (document.getElementById("userSettingsModal")?.style.display === "flex") {
    renderThemeList();
  }
}

// Helper to apply a hardcoded fallback if DB is empty
function applyFallbackStyle() {
  const root = document.documentElement;
  const fallback = {
    "--bg-main": "#2b2d31",
    "--bg-secondary": "#1e1f22",
    "--bg-tertiary": "#313338",
    "--text-main": "#dbdee1",
    "--text-muted": "#949ba4",
    "--accent": "#5865f2",
    "--danger": "#ed4245",
    "--success": "#3ba55d"
  };
  
  // Reset previous vars
  if (root._lastThemeVarKeys && Array.isArray(root._lastThemeVarKeys)) {
    root._lastThemeVarKeys.forEach((k) => root.style.removeProperty(k));
  }

  Object.entries(fallback).forEach(([k, v]) => {
    root.style.setProperty(k, v);
  });
  root._lastThemeVarKeys = Object.keys(fallback);
}

async function selectTheme(themeId) {
  const theme = availableThemes.find(t => t.id === themeId);
  if (!theme) return;
  
  applyThemeVariables(theme);
  
  // 🔥 CRITICAL FIX: Update the global state variable
  currentThemeId = themeId;

  // Save to Local Storage
  localStorage.setItem("chatThemeId", themeId);
  
  // Optional: Sync to DB
  try {
    await supabaseClient.from("users").update({ custom_theme_id: themeId }).eq("username", username);
  } catch (err) { console.warn("Save theme failed:", err.message); }

  renderThemeList();
}

// Coerce a theme's css_variables (which may come back from Postgres as a JSON
// string instead of a parsed object) into a plain object.
function _normalizeThemeVars(raw) {
  if (!raw) return null;
  let obj;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); }
    catch (err) { console.warn("Bad theme JSON, ignoring:", err.message, raw); return null; }
  } else if (typeof raw === "object") {
    obj = raw;
  } else {
    return null;
  }
  // Normalize keys: some themes store "accent" instead of "--accent".
  // Re-key anything that looks like a CSS var name but is missing the "--" prefix.
  const CSS_VAR_NAMES = new Set([
    "bg-main","bg-secondary","bg-tertiary","bg-hover","bg-elevated","bg-deepest",
    "bg-modal","bg-input","body-bg-from","body-bg-to",
    "text-main","text-muted","text-link","text-on-accent",
    "accent","accent-strong","danger","success","warning","surface-border"
  ]);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith("--") && CSS_VAR_NAMES.has(k)) {
      out["--" + k] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Many themes only define a small core palette (--bg-main, --bg-secondary,
// --bg-tertiary, --text-main, --accent, etc.). The CSS, however, references
// a wider set of variables (--bg-modal, --bg-input, --bg-deepest,
// --surface-border, --warning, --text-on-accent, --body-bg-from/to, ...).
// If we don't fill those in, the missing vars stay at their dark-Discord
// defaults and the theme appears to "barely do anything." This expander
// derives sensible values for every var the CSS uses from whatever the
// theme actually provides.
function _expandThemeVariables(vars) {
  const out = { ...vars };
  const get = (k) => (typeof out[k] === "string" && out[k]) ? out[k] : null;

  // --- Background ladder (deepest -> elevated) ---
  const bgMain      = get("--bg-main")      || "#2b2d31";
  const bgSecondary = get("--bg-secondary") || _shadeColor(bgMain, -10);
  const bgTertiary  = get("--bg-tertiary")  || _shadeColor(bgMain,  +6);
  const bgHover     = get("--bg-hover")     || _shadeColor(bgMain, +10);
  const bgElevated  = get("--bg-elevated")  || _shadeColor(bgMain, +16);
  const bgDeepest   = get("--bg-deepest")   || _shadeColor(bgSecondary, -20);
  const bgModal     = get("--bg-modal")     || bgTertiary;
  const bgInput     = get("--bg-input")     || bgSecondary;

  out["--bg-main"]      = bgMain;
  out["--bg-secondary"] = bgSecondary;
  out["--bg-tertiary"]  = bgTertiary;
  out["--bg-hover"]     = bgHover;
  out["--bg-elevated"]  = bgElevated;
  out["--bg-deepest"]   = bgDeepest;
  out["--bg-modal"]     = bgModal;
  out["--bg-input"]     = bgInput;

  // --- Body gradient backdrop ---
  out["--body-bg-from"] = get("--body-bg-from") || _shadeColor(bgMain, -4);
  out["--body-bg-to"]   = get("--body-bg-to")   || _shadeColor(bgMain, -16);

  // --- Text colors ---
  const textMain  = get("--text-main")  || "#dbdee1";
  const textMuted = get("--text-muted") || _mix(textMain, bgMain, 0.45);
  out["--text-main"]      = textMain;
  out["--text-muted"]     = textMuted;
  out["--text-link"]      = get("--text-link")      || get("--accent") || "#00a8fc";
  out["--text-on-accent"] = get("--text-on-accent") || _bestContrast(get("--accent") || "#5865f2");

  // --- Accent / status colors ---
  const accent = get("--accent") || "#5865f2";
  out["--accent"]         = accent;
  out["--accent-strong"] = get("--accent-strong") || _shadeColor(accent, +12);
  out["--danger"]         = get("--danger")  || "#ed4245";
  out["--success"]        = get("--success") || "#3ba55d";
  out["--warning"]        = get("--warning") || "#faa61a";

  // --- Borders ---
  // Use a luminance-aware translucent overlay so borders are visible on both
  // very-dark and light themes.
  out["--surface-border"] = get("--surface-border")
    || (_isLight(bgMain) ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)");

  return out;
}

// --- Tiny color helpers (no deps) -------------------------------------
function _hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function _rgbToHex(r,g,b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function _shadeColor(hex, percent) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return hex;
  const amt = Math.round(2.55 * percent);
  return _rgbToHex(rgb.r + amt, rgb.g + amt, rgb.b + amt);
}
function _mix(hexA, hexB, ratio) {
  const a = _hexToRgb(hexA), b = _hexToRgb(hexB);
  if (!a || !b) return hexA;
  return _rgbToHex(a.r*(1-ratio)+b.r*ratio, a.g*(1-ratio)+b.g*ratio, a.b*(1-ratio)+b.b*ratio);
}
function _luminance(hex) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return 0.5;
  const f = (c) => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*f(rgb.r) + 0.7152*f(rgb.g) + 0.0722*f(rgb.b);
}
function _isLight(hex) { return _luminance(hex) > 0.5; }
function _bestContrast(hex) { return _isLight(hex) ? "#1a1a1a" : "#ffffff"; }

function applyThemeVariables(theme) {
  if (!theme) return;
  const raw = _normalizeThemeVars(theme.css_variables);
  if (!raw) return;
  const vars = _expandThemeVariables(raw);
  const root = document.documentElement;

  // Reset any previously-set inline overrides so vars from the *previous*
  // theme don't bleed through when the new theme omits them.
  if (root._lastThemeVarKeys && Array.isArray(root._lastThemeVarKeys)) {
    root._lastThemeVarKeys.forEach((k) => root.style.removeProperty(k));
  }

  Object.entries(vars).forEach(([k, v]) => {
    if (typeof v === "string") root.style.setProperty(k, v);
  });
  root._lastThemeVarKeys = Object.keys(vars);

  // Cache the parsed (raw) object locally for instant apply on next load —
  // we re-expand on read so logic changes here apply immediately.
  try { localStorage.setItem("chatThemeVars", JSON.stringify(raw)); } catch {}
}

// Restore last theme variables ASAP so first paint isn't a flash.
(function applyCachedTheme() {
  try {
    const cached = localStorage.getItem("chatThemeVars");
    if (!cached) return;
    const raw = JSON.parse(cached);
    if (!raw || typeof raw !== "object") return;
    const vars = (typeof _expandThemeVariables === "function") ? _expandThemeVariables(raw) : raw;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      if (typeof v === "string") root.style.setProperty(k, v);
    });
    root._lastThemeVarKeys = Object.keys(vars);
  } catch {}
})();

function renderThemeList() {
  const list = document.getElementById("settingsThemeList");
  if (!list) return;
  list.innerHTML = "";
  if (!availableThemes.length) {
    list.innerHTML = '<div class="settings-theme-loading">No themes available.</div>';
    return;
  }
  availableThemes.forEach(theme => {
    const card = document.createElement("div");
    card.className = "settings-theme-card";
    if (theme.id === currentThemeId || (!currentThemeId && theme.is_default)) {
      card.classList.add("selected");
    }
    const v = _normalizeThemeVars(theme.css_variables) || {};
    const p1 = v["--accent"] || "#5865f2";
    const p2 = v["--accent-strong"] || v["--text-link"] || "#00a8fc";
    const bg = v["--bg-main"] || "#2b2d31";
    const text = v["--text-main"] || "#dbdee1";
    card.innerHTML = `
      <div class="settings-theme-preview" style="background:linear-gradient(135deg, ${p1}, ${p2});">
        <div style="position:relative;height:100%;">
          <div style="position:absolute;inset:8px;background:${bg};border-radius:6px;display:flex;align-items:center;padding:0 8px;">
            <div style="width:14px;height:14px;border-radius:50%;background:${p1};margin-right:6px;"></div>
            <div style="height:6px;flex:1;background:${text};opacity:0.5;border-radius:3px;"></div>
          </div>
        </div>
      </div>
      <div class="settings-theme-name">${escapeHTML(theme.display_name || theme.name)}</div>
    `;
    card.addEventListener("click", () => selectTheme(theme.id));
    list.appendChild(card);
  });
}

/* ======================================================================
   USER SETTINGS MODAL — open/close, tabs, panes
   ====================================================================== */
function openUserSettings(initialTab = "account") {
  if (!username) return;
  const modal = document.getElementById("userSettingsModal");
  if (!modal) return;

  // Populate fields with current data
  populateSettingsAccountTab();
  populateSettingsProfileTab();
  populateSettingsNotificationsTab();
  populateSettingsVoiceTab();
  populateSettingsStatusTab();
  renderThemeList();
  refreshSettingsConnections();

  switchSettingsTab(initialTab);
  modal.style.display = "flex";
}

function closeUserSettings() {
  const modal = document.getElementById("userSettingsModal");
  if (modal) modal.style.display = "none";
}

function switchSettingsTab(name) {
  document.querySelectorAll("#userSettingsModal .settings-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll("#userSettingsModal .settings-pane").forEach(p => {
    p.classList.toggle("active", p.dataset.pane === name);
  });
}

function populateSettingsAccountTab() {
  document.getElementById("settingsDisplayName").textContent = getEffectiveDisplayName(username) || username;
  document.getElementById("settingsUsername").textContent = `@${username}`;
  // Email
  supabaseClient.auth.getUser().then(({ data }) => {
    const email = data?.user?.email || "—";
    const el = document.getElementById("settingsEmailValue");
    if (el) el.textContent = email;
  });
  // Avatar
  const avatar = getEffectiveAvatarUrl(username) || currentUserAvatarUrl || "";
  const img = document.getElementById("settingsAvatarImage");
  const fallback = document.getElementById("settingsAvatarFallback");
  if (avatar) {
    img.src = avatar;
    img.style.display = "block";
    fallback.style.display = "none";
  } else {
    img.style.display = "none";
    fallback.style.display = "flex";
    fallback.textContent = getInitials(username);
  }
}

function populateSettingsProfileTab() {
  const bioEl = document.getElementById("settingsBio");
  const statusEl = document.getElementById("settingsStatus");
  if (bioEl) bioEl.value = currentBio || "";
  if (statusEl) statusEl.value = currentCustomStatus || "";
}

function populateSettingsNotificationsTab() {
  const m = document.getElementById("settingsNotifyMentions");
  const r = document.getElementById("settingsNotifyReplies");
  const a = document.getElementById("settingsNotifyAll");
  if (m) m.checked = currentNotificationPrefs.mentions !== false;
  if (r) r.checked = currentNotificationPrefs.replies !== false;
  if (a) a.checked = !!currentNotificationPrefs.all_messages;
}

function populateSettingsVoiceTab() {
  const vol = document.getElementById("settingsVoiceVolume");
  const valEl = document.getElementById("settingsVoiceVolumeValue");
  if (vol) vol.value = cachedUserVoiceVolume;
  if (valEl) valEl.textContent = cachedUserVoiceVolume;
  const sm = document.getElementById("settingsSelfMuteToggle");
  if (sm) sm.checked = !!selfMuted;
}

function populateSettingsStatusTab() {
  document.querySelectorAll("#userSettingsModal .status-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.status === currentPresenceStatus);
  });
}

async function saveProfileChanges() {
  const bio = (document.getElementById("settingsBio")?.value || "").trim();
  const status = (document.getElementById("settingsStatus")?.value || "").trim();
  const msg = document.getElementById("settingsProfileMsg");
  try {
    const { error } = await supabaseClient.from("users").update({
      profile_description: bio,
      profile_status: status
    }).eq("username", username);
    if (error) throw error;
    currentBio = bio;
    currentCustomStatus = status;
    if (msg) { msg.textContent = "✅ Saved"; msg.classList.remove("error"); }
    setTimeout(() => { if (msg) msg.textContent = ""; }, 2200);
  } catch (err) {
    if (msg) { msg.textContent = "❌ " + err.message; msg.classList.add("error"); }
  }
}

async function saveNotificationChanges() {
  const prefs = {
    mentions: document.getElementById("settingsNotifyMentions").checked,
    replies: document.getElementById("settingsNotifyReplies").checked,
    all_messages: document.getElementById("settingsNotifyAll").checked
  };
  const msg = document.getElementById("settingsNotifyMsg");
  try {
    const { error } = await supabaseClient.from("users").update({
      notification_preferences: prefs
    }).eq("username", username);
    if (error) throw error;
    currentNotificationPrefs = prefs;
    if (msg) { msg.textContent = "✅ Saved"; msg.classList.remove("error"); }
    setTimeout(() => { if (msg) msg.textContent = ""; }, 2200);
  } catch (err) {
    if (msg) { msg.textContent = "❌ " + err.message; msg.classList.add("error"); }
  }
}

function setPresenceStatus(status) {
  if (!["online", "idle", "dnd", "invisible"].includes(status)) return;
  currentPresenceStatus = status;
  localStorage.setItem("chatPresenceStatus", status);
  populateSettingsStatusTab();
  updatePresenceDot();
}

function updatePresenceDot() {
  const dot = document.getElementById("profileBtnPresenceDot");
  if (!dot) return;
  dot.dataset.status = currentPresenceStatus;
  dot.title = "Status: " + currentPresenceStatus;
}

const CONNECTION_PROVIDERS = [
  { id: "google",   name: "Google",    icon: "G",  brand: "#ea4335" },
  { id: "github",   name: "GitHub",    icon: "GH", brand: "#1f2328" },
  { id: "discord",  name: "Discord",   icon: "D",  brand: "#5865f2" },
  { id: "azure",    name: "Microsoft", icon: "M",  brand: "#0067b8" },
  { id: "spotify",  name: "Spotify",   icon: "♫",  brand: "#1DB954" }
];

function getProviderHandleFromIdentity(identity) {
  const d = identity?.identity_data || {};
  return d.user_name || d.preferred_username || d.global_name || d.full_name || d.name || d.email || "";
}

async function refreshSettingsConnections() {
  const list = document.getElementById("settingsConnectionsList");
  const status = document.getElementById("settingsConnectionsStatus");
  if (!list) return;
  list.innerHTML = '<div class="connections-loading">Loading connections…</div>';

  let identities = [];
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    identities = user?.identities || [];
  } catch (err) {
    list.innerHTML = '<div class="connections-loading error">Could not load linked accounts.</div>';
    if (status) { status.textContent = "❌ " + err.message; status.classList.add("error"); }
    return;
  }
  if (status) { status.textContent = ""; status.classList.remove("error"); }

  // Also fetch the user's spotify token state from users table so Spotify can be shown here
  let spotifyRow = null;
  try {
    const { data: userRow } = await supabaseClient.from('users').select('spotify_access_token').eq('username', username).maybeSingle();
    spotifyRow = userRow || null;
  } catch (e) {
    console.warn('[settings] Could not read spotify link state:', e && e.message);
  }

  list.innerHTML = "";
  CONNECTION_PROVIDERS.forEach(p => {
    let linked = identities.find(i => i.provider === p.id);
    let handle = linked ? getProviderHandleFromIdentity(linked) : "";

    // Special-case Spotify: not an auth.identity in Supabase, tracked on users table
    if (p.id === 'spotify') {
      const isLinked = !!(spotifyRow && spotifyRow.spotify_access_token);
      linked = isLinked ? { provider: 'spotify' } : null;
      handle = isLinked ? 'Connected' : '';
    } else if (p.id === 'discord') {
      const currentAcc = window.discordAccount || (typeof discordAccount !== "undefined" ? discordAccount : null);
      const isLinked = !!currentAcc;
      linked = isLinked ? { provider: 'discord' } : null;
      handle = isLinked ? (currentAcc?.discord_username || 'Connected') : '';
    }

    const card = document.createElement("div");
    card.className = "connection-card" + (linked ? " is-linked" : "");
    card.innerHTML = `
      <div class="connection-card-icon" style="background:${p.brand};">${escapeHTML(p.icon)}</div>
      <div class="connection-card-body">
        <div class="connection-card-name">${escapeHTML(p.name)}</div>
        <div class="connection-card-handle">${linked
          ? (handle ? escapeHTML(handle) : "Linked")
          : "Not connected"}</div>
      </div>
      <button class="connection-card-btn ${linked ? 'disconnect' : 'connect'}"
              data-provider="${p.id}" data-action="${linked ? 'disconnect' : 'connect'}">
        ${linked ? "Disconnect" : "Connect"}
      </button>
    `;
    list.appendChild(card);
  });

  // Wire buttons (delegated each refresh — fine since list was rebuilt).
  list.querySelectorAll(".connection-card-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      const action = btn.dataset.action;
      btn.disabled = true;
      try {
        if (provider === 'spotify') {
          if (action === 'connect') {
            await linkSpotify();
            const start = Date.now();
            const timeout = 10000; // ms
            const interval = 800; // ms
            let found = false;
            while (Date.now() - start < timeout) {
              try {
                const { data: userRow } = await supabaseClient.from('users').select('spotify_access_token').eq('username', username).maybeSingle();
                if (userRow && userRow.spotify_access_token) { found = true; break; }
              } catch (e) { /* ignore transient errors */ }
              await new Promise(r => setTimeout(r, interval));
            }
            await refreshSettingsConnections();
            if (!found) console.debug('[settings] Spotify token not observed after connect; UI refreshed anyway.');
          } else if (action === 'disconnect') {
            if (!confirm('Disconnect your Spotify account?')) { btn.disabled = false; return; }
            await unlinkSpotify();
            await refreshSettingsConnections();
          } else {
            console.debug('[settings] Spotify connect is disabled for this deployment.');
            btn.disabled = false;
            return;
          }
        } else if (provider === 'discord') {
          if (action === 'connect') {
            if (typeof initiateDiscordOAuth === "function") {
              initiateDiscordOAuth();
            }
          } else {
            if (!confirm('Disconnect your Discord account?')) { btn.disabled = false; return; }
            if (typeof disconnectDiscordAccount === "function") {
              await disconnectDiscordAccount();
            }
            await refreshSettingsConnections();
          }
        } else {
          if (action === "connect") {
            await linkOAuthIdentity(provider);
          } else {
            if (!confirm(`Disconnect your ${provider} account?`)) { btn.disabled = false; return; }
            await unlinkOAuthIdentity(provider);
            await refreshSettingsConnections();
          }
        }
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/* ======================================================================
   USER SETTINGS — wire up button events (run after DOM ready)
   ====================================================================== */
(function wireUserSettingsModal() {
  function init() {
    const modal = document.getElementById("userSettingsModal");
    if (!modal) return;

    // Close handlers
    const closeBtn = document.getElementById("closeUserSettingsModal");
    if (closeBtn) closeBtn.addEventListener("click", closeUserSettings);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeUserSettings(); });

    // Tab switching
    modal.querySelectorAll(".settings-tab").forEach(tab => {
      const name = tab.dataset.tab;
      if (!name) return;
      tab.addEventListener("click", () => switchSettingsTab(name));
    });

    // Logout
    const logout = document.getElementById("settingsLogoutBtn");
    if (logout) logout.addEventListener("click", () => performLogout());

    // Account: Edit / Change Email / Change Password
    const editProfile = document.getElementById("settingsEditProfileBtn");
    if (editProfile) editProfile.addEventListener("click", () => {
      closeUserSettings();
      openUserProfile(username, currentServerId);
    });
    const chgEmail = document.getElementById("settingsChangeEmailBtn");
    if (chgEmail) chgEmail.addEventListener("click", () => changeAccountEmail());
    const chgPwd = document.getElementById("settingsChangePasswordBtn");
    if (chgPwd) chgPwd.addEventListener("click", () => changeAccountPassword());

    // Avatar change → reuse the existing file input
    const avatarBox = document.getElementById("settingsAvatarContainer");
    if (avatarBox) avatarBox.addEventListener("click", () => {
      const inp = document.getElementById("avatarInput");
      if (inp) inp.click();
    });

    // Profile tab save
    const saveProfile = document.getElementById("settingsSaveProfileBtn");
    if (saveProfile) saveProfile.addEventListener("click", saveProfileChanges);

    // Notifications save
    const saveNotif = document.getElementById("settingsSaveNotifyBtn");
    if (saveNotif) saveNotif.addEventListener("click", saveNotificationChanges);

    // Voice volume slider
    const vol = document.getElementById("settingsVoiceVolume");
    const volVal = document.getElementById("settingsVoiceVolumeValue");
    if (vol) vol.addEventListener("input", () => {
      cachedUserVoiceVolume = parseInt(vol.value, 10) || 100;
      if (volVal) volVal.textContent = cachedUserVoiceVolume;
      localStorage.setItem("chatVoiceVolume", String(cachedUserVoiceVolume));
      // Apply to all currently-playing remote audios.
      document.querySelectorAll("audio.remote-voice").forEach(a => { a.volume = cachedUserVoiceVolume / 100; });
    });

    // Self-mute toggle inside voice tab
    const selfMuteToggle = document.getElementById("settingsSelfMuteToggle");
    if (selfMuteToggle) selfMuteToggle.addEventListener("change", () => {
      if (selfMuteToggle.checked !== selfMuted) toggleSelfMute();
    });

    // Status options (Online / Idle / DND / Invisible)
    modal.querySelectorAll(".status-option").forEach(btn => {
      btn.addEventListener("click", () => setPresenceStatus(btn.dataset.status));
    });

    // (Connections — now rendered as cards; click handlers wired in refreshSettingsConnections.)

    // Danger Zone — Delete Account
    const delBtn = document.getElementById("settingsDeleteAccountBtn");
    if (delBtn) delBtn.addEventListener("click", () => deleteMyAccount());

    // Self-mute mic button on user panel
    const muteBtn = document.getElementById("selfMuteBtn");
    if (muteBtn) {
      muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelfMute();
      });
    }
    // Gear icon → open settings
    const gear = document.getElementById("openSettingsBtn");
    if (gear) {
      gear.addEventListener("click", (e) => {
        e.stopPropagation();
        openUserSettings("account");
      });
    }

    updateSelfMuteBadge();
    updatePresenceDot();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ============================================================
 *  CHANNEL PERMISSIONS  (channel_permissions table)
 *  Discord-style per-channel role/member overrides:
 *    - can_view, can_send, can_manage
 *    - row keyed by (channel_id, role_id|username, NULLs allowed)
 *    - resolution order: @everyone (no role/no user)
 *                      → role overrides (any of the user's role ids)
 *                      → user override (by username)
 *                      → DENY beats ALLOW within the same tier
 * ============================================================ */

let channelPermissionsCache = new Map(); // channel_id -> [rows]
let currentUserRoleIds = new Set();      // role ids the logged-in user holds in current server
let allServerRolesCache = [];            // for the modal Roles tab

async function loadChannelPermissionsForServer() {
  channelPermissionsCache = new Map();
  currentUserRoleIds = new Set();
  if (!currentServerId || !channels || !channels.length) return;

  const channelIds = channels.map(c => c.id);
  try {
    const [permsRes, rolesRes, myMemberRes] = await Promise.all([
      supabaseClient.from("channel_permissions").select("*").in("channel_id", channelIds),
      supabaseClient.from("server_roles").select("id, role, name, color").eq("server_id", currentServerId),
      // member id of current user in this server (needed for role-link lookup)
      username
        ? supabaseClient.from("server_members").select("id, primary_role_id").eq("server_id", currentServerId).eq("username", username).maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    allServerRolesCache = rolesRes?.data || [];

    // Now that we have member id, fetch real role links
    if (myMemberRes?.data?.id) {
      const myMemberId = myMemberRes.data.id;
      const { data: links } = await supabaseClient
        .from("server_member_roles")
        .select("role_id")
        .eq("server_id", currentServerId)
        .eq("member_id", myMemberId);
      (links || []).forEach(l => l.role_id && currentUserRoleIds.add(l.role_id));
      if (myMemberRes.data.primary_role_id) currentUserRoleIds.add(myMemberRes.data.primary_role_id);
    }

    (permsRes?.data || []).forEach(row => {
      if (!channelPermissionsCache.has(row.channel_id)) channelPermissionsCache.set(row.channel_id, []);
      channelPermissionsCache.get(row.channel_id).push(row);
    });
  } catch (err) {
    console.warn("⚠️ loadChannelPermissionsForServer failed:", err?.message || err);
  }
}

// Resolve effective {can_view, can_send, can_manage} for the CURRENT user in a given channel.
// Returns null if there are no overrides at all (caller treats null as "use defaults").
function getEffectiveChannelPermission(channelId) {
  const rows = channelPermissionsCache.get(channelId);
  if (!rows || !rows.length) return null;

  const result = { can_view: true, can_send: true, can_manage: false, _hasMatch: false };

  // Tier 1: @everyone (role_id null AND username null)
  rows.filter(r => !r.role_id && !r.username).forEach(r => {
    applyOverride(result, r);
    result._hasMatch = true;
  });

  // Tier 2: role-based (any of the user's roles) — DENY wins over ALLOW within same key
  const myRoleRows = rows.filter(r => r.role_id && currentUserRoleIds.has(r.role_id));
  ["can_view", "can_send", "can_manage"].forEach(key => {
    let allow = null;
    myRoleRows.forEach(r => {
      if (r[key] === false) allow = false;
      else if (r[key] === true && allow !== false) allow = true;
    });
    if (allow !== null) { result[key] = allow; result._hasMatch = true; }
  });

  // Tier 3: user override (highest priority)
  const userRow = rows.find(r => !r.role_id && r.username && r.username === username);
  if (userRow) {
    applyOverride(result, userRow);
    result._hasMatch = true;
  }

  return result._hasMatch ? result : null;
}

function applyOverride(target, row) {
  if (row.can_view !== null && row.can_view !== undefined) target.can_view = !!row.can_view;
  if (row.can_send !== null && row.can_send !== undefined) target.can_send = !!row.can_send;
  if (row.can_manage !== null && row.can_manage !== undefined) target.can_manage = !!row.can_manage;
}

// Hook channel filtering into the existing renderChannelList by hiding/dimming after render.
// We do it as a post-pass so we don't have to rewrite the existing function.
(function installChannelVisibilityFilter() {
  const original = (typeof renderChannelList === "function") ? renderChannelList : null;
  if (!original) return;
  window.renderChannelList = function patchedRenderChannelList(...args) {
    const r = original.apply(this, args);
    try { applyChannelVisibilityFilter(); } catch (e) { console.warn(e); }
    return r;
  };
})();

function applyChannelVisibilityFilter() {
  const isAdmin = !!(userPermissions && userPermissions.manage_roles);
  document.querySelectorAll("#channelList .channel").forEach(el => {
    const chId = parseInt(el.dataset.id, 10);
    if (!chId) return;
    const eff = getEffectiveChannelPermission(chId);
    el.classList.remove("cp-hidden-but-admin");
    if (eff && eff.can_view === false) {
      if (isAdmin) {
        el.style.display = "";
        el.classList.add("cp-hidden-but-admin");
        el.title = "Hidden from non-admins by channel permissions";
      } else {
        el.style.display = "none";
      }
    } else {
      el.style.display = "";
      el.title = "";
    }
  });
}

/* ============================================================
 *  CHANNEL PERMISSIONS MODAL
 * ============================================================ */
let _cpModalState = {
  channelId: null,
  // Map "role:<id>" or "user:<username>" -> { can_view, can_send, can_manage, _isNew, _toDelete, _id }
  rows: new Map(),
  initialSnapshot: ""
};

function openChannelPermsModal(channelId) {
  if (!channelId) return;
  if (!userPermissions || !userPermissions.manage_roles) {
    alert("❌ You don't have permission to edit channel permissions.");
    return;
  }
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return;

  _cpModalState = { channelId, rows: new Map(), initialSnapshot: "" };

  document.getElementById("channelPermsTitle").textContent = "# " + ch.name;

  // Seed rows from cache
  const rows = channelPermissionsCache.get(channelId) || [];
  rows.forEach(r => {
    const key = r.role_id ? "role:" + r.role_id : (r.username ? "user:" + r.username : "everyone");
    _cpModalState.rows.set(key, {
      _id: r.id,
      role_id: r.role_id || null,
      username: r.username || null,
      can_view: (r.can_view === null || r.can_view === undefined) ? null : !!r.can_view,
      can_send: (r.can_send === null || r.can_send === undefined) ? null : !!r.can_send,
      can_manage: (r.can_manage === null || r.can_manage === undefined) ? null : !!r.can_manage,
      _isNew: false,
      _toDelete: false
    });
  });
  _cpModalState.initialSnapshot = JSON.stringify([..._cpModalState.rows.entries()]);

  // Populate the role / member add-selects
  populateCpAddSelects();

  // Switch to Roles tab
  cpSwitchTab("roles");

  renderCpRows();

  document.getElementById("channelPermsModal").style.display = "flex";
}

function closeChannelPermsModal() {
  document.getElementById("channelPermsModal").style.display = "none";
  _cpModalState = { channelId: null, rows: new Map(), initialSnapshot: "" };
}

function populateCpAddSelects() {
  const roleSel = document.getElementById("cpAddRoleSelect");
  const memSel = document.getElementById("cpAddMemberSelect");
  if (!roleSel || !memSel) return;

  // Roles already overridden
  const usedRoleIds = new Set();
  const usedUsernames = new Set();
  _cpModalState.rows.forEach(v => {
    if (v.role_id) usedRoleIds.add(v.role_id);
    if (v.username) usedUsernames.add(v.username);
  });

  roleSel.innerHTML = '<option value="">+ Add role override…</option>';
  // Always allow @everyone as a synthetic role
  if (!_cpModalState.rows.has("everyone")) {
    const opt = document.createElement("option");
    opt.value = "__everyone__";
    opt.textContent = "@everyone";
    roleSel.appendChild(opt);
  }
  (allServerRolesCache || []).forEach(r => {
    if (usedRoleIds.has(r.id)) return;
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = "@" + (r.name || r.role || "Role");
    opt.dataset.color = r.color || "";
    roleSel.appendChild(opt);
  });

  memSel.innerHTML = '<option value="">+ Add member override…</option>';
  (serverMembers || [])
    .slice()
    .sort((a, b) => String(a.username || "").localeCompare(String(b.username || "")))
    .forEach(m => {
      if (!m.username || usedUsernames.has(m.username)) return;
      const opt = document.createElement("option");
      opt.value = m.username;
      const display = m.profile_display_name || m.username;
      opt.textContent = display + (display !== m.username ? " (" + m.username + ")" : "");
      memSel.appendChild(opt);
    });
}

function cpSwitchTab(name) {
  document.querySelectorAll(".cp-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.cpTab === name);
  });
  document.querySelectorAll(".channel-perms-pane").forEach(p => {
    p.style.display = (p.dataset.cpPane === name) ? "" : "none";
  });
}

function renderCpRows() {
  const rolesContainer = document.getElementById("cpRolesList");
  const membersContainer = document.getElementById("cpMembersList");
  if (!rolesContainer || !membersContainer) return;
  rolesContainer.innerHTML = "";
  membersContainer.innerHTML = "";

  const roleEntries = [];
  const memberEntries = [];

  _cpModalState.rows.forEach((row, key) => {
    if (row._toDelete) return;
    if (key.startsWith("role:") || key === "everyone") roleEntries.push([key, row]);
    else memberEntries.push([key, row]);
  });

  if (!roleEntries.length) {
    rolesContainer.innerHTML = '<div class="cp-empty">No role overrides yet. Use the dropdown above to add one.</div>';
  } else {
    roleEntries.forEach(([key, row]) => rolesContainer.appendChild(buildCpRowEl(key, row, "role")));
  }
  if (!memberEntries.length) {
    membersContainer.innerHTML = '<div class="cp-empty">No member overrides yet. Use the dropdown above to add one.</div>';
  } else {
    memberEntries.forEach(([key, row]) => membersContainer.appendChild(buildCpRowEl(key, row, "member")));
  }
}

function buildCpRowEl(key, row, kind) {
  const el = document.createElement("div");
  el.className = "cp-row";
  el.dataset.cpKey = key;

  let label = "";
  let dotColor = "#99aab5";
  if (key === "everyone") {
    label = "@everyone";
  } else if (kind === "role") {
    const r = (allServerRolesCache || []).find(x => x.id === row.role_id);
    label = "@" + (r?.name || r?.role || "Unknown role");
    dotColor = r?.color || "#99aab5";
  } else {
    const m = (serverMembers || []).find(x => x.username === row.username);
    const display = m?.profile_display_name || row.username;
    label = display + (display !== row.username ? " (" + row.username + ")" : "");
  }

  el.innerHTML = `
    <div class="cp-row-label">
      <span class="cp-role-dot" style="background:${escapeHTML(dotColor)};"></span>
      <span class="cp-name">${escapeHTML(label)}</span>
    </div>
    ${triStateHTML("View", "can_view", row.can_view)}
    ${triStateHTML("Send", "can_send", row.can_send)}
    ${triStateHTML("Manage", "can_manage", row.can_manage)}
    <button class="cp-row-remove" type="button" title="Remove override">×</button>
  `;

  // Wire tri-state buttons
  el.querySelectorAll(".cp-tri-state").forEach(group => {
    const field = group.dataset.field;
    group.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.value;
        const cur = _cpModalState.rows.get(key);
        if (!cur) return;
        cur[field] = (v === "allow") ? true : (v === "deny") ? false : null;
        group.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });

  el.querySelector(".cp-row-remove").addEventListener("click", () => {
    const cur = _cpModalState.rows.get(key);
    if (!cur) return;
    if (cur._isNew) _cpModalState.rows.delete(key);
    else cur._toDelete = true;
    renderCpRows();
    populateCpAddSelects();
  });

  return el;
}

function triStateHTML(label, field, value) {
  const allowActive = value === true ? "active" : "";
  const denyActive = value === false ? "active" : "";
  const defActive = (value === null || value === undefined) ? "active" : "";
  return `
    <div class="cp-perm-control">
      <label>${label}</label>
      <div class="cp-tri-state" data-field="${field}">
        <button type="button" class="cp-deny ${denyActive}" data-value="deny" title="Deny">✕</button>
        <button type="button" class="cp-default ${defActive}" data-value="default" title="Default">/</button>
        <button type="button" class="cp-allow ${allowActive}" data-value="allow" title="Allow">✓</button>
      </div>
    </div>
  `;
}

async function saveChannelPermsModal() {
  const channelId = _cpModalState.channelId;
  if (!channelId) return;
  const saveBtn = document.getElementById("channelPermsSave");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

  try {
    const inserts = [];
    const updates = [];
    const deleteIds = [];

    _cpModalState.rows.forEach(row => {
      if (row._toDelete) {
        if (row._id) deleteIds.push(row._id);
        return;
      }
      const payload = {
        channel_id: channelId,
        role_id: row.role_id || null,
        username: row.username || null,
        can_view: row.can_view,
        can_send: row.can_send,
        can_manage: row.can_manage
      };
      if (row._id) updates.push({ id: row._id, ...payload });
      else inserts.push(payload);
    });

    const ops = [];
    if (deleteIds.length) ops.push(supabaseClient.from("channel_permissions").delete().in("id", deleteIds));
    updates.forEach(u => {
      const { id, ...rest } = u;
      ops.push(supabaseClient.from("channel_permissions").update(rest).eq("id", id));
    });
    if (inserts.length) ops.push(supabaseClient.from("channel_permissions").insert(inserts));

    const results = await Promise.all(ops);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;

    await loadChannelPermissionsForServer();
    renderChannelList();
    closeChannelPermsModal();
    if (typeof showToast === "function") showToast("✅ Channel permissions saved.");
  } catch (err) {
    console.error("❌ saveChannelPermsModal:", err);
    alert("❌ Failed to save: " + (err.message || err));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Changes"; }
  }
}

// Wire UI once on load
(function wireChannelPermsModal() {
  function init() {
    const closeBtn = document.getElementById("channelPermsClose");
    const cancelBtn = document.getElementById("channelPermsCancel");
    const saveBtn = document.getElementById("channelPermsSave");
    const overlay = document.getElementById("channelPermsModal");
    const addRoleBtn = document.getElementById("cpAddRoleBtn");
    const addMemBtn = document.getElementById("cpAddMemberBtn");

    if (!overlay) return;

    if (closeBtn) closeBtn.addEventListener("click", closeChannelPermsModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeChannelPermsModal);
    if (saveBtn) saveBtn.addEventListener("click", saveChannelPermsModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeChannelPermsModal(); });

    document.querySelectorAll(".cp-tab").forEach(t => {
      t.addEventListener("click", () => cpSwitchTab(t.dataset.cpTab));
    });

    if (addRoleBtn) addRoleBtn.addEventListener("click", () => {
      const sel = document.getElementById("cpAddRoleSelect");
      const v = sel.value;
      if (!v) return;
      const key = v === "__everyone__" ? "everyone" : "role:" + v;
      if (_cpModalState.rows.has(key)) {
        const existing = _cpModalState.rows.get(key);
        if (existing._toDelete) existing._toDelete = false;
      } else {
        _cpModalState.rows.set(key, {
          _id: null,
          role_id: v === "__everyone__" ? null : v,
          username: null,
          can_view: null, can_send: null, can_manage: null,
          _isNew: true, _toDelete: false
        });
      }
      sel.value = "";
      populateCpAddSelects();
      renderCpRows();
    });

    if (addMemBtn) addMemBtn.addEventListener("click", () => {
      const sel = document.getElementById("cpAddMemberSelect");
      const v = sel.value;
      if (!v) return;
      const key = "user:" + v;
      if (_cpModalState.rows.has(key)) {
        const existing = _cpModalState.rows.get(key);
        if (existing._toDelete) existing._toDelete = false;
      } else {
        _cpModalState.rows.set(key, {
          _id: null,
          role_id: null,
          username: v,
          can_view: null, can_send: null, can_manage: null,
          _isNew: true, _toDelete: false
        });
      }
      sel.value = "";
      populateCpAddSelects();
      renderCpRows();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

async function getMemberPermissions(serverId, memberId) {
  const { data: roleLinks, error } = await supabase
    .from("server_member_roles")
    .select(`
      role_id,
      server_roles (
        permissions
      )
    `)
    .eq("server_id", serverId)
    .eq("member_id", memberId);

  if (error) {
    console.error(error);
    return {};
  }

  const finalPerms = {};

  for (const link of roleLinks || []) {
    const perms = link.server_roles?.permissions || {};

    for (const key in perms) {
      if (perms[key] === true) {
        finalPerms[key] = true;
      }
    }
  }

  return finalPerms;
}

// ================= VOICE CHAT TEST FUNCTION =================
// Comprehensive voice chat diagnostic tool
window.testVoiceChat = async function() {
  console.log('🔬 Starting Voice Chat Diagnostic Test...');
  
  const results = {
    browserSupport: {},
    permissions: {},
    devices: {},
    webrtc: {},
    audio: {},
    database: {},
    voiceState: {},
    summary: []
  };

  try {
    // 1. Browser Support Tests
    console.log('🌐 Testing browser support...');
    results.browserSupport.getUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    results.browserSupport.RTCPeerConnection = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection);
    results.browserSupport.AudioContext = !!(window.AudioContext || window.webkitAudioContext);
    
    if (!results.browserSupport.getUserMedia) {
      results.summary.push('❌ getUserMedia not supported - voice chat impossible');
    }
    if (!results.browserSupport.RTCPeerConnection) {
      results.summary.push('❌ RTCPeerConnection not supported - WebRTC impossible');
    }
    if (!results.browserSupport.AudioContext) {
      results.summary.push('⚠️ AudioContext not supported - limited audio features');
    }

    // 2. Permission Tests
    console.log('🔐 Testing microphone permissions...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      results.permissions.microphone = 'granted';
      stream.getTracks().forEach(track => track.stop());
      results.summary.push('✅ Microphone access granted');
    } catch (permErr) {
      results.permissions.microphone = 'denied';
      results.permissions.error = permErr.name;
      results.summary.push(`❌ Microphone access denied: ${permErr.name} - ${permErr.message}`);
    }

    // 3. Audio Device Enumeration
    console.log('🎤 Checking audio devices...');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      results.devices.audioInputs = devices.filter(d => d.kind === 'audioinput').length;
      results.devices.audioOutputs = devices.filter(d => d.kind === 'audiooutput').length;
      results.devices.details = devices.filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput');
      
      if (results.devices.audioInputs === 0) {
        results.summary.push('❌ No audio input devices found');
      } else {
        results.summary.push(`✅ Found ${results.devices.audioInputs} audio input devices`);
      }
      
      if (results.devices.audioOutputs === 0) {
        results.summary.push('❌ No audio output devices found');
      } else {
        results.summary.push(`✅ Found ${results.devices.audioOutputs} audio output devices`);
      }
    } catch (devErr) {
      results.devices.error = devErr.message;
      results.summary.push(`❌ Device enumeration failed: ${devErr.message}`);
    }

    // 4. WebRTC Connection Test
    console.log('🔗 Testing WebRTC connectivity...');
    try {
      const testConn = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" }
        ]
      });
      
      results.webrtc.connectionCreated = true;
      
      // Test ICE candidate generation
      testConn.onicecandidate = (event) => {
        if (event.candidate) {
          results.webrtc.iceCandidates = true;
          console.log('🧊 ICE candidate generated successfully');
        }
      };
      
      // Create a test offer to verify SDP generation
      const offer = await testConn.createOffer();
      results.webrtc.offerCreated = true;
      results.webrtc.sdpValid = !!offer.sdp;
      
      testConn.close();
      results.summary.push('✅ WebRTC connection test passed');
    } catch (webrtcErr) {
      results.webrtc.error = webrtcErr.message;
      results.summary.push(`❌ WebRTC test failed: ${webrtcErr.message}`);
    }

    // 5. Audio Element Test
    console.log('🔊 Testing audio element creation...');
    try {
      const testAudio = new Audio();
      results.audio.elementCreated = true;
      results.audio.canPlay = typeof testAudio.play === 'function';
      
      // Test volume control
      testAudio.volume = 0.5;
      results.audio.volumeControl = testAudio.volume === 0.5;
      
      results.summary.push('✅ Audio element test passed');
    } catch (audioErr) {
      results.audio.error = audioErr.message;
      results.summary.push(`❌ Audio element test failed: ${audioErr.message}`);
    }

    // 6. Database Connection Test (if available)
    console.log('🗄️ Testing database connection...');
    if (typeof supabaseClient !== 'undefined') {
      try {
        const { data, error } = await supabaseClient
          .from('voice_room_participants')
          .select('count');
        
        if (error) {
          results.database.error = error.message;
          results.summary.push(`⚠️ Database test failed: ${error.message}`);
        } else {
          results.database.connected = true;
          results.summary.push('✅ Database connection successful');
        }
      } catch (dbErr) {
        results.database.error = dbErr.message;
        results.summary.push(`❌ Database test failed: ${dbErr.message}`);
      }
    } else {
      results.database.available = false;
      results.summary.push('⚠️ Supabase client not available');
    }

    // 7. Current Voice State Check
    console.log('🎯 Checking current voice state...');
    if (typeof currentVoiceChannelId !== 'undefined') {
      results.voiceState.currentChannelId = currentVoiceChannelId;
      results.voiceState.inVoiceChannel = !!currentVoiceChannelId;
      results.voiceState.localStream = !!localStream;
      results.voiceState.peerConnections = currentPeerConnections ? currentPeerConnections.size : 0;
      results.voiceState.participantState = voiceParticipantState ? voiceParticipantState.size : 0;
      
      if (currentVoiceChannelId) {
        results.summary.push(`ℹ️ Currently in voice channel: ${currentVoiceChannelId}`);
      }
    }

    // 8. Audio Context Test
    console.log('🎵 Testing audio context...');
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      results.audio.contextCreated = true;
      results.audio.sampleRate = audioCtx.sampleRate;
      results.audio.state = audioCtx.state;
      
      // Test analyser node creation
      const analyser = audioCtx.createAnalyser();
      results.audio.analyserCreated = true;
      
      audioCtx.close();
      results.summary.push('✅ Audio context test passed');
    } catch (audioCtxErr) {
      results.audio.contextError = audioCtxErr.message;
      results.summary.push(`❌ Audio context test failed: ${audioCtxErr.message}`);
    }

  } catch (testErr) {
    results.summary.push(`❌ Test suite error: ${testErr.message}`);
  }

  // Output results
  console.group('🔬 Voice Chat Diagnostic Results');
  console.log('Browser Support:', results.browserSupport);
  console.log('Permissions:', results.permissions);
  console.log('Devices:', results.devices);
  console.log('WebRTC:', results.webrtc);
  console.log('Audio:', results.audio);
  console.log('Database:', results.database);
  if (results.voiceState) {
    console.log('Voice State:', results.voiceState);
  }
  console.log('Summary:', results.summary);
  console.groupEnd();

  // Return results for programmatic use
  return results;
};

// Quick voice chat check function
window.quickVoiceCheck = function() {
  const issues = [];
  
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    issues.push('Browser does not support getUserMedia');
  }
  
  if (!window.RTCPeerConnection && !window.webkitRTCPeerConnection) {
    issues.push('Browser does not support WebRTC');
  }
  
  if (typeof currentVoiceChannelId === 'undefined' || !currentVoiceChannelId) {
    issues.push('Not currently in a voice channel');
  }
  
  if (!localStream) {
    issues.push('No local audio stream');
  }
  
  if (issues.length === 0) {
    console.log('✅ Quick voice check: No issues detected');
  } else {
    console.warn('⚠️ Quick voice check issues:', issues);
  }
  
  return issues;
};

// Test audio playback function
window.testAudioPlayback = async function() {
  console.log('🔊 Testing audio playback...');
  
  try {
    // Create a simple test tone
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 440; // A4 note
    gainNode.gain.value = 0.1; // Low volume
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 1); // Play for 1 second
    
    console.log('✅ Audio playback test initiated (should hear a 1-second tone)');
    return true;
  } catch (err) {
    console.error('❌ Audio playback test failed:', err);
    return false;
  }
};

// Audio routing and loopback tests
window.testAudioRouting = async function() {
  console.log('🔊 Testing audio routing (microphone to speakers)...');
  
  try {
    // Get microphone access
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      },
      video: false
    });
    console.log('✅ Microphone access granted for routing test');
    
    // Create audio context for processing
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const gainNode = audioContext.createGain();
    
    // Set up audio processing chain
    source.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Set low volume to avoid feedback
    gainNode.gain.value = 0.1;
    
    // 🔥 CRITICAL: Unmute all voice audio elements so we can hear them
    document.querySelectorAll('audio[id^="audio-"]').forEach(el => {
      el.muted = false;
      el.volume = 0.1; // Keep volume low to prevent feedback
    });
    
    // Set up analyser for level monitoring
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    console.log('🎤 Audio routing active - speak into microphone to test');
    console.log('⚠️  Low volume set to prevent feedback');
    
    // Monitor audio levels
    let monitoring = true;
    const checkLevels = () => {
      if (!monitoring) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
      if (average > 10) {
        console.log(`🔊 Audio level detected: ${Math.round(average)}`);
      }
      
      requestAnimationFrame(checkLevels);
    };
    
    checkLevels();
    
    // Auto-stop after 10 seconds
    setTimeout(() => {
      monitoring = false;
      gainNode.disconnect();
      source.disconnect();
      audioContext.close();
      stream.getTracks().forEach(track => track.stop());
      console.log('✅ Audio routing test completed');
    }, 10000);
    
    return { success: true, message: 'Audio routing test active for 10 seconds' };
    
  } catch (err) {
    console.error('❌ Audio routing test failed:', err);
    return { success: false, error: err.message };
  }
};

// Test simulated peer connection audio flow
window.testPeerAudioFlow = async function() {
  console.log('🔗 Testing peer connection audio flow simulation...');
  
  try {
    // Create two peer connections to simulate audio flow
    const peer1 = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const peer2 = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    
    // Get microphone stream
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    
    // Add stream to peer1
    stream.getTracks().forEach(track => peer1.addTrack(track, stream));
    
    // Handle incoming tracks on peer2
    peer2.ontrack = (event) => {
      console.log('🎵 Received audio track in simulation');
      
      // Create audio element to play received audio
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      audio.volume = 0.3; // Low volume to prevent feedback
      
      document.body.appendChild(audio);
      
      console.log('🔊 Playing received audio in simulation');
      
      // Remove after 5 seconds
      setTimeout(() => {
        audio.remove();
        console.log('✅ Peer audio flow simulation completed');
      }, 5000);
    };
    
    // Create offer-answer exchange
    const offer = await peer1.createOffer();
    await peer1.setLocalDescription(offer);
    await peer2.setRemoteDescription(offer);
    
    const answer = await peer2.createAnswer();
    await peer2.setLocalDescription(answer);
    await peer1.setRemoteDescription(answer);
    
    console.log('✅ Peer connection simulation established');
    
    // Clean up after 10 seconds
    setTimeout(() => {
      peer1.close();
      peer2.close();
      stream.getTracks().forEach(track => track.stop());
    }, 10000);
    
    return { success: true, message: 'Peer audio flow simulation active' };
    
  } catch (err) {
    console.error('❌ Peer audio flow test failed:', err);
    return { success: false, error: err.message };
  }
};

// Real-time audio level monitoring for voice calls
window.startAudioLevelMonitoring = function() {
  console.log('📊 Starting real-time audio level monitoring...');
  
  if (!localStream) {
    console.warn('⚠️ No local audio stream - join voice channel first');
    return;
  }
  
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(localStream);
    const analyser = audioContext.createAnalyser();
    
    source.connect(analyser);
    analyser.fftSize = 256;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const monitorLevels = () => {
      if (!localStream) {
        console.log('📊 Audio level monitoring stopped');
        return;
      }
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
      // Update UI with audio level
      const level = Math.min(100, Math.round(average * 2));
      
      // Check if speaking
      const isSpeaking = level > 15;
      
      // Update speaking indicator
      const selfParticipant = document.querySelector('.voice-participant.is-self');
      if (selfParticipant) {
        const avatar = selfParticipant.querySelector('.voice-participant-avatar');
        if (isSpeaking) {
          avatar.classList.add('speaking');
        } else {
          avatar.classList.remove('speaking');
        }
      }
      
      // Log levels periodically
      if (isSpeaking) {
        console.log(`🎤 Speaking level: ${level}%`);
      }
      
      requestAnimationFrame(monitorLevels);
    };
    
    monitorLevels();
    console.log('✅ Audio level monitoring started');
    
    return { success: true, message: 'Audio monitoring active' };
    
  } catch (err) {
    console.error('❌ Audio level monitoring failed:', err);
    return { success: false, error: err.message };
  }
};

// Test audio device switching
window.testAudioDeviceSwitching = async function() {
  console.log('🔄 Testing audio device switching...');
  
  try {
    // Get all audio devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    
    console.log(`🎤 Found ${audioInputs.length} input devices:`);
    audioInputs.forEach((device, index) => {
      console.log(`  ${index}: ${device.label || 'Unknown'}`);
    });
    
    console.log(`🔊 Found ${audioOutputs.length} output devices:`);
    audioOutputs.forEach((device, index) => {
      console.log(`  ${index}: ${device.label || 'Unknown'}`);
    });
    
    // Test switching between input devices
    if (audioInputs.length > 1) {
      console.log('🔄 Testing input device switching...');
      
      for (let i = 0; i < Math.min(3, audioInputs.length); i++) {
        try {
          const constraints = {
            audio: {
              deviceId: audioInputs[i].deviceId
            }
          };
          
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log(`✅ Successfully switched to input device ${i}: ${audioInputs[i].label || 'Unknown'}`);
          
          stream.getTracks().forEach(track => track.stop());
          
          // Small delay between switches
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (err) {
          console.warn(`⚠️ Failed to switch to input device ${i}:`, err.message);
        }
      }
    } else {
      console.log('ℹ️ Only one input device available, skipping switch test');
    }
    
    return { 
      success: true, 
      inputDevices: audioInputs.length,
      outputDevices: audioOutputs.length 
    };
    
  } catch (err) {
    console.error('❌ Audio device switching test failed:', err);
    return { success: false, error: err.message };
  }
};

// Comprehensive voice chat audio test suite
window.runVoiceAudioTests = async function() {
  console.log('🧪 Running comprehensive voice audio tests...');
  
  const results = {
    routing: null,
    peerFlow: null,
    deviceSwitching: null,
    monitoring: null
  };
  
  // Test 1: Audio routing
  console.log('\n📊 Test 1: Audio Routing');
  results.routing = await testAudioRouting();
  
  // Wait a bit between tests
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 2: Peer audio flow
  console.log('\n📊 Test 2: Peer Audio Flow');
  results.peerFlow = await testPeerAudioFlow();
  
  // Wait a bit between tests
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 3: Device switching
  console.log('\n📊 Test 3: Device Switching');
  results.deviceSwitching = await testAudioDeviceSwitching();
  
  // Test 4: Start monitoring (if in voice channel)
  console.log('\n📊 Test 4: Audio Level Monitoring');
  results.monitoring = startAudioLevelMonitoring();
  
  console.log('\n✅ Voice audio test suite completed!');
  console.log('Results:', results);
  
  return results;
};

console.log('🔬 Voice chat test functions loaded. Use testVoiceChat(), quickVoiceCheck(), testAudioPlayback(), testAudioRouting(), testPeerAudioFlow(), startAudioLevelMonitoring(), testAudioDeviceSwitching(), or runVoiceAudioTests() in console.');

/**
 * Admin Debug Panel Implementation
 * 
 * SECURITY NOTE: This panel is only visible to users with currentSystemRole === "SysAdmin".
 * It does not bypass browser security or school restrictions. It runs within the 
 * standard application context.
 */

