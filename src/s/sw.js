/* global self, clients */

// ── Network logging to admin panel ─────────────────────────────────────────
const bc = new BroadcastChannel("sw-network-log");

self.addEventListener("fetch", event => {
  const req = event.request;
  const start = Date.now();

  bc.postMessage({
    phase: "request",
    method: req.method,
    url: req.url,
    initiatorType: req.destination || "other",
    mode: req.mode,
    start
  });

  event.respondWith(
    fetch(req).then(res => {
      bc.postMessage({
        phase: "response",
        method: req.method,
        url: req.url,
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        ms: Date.now() - start,
        type: res.type,
        initiatorType: req.destination || "other",
        redirected: res.redirected
      });
      return res;
    }).catch(err => {
      bc.postMessage({
        phase: "error",
        method: req.method,
        url: req.url,
        error: err.message,
        ms: Date.now() - start
      });
      throw err;
    })
  );
});

// ── Push notifications ──────────────────────────────────────────────────────
self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  const isImportant = data.important === true;
  const isMention = data.mention === true;
  const targetUrl = data.url || "/chatwithteachers";

  const options = {
    body: data.body,
    icon: "/logo.png",
    badge: "/logo.png",
    requireInteraction: isMention || isImportant,
    vibrate: isMention
      ? [200, 100, 200, 100, 200, 100, 400]
      : isImportant
        ? [200, 100, 200, 100, 400]
        : [100],
    silent: false,
    tag: isMention ? "mention" : (isImportant ? "important" : "message"),
    data: { url: targetUrl },
    actions: isMention ? [
      { action: "open", title: "Open Chat" },
      { action: "dismiss", title: "Dismiss" }
    ] : []
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification click ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/chatwithteachers";

  if (event.action === "open" || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
        for (const client of windowClients) {
          if ("focus" in client && client.url.includes("/chatwithteachers")) {
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
    );
  }
});