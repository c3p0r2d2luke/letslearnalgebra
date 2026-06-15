(function(){
  // Deterministic interval: insert an ad after every AD_INTERVAL non-ad messages
  const AD_INTERVAL = 10;
  const messagesEl = () => document.querySelector('#messages');
  if (!messagesEl()) return;

  function isAdNode(li) {
    return !!(li && (li.classList && li.classList.contains('ad-message') || li.dataset && li.dataset.ad === '1'));
  }

  function countNonAdMessages() {
    const list = messagesEl();
    if (!list) return 0;
    return Array.from(list.children).filter(li => !isAdNode(li)).length;
  }

  function createAdElement() {
    const li = document.createElement('li');
    li.className = 'ad-message';
    li.dataset.ad = '1';
    li.style.alignItems = 'flex-start';
    li.innerHTML = `\
      <div class="avatar" aria-hidden="true">🔖</div>\
      <div style="flex:1;">\
        <div class="username">AD</div>\
        <div class="content ad-content"></div>\
      </div>\
    `;
    // Insert external ad script into the ad-content container
    const adContainer = li.querySelector('.ad-content');
    appendAdScript(adContainer);
    return li;
  }

  function appendAdScript(container) {
  if (!container) return;

  // Avoid duplicating the same proxied script
  const existing = container.querySelector('script[data-ad-proxy="1"]');
  if (existing) return;

  const s = document.createElement('script');
  s.async = true;
  s.referrerPolicy = 'no-referrer-when-downgrade';
  s.dataset.adProxy = '1';

  const base =
    "https://conventionalresponse.com/b.XVVCsBdeGmlE0/YWWmcg/eeGmP9LuQZjUglvklPYT/cbxiNRDYAIybMrTncMt/NNzDEK0RM/D_IlytMbQ-";

  const target =
    base +
    (base.includes("?") ? "&" : "?") +
    "_cb=" +
    Date.now() +
    Math.floor(Math.random() * 100000);

  s.src =
    "https://lla.ipv64.net/proxy/ad?url=" +
    encodeURIComponent(target);

  s.onerror = () => {
    console.error("Ad failed to load:", s.src);
  };

  container.appendChild(s);

  const fallback = document.createElement('div');
  fallback.className = 'ad-fallback';
  fallback.style.fontSize = '12px';
  fallback.style.color = 'var(--text-muted)';
  fallback.style.marginTop = '6px';
  fallback.textContent = 'Sponsored';

  container.appendChild(fallback);
}

  // Ensure any existing ad nodes have their script appended (fix blank ads)
  function ensureAdLoaded(adNode) {
    if (!isAdNode(adNode)) return;
    const adContainer = adNode.querySelector('.ad-content');
    if (!adContainer) return;
    appendAdScript(adContainer);
  }

  // Scan existing history and insert ads after every AD_INTERVAL non-ad messages
  function scanAndInsertAds() {
    const list = messagesEl();
    if (!list) return;
    let nonAdCount = 0;
    // Walk live DOM so inserted ads are visible to subsequent iterations
    let i = 0;
    while (i < list.children.length) {
      const node = list.children[i];
      if (isAdNode(node)) {
        // Ensure loaded for existing ad
        ensureAdLoaded(node);
        i++;
        continue;
      }
      nonAdCount++;
      if (nonAdCount % AD_INTERVAL === 0) {
        const next = node.nextSibling;
        if (isAdNode(next)) {
          ensureAdLoaded(next);
          i += 2; // skip over the ad
          continue;
        }
        const adEl = createAdElement();
        if (node.parentNode) node.parentNode.insertBefore(adEl, next);
        // after inserting, skip the newly inserted ad
        i += 2;
        continue;
      }
      i++;
    }
    // Ensure every ad has its script loaded
    Array.from(list.querySelectorAll('li')).filter(isAdNode).forEach(ensureAdLoaded);
  }

  // Try to insert ad at end if threshold reached
  function tryInsertAd() {
    const nonAdCount = countNonAdMessages();
    if (nonAdCount > 0 && nonAdCount % AD_INTERVAL === 0) {
      const list = messagesEl();
      if (!list) return;
      const last = list.lastElementChild;
      if (isAdNode(last)) return; // avoid consecutive ads
      const adEl = createAdElement();
      list.appendChild(adEl);
      // optional: keep scroll at bottom
      list.scrollTop = list.scrollHeight;
    }
  }

  function removeAllAds() {
    const list = messagesEl();
    if (!list) return 0;
    const ads = Array.from(list.querySelectorAll('li')).filter(isAdNode);
    ads.forEach(a => a.remove());
    return ads.length;
  }

  function listAds() {
    const list = messagesEl();
    if (!list) return [];
    return Array.from(list.querySelectorAll('li')).filter(isAdNode).map(li => ({ html: li.innerHTML }));
  }

  // Expose admin API
  window.adManager = {
    maybeInsertAd: tryInsertAd,
    scanAndInsertAds: scanAndInsertAds,
    forceInsertAd: function(){ const list = messagesEl(); if (!list) return; const adEl = createAdElement(); list.appendChild(adEl); },
    removeAllAds: removeAllAds,
    listAds: listAds,
    setInterval: function(min,max){ console.warn('setInterval is unsupported in deterministic mode. AD_INTERVAL is fixed at', AD_INTERVAL); }
  };

  // Observe new messages
  const obs = new MutationObserver((mutations)=>{
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes.length) {
        tryInsertAd();
        // debounce a history scan to ensure older blanks are fixed
        clearTimeout(window.__ad_scan_timeout);
        window.__ad_scan_timeout = setTimeout(()=>{ scanAndInsertAds(); }, 200);
        break;
      }
    }
  });

  const root = messagesEl();
  if (root) obs.observe(root, { childList: true, subtree: false });

  // initial pass
  setTimeout(()=>{ scanAndInsertAds(); }, 250);
})();
