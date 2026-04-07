/* global self, clients*/
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
      ? [200, 100, 200, 100, 200, 100, 400] // Longer vibration for mentions
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

// Handle notification click
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/chatwithteachers";
  if (event.action === "open" || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
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
