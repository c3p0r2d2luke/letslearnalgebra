(function(){
  // Simple fetch wrapper that proxies requests to the Supabase host through a fetch proxy.
  // It rewrites any request whose hostname matches the Supabase project host to
  // https://lla.ipv64.net/proxy/fetch?url=<encoded original url>
  // Force proxy base to the required host
  const PROXY_BASE = window.__proxy_base || 'https://lla.ipv64.net/proxy/fetch?url=';
  const TARGET_HOST = 'qjajtkdchvapthnidtwj.supabase.co';
  if (window.__proxy_fetch_installed) return; window.__proxy_fetch_installed = true;
  const origFetch = window.fetch.bind(window);

  // small UI for non-admin debugging (visible banner)
  function ensureProxyDebugRoot() {
    if (document.getElementById('__proxy_debug')) return document.getElementById('__proxy_debug');
    const d = document.createElement('div');
    d.id = '__proxy_debug';
    d.style.position = 'fixed';
    d.style.right = '12px';
    d.style.top = '12px';
    d.style.zIndex = '100000';
    d.style.maxWidth = '420px';
    d.style.fontFamily = 'monospace';
    d.style.fontSize = '12px';
    document.body.appendChild(d);
    return d;
  }
  function showProxyBanner(msg, isError){
    try{
      const root = ensureProxyDebugRoot();
      const el = document.createElement('div');
      el.textContent = msg;
      el.style.background = isError ? 'rgba(255,110,110,0.95)' : 'rgba(40,44,52,0.95)';
      el.style.color = 'white';
      el.style.padding = '6px 10px';
      el.style.marginTop = '6px';
      el.style.borderRadius = '6px';
      el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
      el.style.maxHeight = '120px';
      el.style.overflow = 'auto';
      root.insertBefore(el, root.firstChild);
      // auto-remove after 10s
      setTimeout(()=>{ el.remove(); }, 10000);
    }catch(e){ console.debug('[proxy_fetch] showProxyBanner failed', e); }
  }

  window.fetch = async function(input, init) {
    try {
      let url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      // If Request object passed, capture method/headers/body from it
      let requestObj = null;
      if (input && typeof input === 'object' && input instanceof Request) {
        requestObj = input;
      }

      // Only rewrite if the URL hostname matches target and not already proxied
      try {
        const u = new URL(url, window.location.href);
        if (u.hostname === TARGET_HOST) {
          let proxied = PROXY_BASE + encodeURIComponent(u.toString());
          console.debug('[proxy_fetch] rewriting', u.toString(), '->', proxied);
          showProxyBanner('[proxy_fetch] rewriting ' + u.toString() + ' -> ' + proxied);

          // Build new init by carrying common properties through
          const newInit = Object.assign({}, init || {});

          // If the input was a Request, copy over its details
          if (requestObj) {
            newInit.method = requestObj.method;
            // copy headers from Request to plain object
            const hdrs = {};
            try { requestObj.headers.forEach((v,k)=> { hdrs[k] = v; }); } catch (e) {}
            newInit.headers = Object.assign({}, hdrs, newInit.headers || {});
            // copy common request options
            ['mode','credentials','cache','redirect','referrer','referrerPolicy','integrity','keepalive','signal'].forEach(k => {
              try { if (requestObj[k] !== undefined && newInit[k] === undefined) newInit[k] = requestObj[k]; } catch (e) {}
            });
            // copy body safely by cloning the request
            try {
              const cloned = requestObj.clone();
              const arr = await cloned.arrayBuffer().catch(() => null);
              if (arr && arr.byteLength !== 0) newInit.body = arr;
              else {
                const txt = await cloned.text().catch(() => null);
                if (txt) newInit.body = txt;
              }
            } catch (e) {
              // ignore body copy failures
            }
          }

          try {
            const res = await origFetch(proxied, newInit);
            // if res.status >=400 show banner
            if (!res.ok) {
              showProxyBanner('[proxy_fetch] proxied response ' + res.status + ' for ' + proxied, true);
            }
            return res;
          } catch (err) {
            showProxyBanner('[proxy_fetch] proxied fetch failed: ' + err.message, true);
            throw err;
          }
        }
      } catch (e) {
        // if URL parsing fails, fall back to original fetch
        console.warn('[proxy_fetch] URL parse failed, using original fetch', e);
        return await origFetch(input, init);
      }

      return await origFetch(input, init);
    } catch (err) {
      // Ensure errors are rethrown to preserve semantics
      throw err;
    }
  };
})();
