/* global self, clients*/
self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  const isImportant = data.important === true;
  const isMention = data.mention === true;

  const options = {
    body: data.serverName ? `${data.serverName} #${data.channelName}: ${data.body}` : data.body,
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
    data: data, // Pass the data for use in click handler
    actions: isMention ? [
      { action: "jump", title: "Jump to Server" },
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
  const data = event.notification.data;
  if (event.action === "jump" && data.serverSlug && data.channelId) {
    event.waitUntil(
      clients.openWindow(`/?server=${data.serverSlug}&channel=${data.channelId}`)
    );
  } else if (event.action === "open" || !event.action) {
    event.waitUntil(
      clients.openWindow("/")
    );
  }
});