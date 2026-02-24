// prxe/client.js

function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeUrl(url) {
  return "/p/" + base64urlEncode(url);
}

window.prxeGo = function () {
  const input = document.getElementById("url");
  let url = input.value.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  document.getElementById("view").src = encodeUrl(url);
};
