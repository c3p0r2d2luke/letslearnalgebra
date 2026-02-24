// prxe/uv-encode.js

const UV_PREFIX = "/p/";

function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return decodeURIComponent(escape(atob(str)));
}

export function encodeUrl(url) {
  return UV_PREFIX + base64urlEncode(url);
}

export function decodePath(path) {
  const parts = path.split("/");
  const encoded = parts[parts.length - 1];
  if (!encoded) return null;
  return base64urlDecode(encoded);
}

export { UV_PREFIX };
