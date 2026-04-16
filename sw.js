/* global self, clients */

// Handle incoming push events
self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  const isImportant = data.important === true;
  const isMention = data.mention === true;
  const targetUrl = data.url || "/chatwithteachers";

  const options = {
    body: data.body,
    icon: "/logo.png",
    badge: "/logo.png",
    // Keep interaction requirement for mentions/important
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

// Handle notification click
self.addEventListener("notificationclick", event => {
  event.notification.close();
  
  const targetUrl = event.notification?.data?.url || "/chatwithteachers";
  
  // If the user clicked a specific action (like "Open Chat")
  if (event.action === "open" || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
        // 1. Try to focus an existing tab
        for (const client of windowClients) {
          // Check if the client is our app (handles query params too)
          if ("focus" in client && client.url.includes("/chatwithteachers")) {
            return client.focus();
          }
        }
        
        // 2. If no tab exists, open a new one
        return clients.openWindow(targetUrl);
      })
    );
  }
});

// Optional: Handle background fetch or other events if needed later