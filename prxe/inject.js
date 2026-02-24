// prxe/inject.js

(function () {
  function base64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function encodeUrl(url) {
    return "/p/" + base64urlEncode(url);
  }

  function proxify(url) {
    try {
      const abs = new URL(url, document.baseURI).href;
      return encodeUrl(abs);
    } catch {
      return url;
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      let url = typeof input === "string" ? input : input.url;
      if (/^https?:\/\//i.test(url) || url.startsWith("/")) {
        const proxied = proxify(url);
        if (typeof input === "string") input = proxied;
        else input = new Request(proxied, input);
      }
    } catch {}
    return origFetch.call(this, input, init);
  };

  const OrigXHR = window.XMLHttpRequest;
  function ProxiedXHR() {
    const xhr = new OrigXHR();
    const origOpen = xhr.open;
    xhr.open = function (method, url, async, user, pass) {
      try {
        if (/^https?:\/\//i.test(url) || url.startsWith("/")) {
          url = proxify(url);
        }
      } catch {}
      return origOpen.call(this, method, url, async, user, pass);
    };
    return xhr;
  }
  ProxiedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = ProxiedXHR;

  window.WebSocket = function () {
    throw new Error("WebSocket not supported through this proxy");
  };
})();
