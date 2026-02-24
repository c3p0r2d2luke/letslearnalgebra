(() => {
  const PREFIX = "/prxe/";

  const rewrite = url => {
    if (!url) return url;
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    if (url.startsWith(PREFIX)) return url;

    if (url.startsWith("http://") || url.startsWith("https://")) {
      return PREFIX + encodeURIComponent(url);
    }

    if (url.startsWith("/")) {
      return PREFIX + encodeURIComponent(location.origin + url);
    }

    return PREFIX + encodeURIComponent(new URL(url, location.href).href);
  };

  // ---- fetch ----
  const _fetch = window.fetch;
  window.fetch = (...args) => {
    args[0] = rewrite(args[0]);
    return _fetch(...args);
  };

  // ---- XHR ----
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    return _open.call(this, m, rewrite(u));
  };

  // ---- forms ----
  document.addEventListener("submit", e => {
    const f = e.target;
    if (f.action) f.action = rewrite(f.action);
  }, true);

  // ---- anchors ----
  document.addEventListener("click", e => {
    const a = e.target.closest("a");
    if (a && a.href) {
      a.href = rewrite(a.href);
      a.target = "iframe"; // ensure links open inside iframe
    }
  }, true);

  // ---- window.open ----
  const _openWin = window.open;
  window.open = (u, ...rest) => _openWin(rewrite(u), ...rest);

  // ---- location ----
  const loc = window.location;
  ["assign", "replace"].forEach(fn => {
    const orig = loc[fn].bind(loc);
    loc[fn] = u => orig(rewrite(u));
  });

  Object.defineProperty(window, "location", {
    get: () => loc,
    set: u => loc.assign(rewrite(u))
  });

  ["pushState", "replaceState"].forEach(fn => {
    const orig = history[fn];
    history[fn] = function (state, title, url) {
      if (url) url = rewrite(url);
      return orig.call(this, state, title, url);
    };
  });
})();