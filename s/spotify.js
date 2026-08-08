// spotify.js

// Placeholder: Put your Spotify Client ID here (or set via environment/config).
// For a production setup, use a server-side exchange (PKCE or your backend) to securely obtain refresh tokens.
const SPOTIFY_CLIENT_ID = '32ddb467fffb4e0f9e8bb4d814797d4a'; // <-- REPLACE ME
const SPOTIFY_SCOPES = ['user-read-private','user-read-currently-playing','user-read-playback-state'];

// PKCE helpers
function base64UrlEncode(arrayBuffer) {
    // base64url encode
    const bytes = new Uint8Array(arrayBuffer);
    let str = '';
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return hash;
}

function generateCodeVerifier(length = 128) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    // convert to URL-safe base64
    let str = '';
    for (let i = 0; i < array.length; i++) str += String.fromCharCode(array[i] % 256);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
    const hashed = await sha256(verifier);
    return base64UrlEncode(hashed);
}


let spotifyChannel = null;
let spotifyAccessToken = null;
let spotifyPollingInterval = null;

async function ensureSpotifyClient(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (typeof supabaseClient !== 'undefined' && supabaseClient && typeof supabaseClient.from === 'function') {
            try { window.supabaseClient = supabaseClient; } catch (e) {}
            return supabaseClient;
        }
        if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
            return window.supabaseClient;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

function scheduleUpdateAccountLinkButtons(attempts = 0) {
    if (typeof updateAccountLinkButtons === 'function') {
        try { updateAccountLinkButtons(); } catch (err) { console.warn('[spotify] updateAccountLinkButtons error:', err); }
        return;
    }
    if (attempts >= 6) return;
    setTimeout(() => scheduleUpdateAccountLinkButtons(attempts + 1), 500);
}

function markSpotifyAsLinked() {
    toggleSpotifyButtons(true);
    const linkBtn = document.getElementById('linkSpotifyBtn');
    if (linkBtn) {
        linkBtn.disabled = false;
        linkBtn.textContent = 'Linked';
    }
    if (typeof refreshSettingsConnections === 'function') {
        refreshSettingsConnections();
    }
    scheduleUpdateAccountLinkButtons();
}

async function handleSpotifyCallbackMessage(ev) {
    try {
        if (ev.origin !== window.location.origin) return;
        const data = ev.data || {};
        if (!data || (!data.type && !data.access_token && !data.code)) return;

        const client = await ensureSpotifyClient();
        if (!client) {
            console.warn('[spotify] Supabase client not ready for callback message');
        }

        if (data.type === 'spotify_auth' && data.access_token) {
            console.debug('[spotify] Received auth message from popup');
            spotifyAccessToken = data.access_token;
            const expiresIn = Number(data.expires_in) || 3600;
            const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
            try {
                const authUser = client ? await client.auth.getUser() : null;
                const authId = authUser?.data?.user?.id;
                let updateQuery = client.from('users').update({
                    spotify_access_token: spotifyAccessToken,
                    spotify_token_expires: expiresAt,
                    spotify_refresh_token: data.refresh_token || null
                });
                if (authId) {
                    updateQuery = updateQuery.eq('auth_id', authId);
                } else if (typeof username === 'string' && username) {
                    updateQuery = updateQuery.eq('username', username);
                }
                const { error: saveError } = await updateQuery;
                if (saveError) throw saveError;
                console.debug('[spotify] Saved spotify_access_token to users row for', authId || username);
            } catch (err) {
                console.error('[spotify] Failed to save spotify token:', err);
            }
            markSpotifyAsLinked();
            return;
        }

        if (data.type === 'spotify_auth_code' && data.code) {
            console.warn('[spotify] Received authorization code from popup (no client-side exchange performed):', data);
            try {
                const verifier = localStorage.getItem('spotify_pkce_verifier');
                const clientId = localStorage.getItem('spotify_client_id') || SPOTIFY_CLIENT_ID;
                const exchangeUrl = (client && client.supabaseUrl) ? `${client.supabaseUrl}/functions/v1/spotify-exchange` : null;
                console.debug('[spotify] attempting server-side exchange at', exchangeUrl);
                if (!exchangeUrl) {
                    alert('No server exchange endpoint available. Deploy a Supabase Edge Function named spotify-exchange and try again.');
                    return;
                }

                const resp = await fetch(exchangeUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: data.code,
                        redirect_uri: localStorage.getItem('spotify_redirect_uri') || (window.location.origin + window.location.pathname),
                        code_verifier: verifier,
                        client_id: clientId
                    })
                });
                const respText = await resp.text();
                let json = null;
                try { json = respText ? JSON.parse(respText) : null; } catch (parseErr) { console.debug('[spotify] server exchange parse error', parseErr, 'body:', respText); }
                console.debug('[spotify] server exchange status:', resp.status, 'body:', json || respText);
                const tokenData = (json && (json.body || json)) || null;
                const accessToken = tokenData?.access_token || tokenData?.accessToken;
                if (!accessToken) {
                    console.error('[spotify] Server exchange failed or returned no access_token:', tokenData || json || respText);
                    alert('Spotify token exchange failed on server. Check console.');
                    return;
                }
                spotifyAccessToken = accessToken;
                const expiresIn = Number(tokenData?.expires_in || tokenData?.expiresIn) || 3600;
                const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
                try {
                    const authUser = client ? await client.auth.getUser() : null;
                    const authId = authUser?.data?.user?.id;
                    let updateQuery = client.from('users').update({
                        spotify_access_token: spotifyAccessToken,
                        spotify_refresh_token: tokenData.refresh_token || null,
                        spotify_token_expires: expiresAt
                    });
                    if (authId) {
                        updateQuery = updateQuery.eq('auth_id', authId);
                    } else if (typeof username === 'string' && username) {
                        updateQuery = updateQuery.eq('username', username);
                    }
                    const { error: saveError } = await updateQuery;
                    if (saveError) throw saveError;
                    console.debug('[spotify] Saved spotify tokens to users row for', authId || username);
                } catch (err) {
                    console.error('[spotify] Failed to save spotify tokens:', err);
                }
                markSpotifyAsLinked();
            } catch (err) {
                console.error('[spotify] Error performing server-side exchange:', err);
                alert('Server-side exchange failed. Check console for details.');
            }
        }
    } catch (err) {
        console.error('[spotify] Error handling message event:', err);
    }
}

window.addEventListener('message', handleSpotifyCallbackMessage);

async function initSpotifyPresence() {
    console.debug('[spotify] initSpotifyPresence called — checking for supabase client');

    const waitForClient = async (timeoutMs = 10000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (typeof supabaseClient !== 'undefined' && supabaseClient && typeof supabaseClient.from === 'function') {
                // Mirror to window for code that checks window.supabaseClient
                try { window.supabaseClient = supabaseClient; } catch (e) {}
                return supabaseClient;
            }
            if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
                return window.supabaseClient;
            }
            // If the supabase library is present but client not yet created, wait
            if (window.supabase && typeof window.supabase.createClient === 'function' && typeof window.supabaseClient === 'undefined') {
                console.debug('[spotify] supabase library present but client not yet created');
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return null;
    };

    const client = await waitForClient(10000);
    if (!client) {
        console.error('[spotify] Supabase client not ready after waiting — ensure auth.js creates supabaseClient and that scripts are loaded in correct order.');
        return;
    }

    console.debug('[spotify] supabase client available — subscribing to postgres changes');
    // Make sure window.supabaseClient exists for other checks in this file
    try { window.supabaseClient = client; } catch (e) {}

    // Avoid adding on(...) callbacks to an already-subscribed channel object
    // by choosing a unique channel name if one already exists.
    let spotifyChannelName = 'spotify-presence';
    try {
        if (typeof client.getChannels === 'function') {
            const existing = client.getChannels().find((c) => c?.topic?.includes('spotify-presence') || c?.topic === 'realtime:spotify-presence');
            if (existing) {
                spotifyChannelName = `spotify-presence-${Math.random().toString(36).slice(2)}`;
                console.debug('[spotify] existing spotify-presence channel detected; using', spotifyChannelName);
            }
        }
    } catch (e) {
        console.debug('[spotify] error checking existing channels:', e);
    }

    spotifyChannel = client
        .channel(spotifyChannelName)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
            try {
                if (!payload || !payload.new) {
                    console.debug('[spotify] postgres change payload missing .new:', payload);
                    return;
                }
                console.debug('[spotify] postgres change received for users:', payload.new?.username);
                updateSpotifyPresence(payload.new);
            } catch (err) {
                console.error('[spotify] error handling postgres change payload:', err, payload);
            }
        })
        .subscribe();

    try {
        await loadSpotifyUsers();
    } catch (e) {
        console.error('[spotify] loadSpotifyUsers failed:', e);
    }

    // Wire up UI buttons (if present) — do it immediately in case DOMContentLoaded already fired
    function wireUpButtons() {
        try {
            const linkBtn = document.getElementById('linkSpotifyBtn');
            const unlinkBtn = document.getElementById('unlinkSpotifyBtn');
            if (linkBtn) {
                linkBtn.removeEventListener('click', linkSpotify);
                linkBtn.addEventListener('click', linkSpotify);
                console.debug('[spotify] wired linkSpotify button');
            }
            if (unlinkBtn) {
                unlinkBtn.removeEventListener('click', unlinkSpotify);
                unlinkBtn.addEventListener('click', unlinkSpotify);
                console.debug('[spotify] wired unlinkSpotify button');
            }
        } catch (err) {
            console.warn('[spotify] wireUpButtons error:', err);
        }
    }

    wireUpButtons();
    document.addEventListener('DOMContentLoaded', wireUpButtons);
}

async function loadSpotifyUsers() {
    console.debug('[spotify] loadSpotifyUsers — querying users table for spotify fields');
    try {
        const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : window.supabaseClient;
        const { data, error } = await client
            .from('users')
            .select(`username, spotify_track, spotify_artist, spotify_album_art, spotify_is_playing`);

        if (error) {
            console.error('[spotify] loadSpotifyUsers error:', error);
            return;
        }

        console.debug('[spotify] loadSpotifyUsers returned rows:', Array.isArray(data) ? data.length : 0, data);
        (data || []).forEach(updateSpotifyPresence);
    } catch (err) {
        console.error('[spotify] loadSpotifyUsers unexpected error:', err);
    }
}

function updateSpotifyPresence(user) {
    if (!user) {
        console.warn('[spotify] updateSpotifyPresence called with undefined user');
        return;
    }

    // Normalize boolean
    const isPlaying = !!user.spotify_is_playing;

    const memberSelector = `[data-username="${user.username}"]`;
    const member = document.querySelector(memberSelector);

    if (!isPlaying) {
        if (member) {
            const memberRem = member.querySelector('.spotify-presence');
            if (memberRem) memberRem.remove();
        }
        return;
    }

    if (!member) {
        console.debug('[spotify] updateSpotifyPresence: member element not found for', user.username);
        return;
    }

    let spotifyDiv = member.querySelector('.spotify-presence');
    if (!spotifyDiv) {
        spotifyDiv = document.createElement('div');
        spotifyDiv.className = 'spotify-presence';
        spotifyDiv.style.marginTop = '6px';
        member.appendChild(spotifyDiv);
    }

    spotifyDiv.innerHTML = `
        <div style="font-size:12px;">🎵 ${escapeHtml(user.spotify_track || '')}</div>
        <div style="font-size:11px;opacity:.75;">${escapeHtml(user.spotify_artist || '')}</div>
    `;
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function openPopup(url, name = 'spotify', w = 480, h = 680) {
    const left = Math.floor((screen.width / 2) - (w / 2));
    const top = Math.floor((screen.height / 2) - (h / 2));
    return window.open(url, name, `width=${w},height=${h},left=${left},top=${top}`);
}

async function linkSpotify() {
    console.debug('[spotify] linkSpotify called (PKCE)');
    if (!SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID.includes('YOUR_SPOTIFY_CLIENT_ID') || SPOTIFY_CLIENT_ID.includes('REPLACE')) {
        alert('Spotify client ID is not configured in spotify.js. Place your client id in SPOTIFY_CLIENT_ID.');
        return;
    }

    const redirectUri = (function() {
        try {
            return new URL('spotify-callback.html', window.location.href).href;
        } catch (e) {
            return window.location.origin + '/s/spotify-callback.html';
        }
    })();
    console.debug('[spotify] using redirectUri:', redirectUri);

    // Generate PKCE code verifier/challenge
    const codeVerifier = generateCodeVerifier(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Persist verifier and client id so callback can exchange token
    try { localStorage.setItem('spotify_pkce_verifier', codeVerifier); } catch (e) { console.warn('[spotify] Failed to store pkce verifier in localStorage', e); }

    const state = Math.random().toString(36).slice(2);
    try { localStorage.setItem('spotify_pkce_state', state); } catch (e) {}

    try { localStorage.setItem('spotify_client_id', SPOTIFY_CLIENT_ID); } catch (e) { console.warn('[spotify] Failed to store client id in localStorage', e); }

    try { localStorage.setItem('spotify_redirect_uri', redirectUri); } catch (e) { console.warn('[spotify] Failed to store redirect uri in localStorage', e); }

    const authUrl = 'https://accounts.spotify.com/authorize' +
        `?response_type=code&client_id=${encodeURIComponent(SPOTIFY_CLIENT_ID)}` +
        `&scope=${encodeURIComponent(SPOTIFY_SCOPES.join(' '))}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code_challenge_method=S256&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&state=${encodeURIComponent(state)}` +
        `&show_dialog=true`;

    console.debug('[spotify] opening authUrl (first 300 chars):', authUrl.slice(0,300));
    const popup = openPopup(authUrl, 'spotify-auth');
    const linkBtn = document.getElementById('linkSpotifyBtn');
    try { if (linkBtn) { linkBtn.disabled = true; linkBtn.textContent = 'Opening…'; } } catch(e){}

    if (!popup) {
        alert('Popup blocked. Allow popups for this site and try again.');
        try { if (linkBtn) { linkBtn.disabled = false; linkBtn.textContent = '🎵 Link Spotify Account'; } } catch(e){}
        return;
    }

    // Poll popup to report close for debugging and restore UI if closed without auth
    const poll = setInterval(() => {
        try {
            if (popup.closed) {
                clearInterval(poll);
                console.debug('[spotify] auth popup closed by user');
                try { if (linkBtn) { linkBtn.disabled = false; linkBtn.textContent = '🎵 Link Spotify Account'; } } catch(e){}
            }
        } catch (e) {
            clearInterval(poll);
            console.debug('[spotify] popup polling error (likely cross-origin while open):', e && e.message);
        }
    }, 500);
}

async function startSpotifyPolling() {
    stopSpotifyPolling();
    await fetchNowPlaying();
    spotifyPollingInterval = setInterval(fetchNowPlaying, 15000);
}

function stopSpotifyPolling() {
    if (spotifyPollingInterval) {
        clearInterval(spotifyPollingInterval);
        spotifyPollingInterval = null;
    }
}

async function fetchNowPlaying() {
    console.debug('[spotify] fetchNowPlaying — token present?', !!spotifyAccessToken);

    if (!spotifyAccessToken) {
        // Try to read token from DB for this user (in case of page reload)
        try {
            if (typeof username === 'string' && username) {
                const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : window.supabaseClient;
                const { data, error } = await client.from('users').select('spotify_access_token').eq('username', username).maybeSingle();
                if (!error && data?.spotify_access_token) {
                    spotifyAccessToken = data.spotify_access_token;
                    console.debug('[spotify] Loaded spotifyAccessToken from DB for', username);
                } else {
                    console.debug('[spotify] No spotify token in DB for', username);
                }
            }
        } catch (err) {
            console.warn('[spotify] Error reading spotify token from DB:', err);
        }
    }

    if (!spotifyAccessToken) return;

    try {
        // Debug: inspect /me to log product (premium check) and scopes
        try {
            const meRes = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${spotifyAccessToken}` } });
            const meText = await meRes.text();
            let meJson = null;
            try { meJson = meText ? JSON.parse(meText) : null; } catch (e) { /* ignore parse */ }
            console.debug('[spotify] /me status:', meRes.status, 'body:', meJson || meText);
        } catch (e) { console.debug('[spotify] /me fetch failed:', e); }

        const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });

        console.debug('[spotify] spotify api status', res.status);

        if (res.status === 204) {
            // Not playing
            const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : window.supabaseClient;
            await client.from('users').update({
                spotify_is_playing: false,
                spotify_track: null,
                spotify_artist: null,
                spotify_album_art: null,
                spotify_updated_at: new Date().toISOString()
            }).eq('username', username || '');
            toggleSpotifyButtons(false);
            return;
        }

        if (!res.ok) {
            console.warn('[spotify] Spotify API returned', res.status);
            // Token might have expired; clear token locally and in DB
            if (res.status === 401) {
                try {
                    const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : window.supabaseClient;
                    await client.from('users').update({ spotify_access_token: null, spotify_is_playing: false }).eq('username', username || '');
                } catch (e){}
                spotifyAccessToken = null;
                stopSpotifyPolling();
                toggleSpotifyButtons(false);
            }
            return;
        }

        const data = await res.json();
        const item = data?.item || null;
        const isPlaying = !!data?.is_playing && !!item;
        if (!item) {
            const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : window.supabaseClient;
            await client.from('users').update({ spotify_is_playing: false, spotify_track: null, spotify_artist: null, spotify_album_art: null, spotify_updated_at: new Date().toISOString() }).eq('username', username || '');
            toggleSpotifyButtons(false);
            return;
        }

        const trackName = item.name;
        const artistName = (item.artists || []).map(a => a.name).join(', ');
        const albumArt = (item.album && item.album.images && item.album.images[0] && item.album.images[0].url) || null;

        const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : window.supabaseClient;
        await client.from('users').update({
            spotify_is_playing: isPlaying,
            spotify_track: trackName,
            spotify_artist: artistName,
            spotify_album_art: albumArt,
            spotify_updated_at: new Date().toISOString()
        }).eq('username', username || '');

        toggleSpotifyButtons(true);
    } catch (err) {
        console.error('[spotify] Spotify fetch error:', err);
    }
}

async function unlinkSpotify() {
    stopSpotifyPolling();
    spotifyAccessToken = null;
    if (typeof username === 'string' && username) {
        await supabaseClient.from('users').update({
            spotify_access_token: null,
            spotify_is_playing: false,
            spotify_track: null,
            spotify_artist: null,
            spotify_album_art: null,
            spotify_token_expires: null,
            spotify_updated_at: new Date().toISOString()
        }).eq('username', username);
    }
    toggleSpotifyButtons(false);
    if (typeof refreshSettingsConnections === 'function') {
      refreshSettingsConnections();
    }
}

function toggleSpotifyButtons(linked) {
    const linkBtn = document.getElementById('linkSpotifyBtn');
    const unlinkBtn = document.getElementById('unlinkSpotifyBtn');
    if (linkBtn) linkBtn.style.display = linked ? 'none' : 'inline-block';
    if (unlinkBtn) unlinkBtn.style.display = linked ? 'inline-block' : 'none';
}

// Expose functions for UI
window.initSpotifyPresence = initSpotifyPresence;
window.linkSpotify = linkSpotify;
window.unlinkSpotify = unlinkSpotify;

// Attempt auto-init once supabase client becomes available.
(function tryAutoInit() {
    const attempt = async () => {
        const clientAvailable = (typeof supabaseClient !== 'undefined' && supabaseClient && typeof supabaseClient.from === 'function') || (window.supabaseClient && typeof window.supabaseClient.from === 'function');
        if (clientAvailable) {
            console.debug('[spotify] supabase client detected on page — initializing');
            try { await initSpotifyPresence(); } catch (e) { console.warn('[spotify] init failed:', e); }
        } else {
            console.debug('[spotify] supabase client not yet detected — waiting');
            setTimeout(attempt, 600);
        }
    };
    attempt();
})();