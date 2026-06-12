// ======================== ENHANCED ADMIN DEBUG CONSOLE ========================
let adminDebugPanel = null;
let adminConsoleHistory = [];
let adminConsoleHistoryIndex = -1;
let _consoleIntercepted = false;

function initAdminDebugPanel() {
  if (currentSystemRole !== "SysAdmin") return;
  if (window.innerWidth <= 768 || window.matchMedia("(pointer: coarse)").matches) return;
  if (adminDebugPanel) return;

  // ── Build DOM ──────────────────────────────────────────────────────────────
  adminDebugPanel = document.createElement("div");
  adminDebugPanel.id = "admin-debug-panel";
  Object.assign(adminDebugPanel.style, {
    position: "fixed", bottom: "0", right: "0",
    width: "700px", height: "420px",
    background: "#1e1f22", border: "1px solid #3a3d44",
    borderTopLeftRadius: "10px", boxShadow: "0 -4px 32px rgba(0,0,0,0.6)",
    zIndex: "10000", fontFamily: "'Consolas','Monaco','Courier New',monospace",
    display: "flex", flexDirection: "column", overflow: "hidden", resize: "both"
  });

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  Object.assign(toolbar.style, {
    display: "flex", alignItems: "center", gap: "6px",
    padding: "6px 10px", background: "#2b2d31",
    borderBottom: "1px solid #3a3d44", flexShrink: "0", userSelect: "none"
  });

  const title = document.createElement("span");
  title.textContent = "🛡️ SysAdmin Console";
  Object.assign(title.style, { color: "#3ba55d", fontWeight: "bold", fontSize: "13px", marginRight: "auto", cursor: "move" });

  // Filter buttons
  const filters = ["ALL", "LOG", "WARN", "ERROR", "INFO", "NET"];
  const filterBtns = {};
  const activeFilters = new Set(["ALL"]);

  filters.forEach(f => {
    const btn = document.createElement("button");
    btn.textContent = f;
    btn.dataset.filter = f;
    Object.assign(btn.style, {
      padding: "2px 8px", fontSize: "11px", border: "1px solid #444",
      borderRadius: "4px", cursor: "pointer", fontFamily: "inherit",
      background: f === "ALL" ? "#5865f2" : "#2b2d31",
      color: f === "ALL" ? "#fff" : "#949ba4", transition: "all 0.15s"
    });
    btn.addEventListener("click", () => toggleFilter(f, btn));
    filterBtns[f] = btn;
    toolbar.appendChild(btn);
  });

  // Clear / close
  const clearBtn = makeToolbarBtn("Clear", "#ed4245");
  clearBtn.addEventListener("click", clearConsole);

  const closeBtn = makeToolbarBtn("✕", "#555");
  closeBtn.addEventListener("click", () => { adminDebugPanel.style.display = "none"; });

  toolbar.insertBefore(title, toolbar.firstChild);
  toolbar.appendChild(clearBtn);
  toolbar.appendChild(closeBtn);

  // ── Output area ────────────────────────────────────────────────────────────
  const output = document.createElement("div");
  output.id = "admin-console-output";
  Object.assign(output.style, {
    flex: "1", overflowY: "auto", overflowX: "hidden",
    padding: "6px 0", background: "#1e1f22",
    fontSize: "12px", lineHeight: "1.5", fontFamily: "inherit"
  });

  // ── Input row ──────────────────────────────────────────────────────────────
  const inputRow = document.createElement("div");
  Object.assign(inputRow.style, {
    display: "flex", alignItems: "center", gap: "6px",
    padding: "6px 10px", background: "#2b2d31",
    borderTop: "1px solid #3a3d44", flexShrink: "0", position: "relative"
  });

  const promptLabel = document.createElement("span");
  promptLabel.textContent = "❯";
  promptLabel.style.cssText = "color:#3ba55d;font-weight:bold;font-size:14px;flex-shrink:0;";

  const inputEl = document.createElement("input");
  inputEl.id = "admin-console-input";
  Object.assign(inputEl.style, {
    flex: "1", background: "#1e1f22", border: "1px solid #3a3d44",
    borderRadius: "4px", color: "#dbdee1", padding: "4px 8px",
    fontFamily: "inherit", fontSize: "12px", outline: "none"
  });
  inputEl.placeholder = "Run any JS… try: document.title, fetch(), supabaseClient, servers";
  inputEl.addEventListener("focus", () => { inputEl.style.borderColor = "#5865f2"; });
  inputEl.addEventListener("blur",  () => { inputEl.style.borderColor = "#3a3d44"; });

  const runBtn = makeToolbarBtn("Run ▶", "#3ba55d");
  runBtn.addEventListener("click", () => runCommand());

  // Autocomplete dropdown
  const autocompleteBox = document.createElement("div");
  Object.assign(autocompleteBox.style, {
    display: "none", position: "absolute", bottom: "100%", left: "32px", right: "60px",
    background: "#2b2d31", border: "1px solid #5865f2", borderRadius: "6px",
    maxHeight: "160px", overflowY: "auto", zIndex: "10002", fontSize: "12px"
  });

  inputRow.appendChild(promptLabel);
  inputRow.appendChild(inputEl);
  inputRow.appendChild(runBtn);
  inputRow.appendChild(autocompleteBox);

  adminDebugPanel.appendChild(toolbar);
  adminDebugPanel.appendChild(output);
  adminDebugPanel.appendChild(inputRow);
  document.body.appendChild(adminDebugPanel);

  // ── Drag to move ──────────────────────────────────────────────────────────
  let drag = null;
  title.addEventListener("mousedown", e => {
    drag = { x: e.clientX - adminDebugPanel.offsetLeft, y: e.clientY - adminDebugPanel.offsetTop };
    e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!drag) return;
    adminDebugPanel.style.left = (e.clientX - drag.x) + "px";
    adminDebugPanel.style.top  = (e.clientY - drag.y) + "px";
    adminDebugPanel.style.bottom = "auto"; adminDebugPanel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => { drag = null; });

  // ── Keyboard handler ──────────────────────────────────────────────────────
  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); runCommand(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (adminConsoleHistoryIndex > 0) inputEl.value = adminConsoleHistory[--adminConsoleHistoryIndex];
      hideAutocomplete(); return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (adminConsoleHistoryIndex < adminConsoleHistory.length - 1)
        inputEl.value = adminConsoleHistory[++adminConsoleHistoryIndex];
      else { adminConsoleHistoryIndex = adminConsoleHistory.length; inputEl.value = ""; }
      hideAutocomplete(); return;
    }
    if (e.key === "Tab") { e.preventDefault(); applyFirstAutocomplete(); return; }
    if (e.key === "Escape") { hideAutocomplete(); return; }
    setTimeout(() => updateAutocomplete(inputEl.value), 0);
  });
  inputEl.addEventListener("input", () => updateAutocomplete(inputEl.value));
  document.addEventListener("click", e => {
    if (!inputRow.contains(e.target)) hideAutocomplete();
  });

  // ── Intercept ALL console output ──────────────────────────────────────────
  interceptConsole(output, activeFilters);

  // ── Intercept window errors ────────────────────────────────────────────────
  window.addEventListener("error", ev => {
    appendLine(output, activeFilters, {
      type: "ERROR",
      parts: [`🔴 Uncaught ${ev.message}`, `  at ${ev.filename}:${ev.lineno}:${ev.colno}`],
      raw: null
    });
  });

  window.addEventListener("unhandledrejection", ev => {
    const msg = ev.reason instanceof Error
      ? ev.reason.stack || ev.reason.message
      : String(ev.reason);
    appendLine(output, activeFilters, { type: "ERROR", parts: [`🔴 Unhandled Promise Rejection: ${msg}`], raw: null });
  });

  // ── Intercept fetch (network tab) ─────────────────────────────────────────
  interceptFetch(output, activeFilters);

  // ── Welcome message ───────────────────────────────────────────────────────
  appendLine(output, activeFilters, { type: "INFO",  parts: ["🛡️  SysAdmin Console — full browser-console replacement"], raw: null });
  appendLine(output, activeFilters, { type: "INFO",  parts: ["   All errors, warnings, network requests and console output captured."], raw: null });
  appendLine(output, activeFilters, { type: "INFO",  parts: ["   Use Tab for autocomplete. Arrow keys for history. Click any object to expand."], raw: null });

  // ── Helper functions (scoped) ─────────────────────────────────────────────

  function makeToolbarBtn(label, bg) {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      padding: "2px 9px", fontSize: "11px", border: "none", borderRadius: "4px",
      cursor: "pointer", fontFamily: "inherit", background: bg, color: "#fff", flexShrink: "0"
    });
    return b;
  }

  function toggleFilter(f, btn) {
    if (f === "ALL") {
      activeFilters.clear(); activeFilters.add("ALL");
      Object.values(filterBtns).forEach(b => { b.style.background = "#2b2d31"; b.style.color = "#949ba4"; });
      btn.style.background = "#5865f2"; btn.style.color = "#fff";
    } else {
      activeFilters.delete("ALL");
      filterBtns["ALL"].style.background = "#2b2d31"; filterBtns["ALL"].style.color = "#949ba4";
      if (activeFilters.has(f)) {
        activeFilters.delete(f);
        btn.style.background = "#2b2d31"; btn.style.color = "#949ba4";
      } else {
        activeFilters.add(f);
        btn.style.background = typeColor(f); btn.style.color = "#fff";
      }
      if (activeFilters.size === 0) { activeFilters.add("ALL"); filterBtns["ALL"].style.background = "#5865f2"; filterBtns["ALL"].style.color = "#fff"; }
    }
    // Re-apply filter to all existing rows
    output.querySelectorAll(".console-row").forEach(row => {
      const t = row.dataset.type;
      row.style.display = (activeFilters.has("ALL") || activeFilters.has(t)) ? "flex" : "none";
    });
  }

  function clearConsole() { output.innerHTML = ""; }

  function runCommand() {
    const cmd = inputEl.value.trim();
    if (!cmd) return;
    adminConsoleHistory.push(cmd);
    adminConsoleHistoryIndex = adminConsoleHistory.length;
    inputEl.value = "";
    hideAutocomplete();

    // Echo input
    appendLine(output, activeFilters, { type: "LOG", parts: ["❯ " + cmd], raw: null, dimmed: true });

    try {
      // Use indirect eval so it runs in global scope with access to all vars
      const result = (0, eval)(cmd);
      if (result !== undefined) {
        appendLine(output, activeFilters, { type: "LOG", parts: [null], raw: result, prefix: "◀ " });
      }
    } catch (err) {
      appendLine(output, activeFilters, { type: "ERROR", parts: ["✖ " + err.message], raw: null });
    }

    output.scrollTop = output.scrollHeight;
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────
const SUGGESTIONS = [
  // --- 🟢 CORE VARIABLES & STATE (Quick Access) ---
  "servers",
  "channels",
  "username",
  "currentRole",
  "currentSystemRole",
  "currentServerId",
  "currentChannelId",
  "serverMembers",
  "messagesMap",
  "userPermissions",
  "voiceParticipantState",
  "currentPeerConnections.size",
  "currentVoiceChannelId",
  "availableThemes",

  // --- 🔧 SYSTEM & NAVIGATION (Quick Fixes) ---
  "loadServers()",
  "loadServerMembers()",
  "loadMessages()",
  "renderChannelList()",
  "subscribeToCurrentChannel()",
  "refreshServerRole()",
  "refreshUnreadMentionCounts()",
  "markServerMentionsRead(currentServerId)",
  "toggleMobileSimulation()",
  "startTutorial()",

  // --- 🛡️ USER & MEMBER MANAGEMENT (Moderation) ---
  "forceLogout('target_username')",
  "globalMuteUser('target_username', 60)",
  "globalUnmuteUser('target_username')",
  "deleteUser('target_username')",
  "kickMemberFromCurrentServer(serverMembers.find(m=>m.username==='target'))",
  "promote('target_username', 'Admin')",
  "changeName('target_username')",
  "userInfo('target_username')",
  "transferOwnership()",

  // --- 🗄️ DATABASE & DATA HYGIENE (Bulk Actions) ---
  "fixPlainGifUrls()",
  "deleteKeyword('spam_word')",
  "exportChat()",
  "censorContent('test text')",
  "clearServerCache()", // Note: Ensure this function exists or use manual cache clear

  // --- 🎤 VOICE & MEDIA DIAGNOSTICS (Advanced) ---
  "testVoiceChat()",
  "quickVoiceCheck()",
  "runVoiceAudioTests()",
  "simulatePerson()",
  "monitorNetworkAudio()",
  "silentAudioAnalyzerTest()",
  "testAudioPlayback()",
  "testAudioRouting()",
  "startAudioLevelMonitoring()",
  "leaveVoiceChannel()",
  "joinVoiceChannel()",

  // --- 🎨 THEMES & UI ---
  "loadThemesAndApply()",
  "selectTheme('theme_id_here')",
  "document.querySelectorAll('audio').length",

  // --- 🌐 BROWSER & NETWORK (Native) ---
  "document.title",
  "document.cookie",
  "window.location.href",
  "localStorage",
  "sessionStorage",
  "navigator.userAgent",
  "performance.memory",
  "performance.now()",
  "supabaseClient",
  "supabaseClient.auth.getUser()",
  "supabaseClient.auth.getSession()"
];

  function updateAutocomplete(val) {
    if (!val) { hideAutocomplete(); return; }
    const matches = SUGGESTIONS.filter(s => s.toLowerCase().startsWith(val.toLowerCase()) && s !== val);
    if (!matches.length) { hideAutocomplete(); return; }
    autocompleteBox.innerHTML = "";
    matches.slice(0, 10).forEach((m, i) => {
      const item = document.createElement("div");
      item.textContent = m;
      Object.assign(item.style, {
        padding: "4px 10px", cursor: "pointer",
        color: i === 0 ? "#fff" : "#dbdee1",
        background: i === 0 ? "rgba(88,101,242,0.3)" : "transparent"
      });
      item.addEventListener("mousedown", e => { e.preventDefault(); inputEl.value = m; hideAutocomplete(); inputEl.focus(); });
      item.addEventListener("mouseover", () => { item.style.background = "rgba(88,101,242,0.2)"; });
      item.addEventListener("mouseout",  () => { item.style.background = i === 0 ? "rgba(88,101,242,0.3)" : "transparent"; });
      autocompleteBox.appendChild(item);
    });
    autocompleteBox.style.display = "block";
  }

  function hideAutocomplete() { autocompleteBox.style.display = "none"; autocompleteBox.innerHTML = ""; }

  function applyFirstAutocomplete() {
    const first = autocompleteBox.querySelector("div");
    if (first) { inputEl.value = first.textContent; hideAutocomplete(); inputEl.focus(); }
  }
}

// ── Shared helpers (outside initAdminDebugPanel so interceptFetch can call appendLine) ──

function typeColor(type) {
  return { ERROR: "#ed4245", WARN: "#faa61a", INFO: "#5865f2", NET: "#3ba55d", LOG: "#5e6272" }[type] || "#5e6272";
}

function typeTextColor(type) {
  return { ERROR: "#ff6b6b", WARN: "#ffd966", INFO: "#7289da", NET: "#57f287", LOG: "#dbdee1" }[type] || "#dbdee1";
}

function serializeValue(val, depth) {
  if (depth === undefined) depth = 0;
  if (val === null) return { text: "null", color: "#949ba4" };
  if (val === undefined) return { text: "undefined", color: "#949ba4" };
  if (typeof val === "boolean") return { text: String(val), color: "#f1c40f" };
  if (typeof val === "number") return { text: String(val), color: "#f1c40f" };
  if (typeof val === "string") return { text: depth > 0 ? `"${val}"` : val, color: depth > 0 ? "#a8c97f" : "#dbdee1" };
  if (typeof val === "function") return { text: `ƒ ${val.name || "anonymous"}()`, color: "#c792ea" };
  if (val instanceof Error) return { text: val.stack || val.message, color: "#ff6b6b" };
  if (val instanceof Promise) return { text: "Promise {…}", color: "#c792ea" };
  if (typeof val === "object") {
    const isArr = Array.isArray(val);
    try {
      const keys = isArr ? [...val.keys()] : Object.keys(val).slice(0, 5);
      const preview = keys.slice(0, 3).map(k => {
        const v = val[k];
        const vt = typeof v;
        const vs = v === null ? "null" : vt === "object" ? (Array.isArray(v) ? "[…]" : "{…}") : vt === "function" ? "ƒ" : String(v).slice(0, 20);
        return isArr ? vs : `${k}: ${vs}`;
      }).join(", ");
      const more = keys.length > 3 ? `, …+${keys.length - 3}` : "";
      const label = isArr ? `Array(${val.length})` : (val.constructor?.name && val.constructor.name !== "Object" ? val.constructor.name : "Object");
      return { text: `${label} { ${preview}${more} }`, color: "#c792ea", expandable: true, value: val };
    } catch { return { text: "[Object]", color: "#949ba4" }; }
  }
  return { text: String(val), color: "#dbdee1" };
}

function buildExpandableTree(val, depth) {
  if (depth === undefined) depth = 0;
  const container = document.createElement("div");
  container.style.cssText = `margin-left:${depth * 14}px; font-family:inherit; font-size:12px;`;

  if (val === null || val === undefined || typeof val !== "object" || val instanceof Promise) {
    const s = serializeValue(val, depth);
    const span = document.createElement("span");
    span.textContent = s.text; span.style.color = s.color;
    container.appendChild(span); return container;
  }

  const isArr = Array.isArray(val);
  const keys = isArr ? [...Array(Math.min(val.length, 100)).keys()] : Object.keys(val).slice(0, 200);
  const label = isArr ? `Array(${val.length})` : (val.constructor?.name && val.constructor.name !== "Object" ? val.constructor.name : "Object");
  const open = isArr ? "[" : "{";
  const close = isArr ? "]" : "}";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  const arrow = document.createElement("span");
  arrow.textContent = "▶"; arrow.style.cssText = "color:#949ba4;font-size:10px;width:10px;flex-shrink:0;transition:transform 0.15s;";
  const headerText = document.createElement("span");
  headerText.style.color = "#c792ea";
  headerText.textContent = `${label} ${open}`;
  if (keys.length > 0) {
    const preview = keys.slice(0, 3).map(k => {
      try { const v = val[k]; return isArr ? serializeValue(v, 1).text : `${k}: ${serializeValue(v, 1).text}`; } catch { return "…"; }
    }).join(", ");
    const moreCount = keys.length > 3 ? `, +${keys.length - 3} more` : "";
    const previewSpan = document.createElement("span");
    previewSpan.textContent = ` ${preview}${moreCount} `;
    previewSpan.style.color = "#949ba4";
    headerText.appendChild(previewSpan);
  }
  const closeSpan = document.createElement("span");
  closeSpan.textContent = close; closeSpan.style.color = "#c792ea";
  headerText.appendChild(closeSpan);

  header.appendChild(arrow); header.appendChild(headerText);
  container.appendChild(header);

  const body = document.createElement("div");
  body.style.display = "none";
  let rendered = false;
  header.addEventListener("click", () => {
    const expanded = body.style.display !== "none";
    body.style.display = expanded ? "none" : "block";
    arrow.style.transform = expanded ? "" : "rotate(90deg)";
    if (!rendered && !expanded) {
      rendered = true;
      keys.forEach(k => {
        const row = document.createElement("div");
        row.style.cssText = `display:flex;gap:6px;margin-left:14px;padding:1px 0;`;
        const keySpan = document.createElement("span");
        keySpan.textContent = isArr ? `${k}:` : `${k}:`;
        keySpan.style.cssText = "color:#9fa8da;flex-shrink:0;";
        row.appendChild(keySpan);
        try {
          const child = buildExpandableTree(val[k], depth + 1);
          row.appendChild(child);
        } catch (e) {
          const err = document.createElement("span");
          err.textContent = "[Error reading property]"; err.style.color = "#ff6b6b";
          row.appendChild(err);
        }
        body.appendChild(row);
      });
      if (keys.length === 200 && !isArr) {
        const more = document.createElement("div");
        more.textContent = "  … (truncated at 200 keys)"; more.style.color = "#949ba4"; more.style.marginLeft = "14px";
        body.appendChild(more);
      }
    }
  });
  container.appendChild(body);
  return container;
}

function appendLine(output, activeFilters, entry) {
  if (!output) return;
  const { type, parts, raw, dimmed, prefix } = entry;
  const row = document.createElement("div");
  row.className = "console-row";
  row.dataset.type = type;
  Object.assign(row.style, {
    display: (activeFilters && (activeFilters.has("ALL") || activeFilters.has(type))) ? "flex" : "none",
    alignItems: "flex-start", gap: "8px", padding: "3px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.03)",
    opacity: dimmed ? "0.55" : "1"
  });
  row.addEventListener("mouseover", () => { row.style.background = "rgba(255,255,255,0.03)"; });
  row.addEventListener("mouseout",  () => { row.style.background = ""; });

  // Type badge
  const badge = document.createElement("span");
  badge.textContent = type;
  Object.assign(badge.style, {
    fontSize: "10px", padding: "1px 5px", borderRadius: "3px", flexShrink: "0",
    background: typeColor(type) + "33", color: typeColor(type),
    fontWeight: "bold", marginTop: "1px", minWidth: "36px", textAlign: "center"
  });
  row.appendChild(badge);

  // Content
  const content = document.createElement("div");
  content.style.cssText = "flex:1;min-width:0;word-break:break-word;color:" + typeTextColor(type) + ";";

  if (parts && parts.length > 0) {
    parts.forEach((p, i) => {
      if (p === null) return;
      if (i > 0) content.appendChild(document.createElement("br"));
      const span = document.createElement("span");
      span.textContent = p;
      content.appendChild(span);
    });
  }

  if (raw !== undefined && raw !== null) {
    if (prefix) {
      const pre = document.createElement("span");
      pre.textContent = prefix; pre.style.color = "#949ba4";
      content.appendChild(pre);
    }
    const tree = buildExpandableTree(raw, 0);
    content.appendChild(tree);
  }

  row.appendChild(content);

  // Timestamp
  const ts = document.createElement("span");
  ts.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  ts.style.cssText = "color:#555;font-size:10px;flex-shrink:0;margin-top:2px;";
  row.appendChild(ts);

  output.appendChild(row);
  // Auto-scroll only if already near bottom
  if (output.scrollHeight - output.scrollTop - output.clientHeight < 80) {
    output.scrollTop = output.scrollHeight;
  }
}

function interceptConsole(output, activeFilters) {
  if (_consoleIntercepted) return;
  _consoleIntercepted = true;

  const MAP = { log: "LOG", warn: "WARN", error: "ERROR", info: "INFO", debug: "LOG" };
  Object.entries(MAP).forEach(([method, type]) => {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      orig(...args);
      try {
        const parts = [];
        const raws = [];
        args.forEach(a => {
          if (a !== null && typeof a === "object" && !(a instanceof Error)) raws.push(a);
          else parts.push(formatArg(a));
        });
        appendLine(output, activeFilters, { type, parts: parts.length ? [parts.join(" ")] : [], raw: raws.length === 1 ? raws[0] : raws.length > 1 ? raws : null });
      } catch {}
    };
  });

  // console.table
  const origTable = console.table.bind(console);
  console.table = (data, cols) => {
    origTable(data, cols);
    try {
      appendLine(output, activeFilters, { type: "LOG", parts: ["[table]"], raw: data });
    } catch {}
  };

  // console.group / groupEnd
  ["group","groupCollapsed","groupEnd","time","timeEnd","count","countReset","assert"].forEach(m => {
    if (!console[m]) return;
    const orig = console[m].bind(console);
    console[m] = (...args) => {
      orig(...args);
      try {
        appendLine(output, activeFilters, { type: "LOG", parts: [`[${m}] ` + args.map(formatArg).join(" ")], raw: null, dimmed: true });
      } catch {}
    };
  });
}

function shortenUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 40 ? u.pathname.slice(0, 37) + "…" : u.pathname;
    const host = u.hostname.replace("www.", "");
    return `${host}${path}${u.search ? "?" + u.search.slice(1, 20) + (u.search.length > 21 ? "…" : "") : ""}`;
  } catch {
    return url.length > 80 ? url.slice(0, 77) + "…" : url;
  }
}

// ── ULTIMATE NETWORK & EMBED MONITOR ────────────────────────────────────────
function interceptFetch(output, activeFilters) {
  // 1. Patch Fetch (Global)
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = args[0];
    const method = args[1]?.method || 'GET';
    appendLine(output, activeFilters, { 
      type: "NET", 
      parts: [`🌐 Fetch: ${method} ${typeof url === 'string' ? url : url.url}`], 
      raw: null 
    });
    try {
      const res = await originalFetch.apply(this, args);
      appendLine(output, activeFilters, { 
        type: "NET", 
        parts: [`✅ ${res.status} ${res.statusText}`], 
        raw: res 
      });
      return res;
    } catch (err) {
      appendLine(output, activeFilters, { 
        type: "ERROR", 
        parts: [`❌ Fetch Failed: ${err.message}`], 
        raw: err 
      });
      throw err;
    }
  };

  // 2. Patch XHR (Global)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    appendLine(output, activeFilters, { 
      type: "NET", 
      parts: [`🌐 XHR: ${method.toUpperCase()} ${url}`], 
      raw: null 
    });
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (body) {
    return originalXHRSend.apply(this, [body]);
  };

  // 3. CSP Violation Listener (Crucial for embeds!)
  document.addEventListener('securitypolicyviolation', (e) => {
    appendLine(output, activeFilters, { 
      type: "ERROR", 
      parts: [`🚫 CSP BLOCKED: ${e.blockedURI} (Directive: ${e.violatedDirective})`], 
      raw: e 
    });
  });

  // 4. Global Error & Promise Rejection Monitor
  window.addEventListener('error', (e) => {
    if (e.message.toLowerCase().includes('gofundme') || e.filename?.includes('gofundme')) {
      appendLine(output, activeFilters, { 
        type: "ERROR", 
        parts: [`💥 GoFundMe Error: ${e.message}`, `  at ${e.filename}:${e.lineno}`], 
        raw: e 
      });
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e.reason);
    if (msg.includes('gofundme') || msg.includes('embed')) {
      appendLine(output, activeFilters, { 
        type: "ERROR", 
        parts: [`💥 GoFundMe Promise Rejection: ${msg}`], 
        raw: e.reason 
      });
    }
  });

  // 5. Iframe Observer (Detects creation & src changes)
  const iframeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === 'IFRAME') {
          const src = node.src || '(no src)';
          appendLine(output, activeFilters, { 
            type: "NET", 
            parts: [`📺 Iframe Created: ${src}`], 
            raw: node 
          });
          
          // Try to attach a load listener (will fail for cross-origin, but we log the attempt)
          try {
            node.addEventListener('load', () => {
              appendLine(output, activeFilters, { 
                type: "INFO", 
                parts: [`✅ Iframe Loaded: ${src}`], 
                raw: null 
              });
            });
            node.addEventListener('error', () => {
              appendLine(output, activeFilters, { 
                type: "ERROR", 
                parts: [`❌ Iframe Failed to Load: ${src}`], 
                raw: null 
              });
            });
          } catch (err) {
            appendLine(output, activeFilters, { 
              type: "WARN", 
              parts: [`⚠️ Cannot monitor iframe events (Cross-Origin): ${src}`], 
              raw: null 
            });
          }
        }
      });
    });
  });
  iframeObserver.observe(document.body, { childList: true, subtree: true });

  // 6. Auto-Diagnose GoFundMe Embed on Load
  setTimeout(() => {
    const embed = document.querySelector('.gfm-embed');
    if (embed) {
      const iframe = embed.querySelector('iframe');
      appendLine(output, activeFilters, { 
        type: "INFO", 
        parts: [`🔍 GoFundMe Embed Found:`, `  Container: ${!!embed}`, `  Iframe: ${!!iframe}`, `  Src: ${iframe?.src || 'None'}`], 
        raw: null 
      });
      
      if (!iframe) {
        appendLine(output, activeFilters, { 
          type: "WARN", 
          parts: [`⚠️ No iframe found inside .gfm-embed! Script might not have loaded.`], 
          raw: null 
        });
      }
    }
  }, 1000); // Wait 1s for script to load
}

function formatArg(a) {
  if (a === null) return "null";
  if (a === undefined) return "undefined";
  if (typeof a === "string") return a;
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  if (a instanceof Error) return a.stack || a.message;
  try { return JSON.stringify(a, null, 0).slice(0, 300); } catch { return "[Object]"; }
}

// ── Re-init trigger ──────────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof currentSystemRole !== "undefined" && currentSystemRole === "SysAdmin") initAdminDebugPanel();
  });
} else {
  if (typeof currentSystemRole !== "undefined" && currentSystemRole === "SysAdmin") initAdminDebugPanel();
}

function overrideConsoleMethods() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  console.log = (...args) => {
    logToAdminConsole(formatConsoleArgs(args), 'log');
    originalLog.apply(console, args);
  };

  console.error = (...args) => {
    logToAdminConsole(formatConsoleArgs(args), 'error');
    originalError.apply(console, args);
  };

  console.warn = (...args) => {
    logToAdminConsole(formatConsoleArgs(args), 'warn');
    originalWarn.apply(console, args);
  };

  console.info = (...args) => {
    logToAdminConsole(formatConsoleArgs(args), 'info');
    originalInfo.apply(console, args);
  };
}

function formatConsoleArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return '[Circular or Unserializable Object]';
      }
    }
    return String(arg);
  }).join(' ');
}

function logToAdminConsole(message, type = 'log') {
  if (!adminDebugPanel) return;

  const output = document.getElementById('admin-console-output');
  const line = document.createElement('div');
  line.style.cssText = `
    margin-bottom: 4px;
    word-wrap: break-word;
    border-left: 3px solid transparent;
    padding-left: 8px;
  `;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}]`;

  switch (type) {
    case 'error':
      line.style.borderLeftColor = '#ed4245';
      line.style.color = '#ff6b6b';
      break;
    case 'warn':
      line.style.borderLeftColor = '#faa61a';
      line.style.color = '#ffd966';
      break;
    case 'success':
      line.style.borderLeftColor = '#3ba55d';
      line.style.color = '#3ba55d';
      break;
    case 'info':
      line.style.borderLeftColor = '#5865f2';
      line.style.color = '#5865f2';
      break;
    default:
      line.style.borderLeftColor = '#949ba4';
      line.style.color = '#dbdee1';
  }

  line.innerHTML = `<span style="opacity: 0.6; margin-right: 8px;">${prefix}</span>${escapeHTML(message)}`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function executeAdminCommand(command) {
  logToAdminConsole(`> ${command}`, 'info');

  try {
    const result = new Function('return ' + command)();
    logToAdminConsole(`✅ ${result}`, 'success');
  } catch (error) {
    // Try direct evaluation if it's a statement
    try {
      eval(command);
      logToAdminConsole(`✅ Command executed (no return value)`, 'success');
    } catch (evalError) {
      logToAdminConsole(`❌ ${evalError.message}`, 'error');
    }
  }
}

function makeElementDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  handle.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

// Initialize on load if SysAdmin
if (typeof currentSystemRole !== 'undefined' && currentSystemRole === 'SysAdmin') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminDebugPanel);
  } else {
    initAdminDebugPanel();
  }
}

/**
 * Silent Audio Analyzer Test
 * 
 * Creates a temporary AudioContext and AnalyserNode to check if the browser
 * can process audio data. 
 * 
 * WARNING: In most browsers, you cannot "listen" to system audio (what you hear)
 * via JS without a specific permission or extension. This will likely show 0 
 * unless you are already in a voice channel where the stream is active.
 * 
 * Usage: Run in console: silentAudioAnalyzerTest()
 */
window.silentAudioAnalyzerTest = async function() {
  console.log('🔇 Starting Silent Audio Analyzer Test...');
  
  const results = {
    contextCreated: false,
    analyserCreated: false,
    hasAudioInput: false,
    audioLevel: 0,
    message: ''
  };

  try {
    // 1. Create AudioContext (Does not play sound)
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    
    if (ctx.state === 'suspended') {
      // Browsers often suspend context until a user gesture. 
      // We try to resume, but if it fails, we might not get data.
      await ctx.resume().catch(e => console.warn("Context resume failed (expected):", e));
    }
    
    results.contextCreated = true;
    console.log('✅ AudioContext created (suspended/resumed state:', ctx.state + ')');

    // 2. Create Analyser
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    results.analyserCreated = true;
    console.log('✅ AnalyserNode created');

    // 3. Attempt to connect to the destination (Speakers)
    // NOTE: This does NOT capture system audio. It creates a path to the speakers.
    // To actually "hear" system audio, you would need a MediaStreamDestination 
    // capturing a loopback device, which is not standard JS.
    // We connect the analyser to the destination to ensure the graph is valid.
    const dest = ctx.createMediaStreamDestination();
    analyser.connect(dest);
    
    // 4. Run a silent check
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Get data immediately
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average level
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    results.audioLevel = average;
    
    if (average > 5) {
      results.hasAudioInput = true;
      results.message = `Detected audio activity (Level: ${Math.round(average)}). This implies audio is currently playing or a stream is active.`;
    } else {
      results.hasAudioInput = false;
      results.message = `No audio detected (Level: ${Math.round(average)}). This is normal if no audio is playing or if you are not in a voice channel.`;
    }

    // 5. Cleanup
    analyser.disconnect();
    dest.disconnect();
    await ctx.close();

    console.log('📊 Silent Test Results:', results);
    console.log('%c' + results.message, 'color: ' + (results.hasAudioInput ? '#3ba55d' : '#949ba4'));
    
    return results;

  } catch (err) {
    console.error('❌ Silent Audio Test Failed:', err);
    results.message = 'Error: ' + err.message;
    return results;
  }
};

/**
 * Simulates a remote user joining, playing a beep, and leaving.
 * 
 * LOGIC:
 * 1. Creates a local AudioContext and Oscillator (Beep).
 * 2. Creates a fake RTCPeerConnection to simulate the "incoming track".
 * 3. Routes the beep to the browser's audio output.
 * 4. Logs all steps and errors.
 * 
 * USAGE: Run in console: simulatePerson()
 */
window.simulatePerson = async function() {
  const log = (msg, type = 'info') => {
    const color = type === 'error' ? '#ed4245' : (type === 'success' ? '#3ba55d' : '#5865f2');
    console.log(`%c[SIM-BOT] ${msg}`, `color: ${color}; font-weight: bold;`);
  };

  log('Starting simulation sequence...', 'info');

  const simulationState = {
    started: false,
    beepPlaying: false,
    connectionEstablished: false,
    error: null
  };

  try {
    // 1. Setup Audio Context
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    log('✅ AudioContext initialized');

    // 2. Generate the Beep (Oscillator)
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, ctx.currentTime); // A4 note
    oscillator.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 2); // Slide up
    
    // Volume ramp (Fade in/out to avoid clicking)
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1); // Fade in
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 4.9); // Fade out
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination); // Connect to speakers
    
    log('🔊 Beep generator created (440Hz -> 880Hz)', 'info');

    // 3. Simulate "Remote Track" Logic
    // Since we can't fake a server-side join, we simulate the *effect* of receiving a track
    // by creating a MediaStream from our oscillator and treating it like a remote stream.
    const dest = ctx.createMediaStreamDestination();
    gainNode.connect(dest); // Route beep to a stream
    
    const fakeStream = dest.stream;
    const fakeTrack = fakeStream.getAudioTracks()[0];
    
    // Create a fake Peer Connection to trigger your ontrack logic if possible
    // Note: This won't actually connect to the server, but tests the local audio path
    const peerConn = new RTCPeerConnection();
    
    peerConn.ontrack = (event) => {
      log('🎵 [SIM-BOT] Received track event (Simulated)', 'success');
      
      // Create audio element exactly like your real code does
      const audio = document.createElement('audio');
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      
      // CRITICAL: Your code forces muted=true by default. 
      // We must manually unmute this simulated track to hear it, 
      // mimicking what testAudioRouting() would do.
      audio.muted = false; 
      
      document.body.appendChild(audio);
      log('🔈 Audio element created and UNMUTED for simulation', 'success');
      
      // Cleanup after 5 seconds
      setTimeout(() => {
        audio.remove();
        log('👋 [SIM-BOT] Simulated user left (Audio removed)', 'info');
      }, 5000);
    };

    // Add the track to the connection (simulating incoming data)
    peerConn.addTrack(fakeTrack, fakeStream);
    
    // Start the beep
    oscillator.start();
    simulationState.started = true;
    simulationState.beepPlaying = true;
    log('🔔 Beep started (Duration: 5s)', 'success');

    // 4. Cleanup Function
    const cleanup = () => {
      try {
        oscillator.stop();
        peerConn.close();
        ctx.close();
        log('🧹 Simulation resources cleaned up', 'info');
      } catch (e) {
        log(`Cleanup warning: ${e.message}`, 'error');
      }
    };

    // Schedule automatic stop
    setTimeout(() => {
      if (simulationState.beepPlaying) {
        log('⏱️  5 seconds elapsed. Stopping beep...', 'info');
        cleanup();
        simulationState.beepPlaying = false;
      }
    }, 5000);

    // Return status
    return {
      success: true,
      message: "Simulation running. Listen for a 5-second beep.",
      state: simulationState
    };

  } catch (err) {
    simulationState.error = err;
    log(`❌ CRITICAL ERROR: ${err.message}`, 'error');
    console.error(err);
    return {
      success: false,
      error: err.message,
      state: simulationState
    };
  }
};

/**
 * Robust Network Audio Monitor
 * 
 * Scans ALL active RTCPeerConnections in the browser, not just a custom list.
 * This fixes the issue where the connection exists but the custom list is empty.
 */
window.monitorNetworkAudio = async function() {
  const log = (msg, type = 'info') => {
    const color = type === 'error' ? '#ed4245' : (type === 'success' ? '#3ba55d' : '#f1c40f');
    console.log(`%c[NET-MONITOR] ${msg}`, `color: ${color}; font-weight: bold;`);
  };

  log('Scanning for ALL active WebRTC connections...');

  let foundConnections = 0;
  let totalPackets = 0;

  // 1. Try to find connections in your custom list first (if it exists)
  const customList = window.activeConnections || {};
  const customKeys = Object.keys(customList);
  
  if (customKeys.length > 0) {
    log(`Found ${customKeys.length} connections in custom list.`, 'success');
    for (const key of customKeys) {
      await checkConnection(customList[key], key);
    }
  }

  // 2. CRITICAL FALLBACK: Scan the browser's internal connection registry
  // This catches connections that your app didn't register in 'activeConnections'
  log('Scanning browser internal connection registry...');
  
  // We use a trick: iterate through all global variables looking for PeerConnections
  // Note: This is a bit hacky but necessary if your app doesn't store them globally.
  // A better long-term fix is to ensure your 'initiateConnection' pushes to window.activeConnections.
  
  // Instead of scanning globals (which is unreliable), let's check if you have a global array
  // If you don't, we need to patch your connection logic.
  
  // TEMPORARY FIX: Check if you have a global 'peerConns' or similar
  const possibleGlobals = ['peerConns', 'connections', 'voiceConnections', 'activePeers'];
  let scannedAny = false;

  for (const globalName of possibleGlobals) {
    if (window[globalName]) {
      const conns = Array.isArray(window[globalName]) ? window[globalName] : Object.values(window[globalName]);
      if (conns.length > 0) {
        log(`Found ${conns.length} connections in global '${globalName}'.`, 'success');
        scannedAny = true;
        for (const conn of conns) {
          await checkConnection(conn, globalName);
        }
      }
    }
  }

  if (!scannedAny && customKeys.length === 0) {
    log('❌ CRITICAL: Could not find ANY connection list. Your app is not storing connections globally.', 'error');
    log('💡 FIX: In your "initiateConnection" function, add: window.activeConnections = window.activeConnections || {}; window.activeConnections[targetUsername] = peerConn;', 'info');
    return;
  }

  if (foundConnections === 0) {
    log('⚠️ Connections found, but no audio packets detected yet. Someone needs to speak!', 'info');
  } else {
    log(`✅ Total Audio Packets Received: ${totalPackets}`, 'success');
  }

  async function checkConnection(conn, label) {
    try {
      if (conn.connectionState === 'connected' || conn.connectionState === 'connecting') {
        const stats = await conn.getStats();
        let bytesRecv = 0;
        let packetsRecv = 0;

        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            bytesRecv += report.bytesReceived || 0;
            packetsRecv += report.packetsReceived || 0;
          }
        });

        if (packetsRecv > 0) {
          log(`📡 [${label}] Audio Active! Packets: ${packetsRecv}, Bytes: ${bytesRecv}`, 'success');
          foundConnections++;
          totalPackets += packetsRecv;
        } else {
          log(`🔇 [${label}] Connected, but silent (0 packets).`, 'info');
        }
      } else {
        log(`⚠️ [${label}] Connection state: ${conn.connectionState}`, 'info');
      }
    } catch (e) {
      log(`❌ Error checking ${label}: ${e.message}`, 'error');
    }
  }
};

async function fixPlainGifUrls() {
  console.log('🔧 Starting plain GIF URL cleanup...');
  
  if (!username) {
    console.error('❌ Not logged in. Please log in first.');
    return;
  }

  // Regex to detect plain GIF URLs (tenor, giphy, or .gif/.webp/.mp4 endings)
  const GIF_URL_REGEX = /^(https?:\/\/[^\s]+)$/i;
  const GIF_EXTENSIONS = /\.(gif|webp|mp4|png|jpg|jpeg)(\?.*)?$/i;
  const TENOR_DOMAIN = /tenor\.com/i;
  const GIPHY_DOMAIN = /giphy\.com/i;

  let processed = 0;
  let fixed = 0;
  let errors = 0;

  // Fetch messages - adjust limit if you have more
  const { data: messages, error: fetchError } = await supabaseClient
    .from("messages")
    .select("id, content, channel_id")
    .order("id", { ascending: false });

  if (fetchError) {
    console.error('❌ Failed to fetch messages:', fetchError.message);
    return;
  }

  if (!messages || messages.length === 0) {
    console.log('ℹ️ No messages found to check.');
    return;
  }

  console.log(`📊 Found ${messages.length} messages to scan.`);

  for (const msg of messages) {
    processed++;
    
    // Check if content is a plain GIF URL
    const isPlainUrl = GIF_URL_REGEX.test(msg.content.trim());
    
    if (isPlainUrl) {
      const url = msg.content.trim();
      const isGif = GIF_EXTENSIONS.test(url) || TENOR_DOMAIN.test(url) || GIPHY_DOMAIN.test(url);
      
      if (isGif) {
        // Wrap in markdown format that your app expects
        const fixedContent = `[📄 GIF](${url})`;
        
        try {
          const { error: updateError } = await supabaseClient
            .from("messages")
            .update({ content: fixedContent })
            .eq("id", msg.id);

          if (updateError) {
            console.warn(`⚠️ Failed to update message ${msg.id}:`, updateError.message);
            errors++;
          } else {
            fixed++;
            console.log(`✅ Fixed message ${msg.id}: ${url.substring(0, 50)}...`);
          }
        } catch (err) {
          console.error(`❌ Exception updating message ${msg.id}:`, err);
          errors++;
        }
      }
    }
  }

  console.log(`\n🏁 Cleanup Complete!`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Errors: ${errors}`);
  
  if (fixed > 0) {
    console.log('💡 Tip: Reload the page to see the changes reflected in the chat.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.  TUTORIAL SYSTEM
//     Call  startTutorial()  after a brand-new user's first login.
//     Highlights key UI areas one by one with a pulsing spotlight.
//     Progress is saved in localStorage so it only shows once.
// ─────────────────────────────────────────────────────────────────────────────
const TUTORIAL_KEY = "lla_tutorial_done_v2";
 
const TUTORIAL_STEPS = [
  {
    selector: ".server-sidebar",
    title: "Your Servers",
    body: "Each icon here is a server — like a classroom or club. Click one to open it.",
    position: "right",
  },
  {
    selector: ".channel-sidebar",
    title: "Channels",
    body: "Channels are like rooms inside a server. Text channels let you chat; voice channels let you talk live.",
    position: "right",
  },
  {
    selector: "#dmList",
    title: "Direct Messages",
    body: "Send a private message to any member by hitting the <b>+</b> next to Direct Messages.",
    position: "right",
  },
  {
    selector: "#messageInput",
    title: "Send a Message",
    body: "Type here and press <b>Enter</b> (or the Send button) to chat. You can also attach files with 📎 if you're and admin.",
    position: "top",
  },
  /*{
    selector: "#memberList",
    title: "Members",
    body: "See who's online in this server. Right-click (or long-press on mobile) a member to send a DM or view their profile.",
    position: "left",
  },*/
  {
    selector: "#openSettingsBtn",
    title: "Settings",
    body: "Change your avatar, status, notification preferences, and appearance themes here.",
    position: "top",
  },
];
 
function startTutorial() {
  if (localStorage.getItem(TUTORIAL_KEY)) return; // already done
 
  let step = 0;
 
  // ── overlay pieces ──
  const overlay = document.createElement("div");
  overlay.id = "tutorialOverlay";
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "App tutorial");
 
  const spotlight = document.createElement("div");
  spotlight.id = "tutorialSpotlight";
 
  const card = document.createElement("div");
  card.id = "tutorialCard";
 
  const cardTitle = document.createElement("div");
  cardTitle.id = "tutorialCardTitle";
 
  const cardBody = document.createElement("div");
  cardBody.id = "tutorialCardBody";
 
  const cardFooter = document.createElement("div");
  cardFooter.id = "tutorialCardFooter";
 
  const skipBtn = document.createElement("button");
  skipBtn.className = "tutorial-btn tutorial-btn--skip";
  skipBtn.textContent = "Skip tour";
  skipBtn.addEventListener("click", endTutorial);
 
  const nextBtn = document.createElement("button");
  nextBtn.className = "tutorial-btn tutorial-btn--next";
  nextBtn.textContent = "Next →";
  nextBtn.addEventListener("click", () => advanceTutorial(step + 1));
 
  const dots = document.createElement("div");
  dots.id = "tutorialDots";
 
  cardFooter.appendChild(skipBtn);
  cardFooter.appendChild(dots);
  cardFooter.appendChild(nextBtn);
  card.appendChild(cardTitle);
  card.appendChild(cardBody);
  card.appendChild(cardFooter);
  overlay.appendChild(spotlight);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
 
  // Keyboard: Esc to skip, right-arrow to advance
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") endTutorial();
    if (e.key === "ArrowRight") advanceTutorial(step + 1);
  });
 
  advanceTutorial(0);
 
  function advanceTutorial(newStep) {
    step = newStep;
    if (step >= TUTORIAL_STEPS.length) { endTutorial(); return; }
 
    const s = TUTORIAL_STEPS[step];
    const target = document.querySelector(s.selector);
 
    cardTitle.textContent = s.title;
    cardBody.innerHTML = s.body;
    nextBtn.textContent = step === TUTORIAL_STEPS.length - 1 ? "Finish 🎉" : "Next →";
 
    // Dots
    dots.innerHTML = "";
    TUTORIAL_STEPS.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "tutorial-dot" + (i === step ? " tutorial-dot--active" : "");
      dots.appendChild(dot);
    });
 
    if (!target) {
      // Skip steps whose target isn't in the DOM right now
      advanceTutorial(step + 1);
      return;
    }
 
    // Scroll target into view then position spotlight + card
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    requestAnimationFrame(() => positionTutorialStep(target, s.position));
  }
 
  function positionTutorialStep(target, position) {
    const rect = target.getBoundingClientRect();
    const PAD = 8;
 
    // Spotlight
    spotlight.style.left   = (rect.left   - PAD) + "px";
    spotlight.style.top    = (rect.top    - PAD) + "px";
    spotlight.style.width  = (rect.width  + PAD * 2) + "px";
    spotlight.style.height = (rect.height + PAD * 2) + "px";
 
    // Card
    const cw = 280, ch = 160;
    let cx, cy;
    if (position === "right") {
      cx = rect.right + 16;
      cy = rect.top + rect.height / 2 - ch / 2;
    } else if (position === "left") {
      cx = rect.left - cw - 16;
      cy = rect.top + rect.height / 2 - ch / 2;
    } else if (position === "top") {
      cx = rect.left + rect.width / 2 - cw / 2;
      cy = rect.top - ch - 16;
    } else { // bottom
      cx = rect.left + rect.width / 2 - cw / 2;
      cy = rect.bottom + 16;
    }
 
    // Clamp to viewport
    cx = Math.max(8, Math.min(cx, window.innerWidth  - cw - 8));
    cy = Math.max(8, Math.min(cy, window.innerHeight - ch - 8));
 
    card.style.left = cx + "px";
    card.style.top  = cy + "px";
  }
 
  function endTutorial() {
    localStorage.setItem(TUTORIAL_KEY, "1");
    overlay.remove();
  }
}

function removeLocalStorageKey(key) {
  if (!key) {
    console.warn("⚠️ No key provided. Nothing removed.");
    return;
  }

  if (localStorage.getItem(key) !== null) {
    localStorage.removeItem(key);
    console.log(`✅ Removed key: "${key}"`);
  } else {
    console.log(`ℹ️ Key "${key}" did not exist.`);
  }
}

// ======================== ULTIMATE MOBILE SIMULATION ========================
// Shortcut: Ctrl + Alt + M
// Forces BOTH CSS media queries AND JavaScript mobile logic to activate

let isMobileSim = false;
let originalWindowWidth = window.innerWidth;
let originalWindowHeight = window.innerHeight;

function toggleMobileSimulation() {
  const body = document.body;
  const html = document.documentElement;

  if (isMobileSim) {
    // --- RESTORE DESKTOP ---
    isMobileSim = false;
    
    // 1. Restore window dimensions (this triggers CSS media queries)
    window.resizeTo(originalWindowWidth, originalWindowHeight);
    
    // 2. Wait for resize to complete, then force JS to re-check
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      
      // 3. Clean up any manual overrides
      body.classList.remove('mobile-sim-active');
      html.style.width = '';
      html.style.height = '';
      body.style.width = '';
      body.style.margin = '';
      body.style.overflowX = '';
      
      // 4. Remove banner
      const banner = document.getElementById('mobile-sim-banner');
      if (banner) banner.remove();
      
      console.log('✅ Restored to desktop view');
    }, 300);

  } else {
    // --- ENTER MOBILE SIMULATION ---
    isMobileSim = true;
    
    // 1. Save current dimensions
    originalWindowWidth = window.innerWidth;
    originalWindowHeight = window.innerHeight;
    
    // 2. Resize window to phone dimensions (forces CSS media queries)
    window.resizeTo(375, 667); // iPhone SE size
    
    // 3. Add visual styling for the simulation frame
    body.classList.add('mobile-sim-active');
    html.style.width = '375px';
    html.style.height = '667px';
    body.style.width = '375px';
    body.style.margin = '0 auto';
    body.style.overflowX = 'hidden';
    body.style.backgroundColor = '#1e1f22';
    
    // 4. Add banner
    const banner = document.createElement('div');
    banner.id = 'mobile-sim-banner';
    banner.textContent = '📱 MOBILE SIMULATION (Ctrl+Alt+M to exit)';
    banner.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #ed4245;
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      z-index: 10002;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      pointer-events: none;
    `;
    document.body.appendChild(banner);
    
    // 5. Force JS to re-evaluate mobile state
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      
      // 6. Manually trigger mobile-specific UI changes if needed
      // (Adjust selectors based on your app's structure)
      const sidebar = document.querySelector('.server-sidebar, .channel-sidebar');
      if (sidebar) {
        sidebar.classList.add('mobile-hidden');
        sidebar.style.display = 'none';
      }
      
      const hamburger = document.querySelector('.hamburger-menu, .mobile-toggle');
      if (hamburger) {
        hamburger.style.display = 'block';
      }
      
      console.log('✅ Mobile simulation activated');
    }, 350);
  }
}

// Attach key listener
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.altKey && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    toggleMobileSimulation();
  }
});

// Add CSS for smooth animation
const style = document.createElement('style');
style.textContent = `
  body.mobile-sim-active {
    transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
    position: relative;
    z-index: 10000;
    box-shadow: 0 0 60px rgba(0,0,0,0.6);
  }
  
  /* Ensure mobile elements are visible */
  body.mobile-sim-active .hamburger-menu,
  body.mobile-sim-active .mobile-toggle {
    display: block !important;
  }
  
  body.mobile-sim-active .server-sidebar,
  body.mobile-sim-active .channel-sidebar {
    display: none !important;
  }
`;
document.head.appendChild(style);

console.log('✅ Ultimate Mobile Simulation ready. Press Ctrl+Alt+M to toggle.');

const MOBILE_TUTORIAL_STEPS = [
  {
    title: "👋 Welcome to LLA Chat!",
    body: "This quick tour shows you around. Tap <b>Next</b> to continue, or <b>Skip</b> to jump straight in.",
    highlightId: null,
  },
  {
    title: "📱 Open the Sidebar",
    body: "Tap the <b>☰ menu button</b> (top-left) to open your servers and channels. Let's open it now.",
    highlightId: "menuToggle",
    action: () => {
      // Programmatically open the sidebar the same way the menu button does
      const overlay = document.getElementById("sidebarOverlay");
      const channelSidebar = document.querySelector(".channel-sidebar");
      const serverSidebar  = document.querySelector(".server-sidebar");
      if (overlay)       overlay.classList.add("active");
      if (channelSidebar) channelSidebar.classList.add("open");
      if (serverSidebar)  serverSidebar.classList.add("open");
    },
  },
  {
    title: "🗂️ Your Servers",
    body: "The icons on the far left are <b>servers</b> — like classrooms or clubs. Tap one to open it.",
    highlightId: "serverList",
  },
  {
    title: "💬 Channels",
    body: "Inside each server are <b>channels</b>. Text channels let you chat; voice channels let you talk live. Tap any channel name to open it.",
    highlightId: "channelList",
    action: () => {
      // Close sidebar after showing channels so next steps show the chat
      setTimeout(() => {
        const overlay = document.getElementById("sidebarOverlay");
        const channelSidebar = document.querySelector(".channel-sidebar");
        const serverSidebar  = document.querySelector(".server-sidebar");
        if (overlay)       overlay.classList.remove("active");
        if (channelSidebar) channelSidebar.classList.remove("open");
        if (serverSidebar)  serverSidebar.classList.remove("open");
      }, 400);
    },
  },
  {
    title: "✉️ Direct Messages",
    body: "Want to message someone privately? Tap the <b>+ next to Direct Messages</b> in the sidebar to start a DM.",
    highlightId: "newDmBtn",
  },
  {
    title: "⌨️ Sending Messages",
    body: "Type in the <b>message box</b> at the bottom and tap <b>Send</b>. Use <b>📎</b> to attach a file, or type <b>@</b> to mention someone.",
    highlightId: "messageInput",
  },
  {
    title: "⚙️ Settings",
    body: "Tap <b>⚙️</b> (bottom-left) to change your avatar, status, notifications, and theme.",
    highlightId: "openSettingsBtn",
  },
  {
    title: "🎉 You're all set!",
    body: "That's the tour! Jump in and start chatting. You can always find help in the server settings.",
    highlightId: null,
  },
];
 
function startMobileTutorial() {
  if (localStorage.getItem(TUTORIAL_KEY)) return;
 
  let step = 0;
 
  // ── Build the sheet ──────────────────────────────────────────────────────
  const sheet = document.createElement("div");
  sheet.id = "mobileTutorialSheet";
 
  const handle = document.createElement("div");
  handle.className = "mts-handle";
 
  const stepCounter = document.createElement("div");
  stepCounter.className = "mts-counter";
 
  const title = document.createElement("div");
  title.className = "mts-title";
 
  const body = document.createElement("div");
  body.className = "mts-body";
 
  const footer = document.createElement("div");
  footer.className = "mts-footer";
 
  const skipBtn = document.createElement("button");
  skipBtn.className = "mts-btn mts-btn--skip";
  skipBtn.textContent = "Skip tour";
  skipBtn.addEventListener("click", endTutorial);
 
  const dots = document.createElement("div");
  dots.className = "mts-dots";
 
  const nextBtn = document.createElement("button");
  nextBtn.className = "mts-btn mts-btn--next";
  nextBtn.addEventListener("click", () => advanceStep(step + 1));
 
  footer.appendChild(skipBtn);
  footer.appendChild(dots);
  footer.appendChild(nextBtn);
 
  sheet.appendChild(handle);
  sheet.appendChild(stepCounter);
  sheet.appendChild(title);
  sheet.appendChild(body);
  sheet.appendChild(footer);
  document.body.appendChild(sheet);
 
  // ── Coach-mark highlight element (floats over highlighted element) ──────
  const coachMark = document.createElement("div");
  coachMark.id = "mobileTutorialCoachMark";
  document.body.appendChild(coachMark);
 
  // ── Swipe-down to skip ───────────────────────────────────────────────────
  let touchStartY = 0;
  sheet.addEventListener("touchstart", (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener("touchend", (e) => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 60) endTutorial(); // swipe down 60px = dismiss
  }, { passive: true });
 
  advanceStep(0);
 
  function advanceStep(newStep) {
    step = newStep;
    if (step >= MOBILE_TUTORIAL_STEPS.length) { endTutorial(); return; }
 
    const s = MOBILE_TUTORIAL_STEPS[step];
 
    // Run any side-effect (open sidebar etc.) before showing the step
    if (s.action) s.action();
 
    // Update text
    stepCounter.textContent = `${step + 1} of ${MOBILE_TUTORIAL_STEPS.length}`;
    title.innerHTML = s.title;
    body.innerHTML  = s.body;
    nextBtn.textContent = step === MOBILE_TUTORIAL_STEPS.length - 1 ? "Let's go! 🚀" : "Next →";
 
    // Dots
    dots.innerHTML = "";
    MOBILE_TUTORIAL_STEPS.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "mts-dot" + (i === step ? " mts-dot--active" : "");
      dots.appendChild(dot);
    });
 
    // Coach mark
    updateCoachMark(s.highlightId);
 
    // Slide sheet in
    sheet.classList.remove("mts-sheet--hidden");
    requestAnimationFrame(() => sheet.classList.add("mts-sheet--visible"));
  }
 
  function updateCoachMark(id) {
    coachMark.classList.remove("mts-coach--visible");
 
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
 
    // Only highlight if actually visible in viewport
    const rect = target.getBoundingClientRect();
    const inView = rect.width > 0 && rect.height > 0 &&
                   rect.top  >= 0 && rect.top  <= window.innerHeight &&
                   rect.left >= 0 && rect.left <= window.innerWidth;
    if (!inView) return;
 
    const PAD = 6;
    coachMark.style.left   = (rect.left   - PAD) + "px";
    coachMark.style.top    = (rect.top    - PAD + window.scrollY) + "px";
    coachMark.style.width  = (rect.width  + PAD * 2) + "px";
    coachMark.style.height = (rect.height + PAD * 2) + "px";
 
    requestAnimationFrame(() => coachMark.classList.add("mts-coach--visible"));
  }
 
  function endTutorial() {
    localStorage.setItem(TUTORIAL_KEY, "1");
    sheet.classList.remove("mts-sheet--visible");
    sheet.classList.add("mts-sheet--hidden");
    coachMark.classList.remove("mts-coach--visible");
    setTimeout(() => { sheet.remove(); coachMark.remove(); }, 280);
  }
}