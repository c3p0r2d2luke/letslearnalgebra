// ad.js
(function(){
  if (window.adManager) return;
  const AD_CONTAINER_ID = 'container-19e398a645ca98bacde8f1841236d284';
  const AD_SCRIPT_TAG = '<script async="async" data-cfasync="false" src="https://pl30726175.effectivecpmnetwork.com/19e398a645ca98bacde8f1841236d284/invoke.js"></' + 'script>';
  const AD_DIV_HTML = `<div id="${AD_CONTAINER_ID}"></div>`;

  function randThreshold(){ return 10 + Math.floor(Math.random()*6); } // 10-15 inclusive

  function createAdElement() {
    const li = document.createElement('li');
    li.className = 'sponsored-ad';

    const wrapper = document.createElement('div');
    wrapper.className = 'ad-wrapper';
    wrapper.innerHTML = `\
      <div class="ad-label">SPONSORED</div>\
      <div class="ad-content">${AD_SCRIPT_TAG}${AD_DIV_HTML}</div>`;

    li.appendChild(wrapper);
    return li;
  }

  function ensureStyles() {
    if (document.getElementById('ad-manager-styles')) return;
    const style = document.createElement('style');
    style.id = 'ad-manager-styles';
    style.textContent = `
.sponsored-ad { list-style: none; margin: 8px 0; }
.ad-wrapper { background: rgba(255, 250, 200, 0.9); border-left: 4px solid #ffd54f; padding: 8px; border-radius:6px; }
.ad-label { font-size: 11px; font-weight: 700; color: #8a6500; margin-bottom: 6px; }
.ad-content { min-height: 60px; }
`;
    document.head.appendChild(style);
  }

  const manager = {
    _count: 0,
    _threshold: randThreshold(),
    _lastInsertedAt: 0,
    maybeInsertAd() {
      try {
        ensureStyles();
        this._count += 1;
        // Don't spam multiple ads in quick succession
        if (Date.now() - this._lastInsertedAt < 30_000) return; // 30s cooldown
        if (this._count < this._threshold) return;
        this._count = 0;
        this._threshold = randThreshold();
        this.insertAd();
      } catch (e) { console.debug('adManager error', e); }
    },
    insertAd() {
      const messagesList = document.getElementById('messagesList') || document.querySelector('.messages-list') || document.querySelector('ul.messages');
      if (!messagesList) return;
      const adEl = createAdElement();
      // Insert above the last message to appear in the flow
      const lastChild = messagesList.lastElementChild;
      if (lastChild) messagesList.insertBefore(adEl, lastChild.nextSibling);
      else messagesList.appendChild(adEl);
      this._lastInsertedAt = Date.now();
    }
  };

  window.adManager = manager;
})();
