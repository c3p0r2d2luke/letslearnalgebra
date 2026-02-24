(() => {
  const PREFIX = "/prxe/";

  const rewrite = url => {
    if (!url) return url;
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    if (url.startsWith(PREFIX)) return url;
    if (url.startsWith("http")) return PREFIX + encodeURIComponent(url);
    return url;
  };

  const origFetch = window.fetch;
  window.fetch = (...args) => {
    args[0] = rewrite(args[0]);
    return origFetch(...args);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    return origOpen.call(this, m, rewrite(u));
  };

  document.querySelectorAll("a[href]").forEach(a => {
    a.href = rewrite(a.href);
  });

  document.querySelectorAll("form[action]").forEach(f => {
    f.action = rewrite(f.action);
  });
})();