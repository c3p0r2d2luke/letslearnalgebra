/* global self, clients*/
self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  const isImportant = data.important === true;
  const isMention = data.mention === true;

  const options = {
    body: data.body,
    icon: "/download (1).png",
    badge: isMention ? "/mention-badge.png" : "/badge.png", // Different badge for mentions
    requireInteraction: isImportant,
    vibrate: isMention 
      ? [200, 100, 200, 100, 200, 100, 400] // Longer vibration for mentions
      : isImportant 
        ? [200, 100, 200, 100, 400] 
        : [100],
    silent: !isImportant,
    tag: isMention ? "mention" : (isImportant ? "important" : "message"),
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
  if (event.action === "open" || !event.action) {
    event.waitUntil(
      clients.openWindow("/") // Opens your chat app
    );
  }
});