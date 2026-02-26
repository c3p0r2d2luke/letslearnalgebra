self.addEventListener("push", event => {
  const data = event.data?.json() || {};

  const isImportant = data.important === true;

  const options = {
    body: data.body,
    icon: "/icon.png",
    badge: "/badge.png",
    requireInteraction: isImportant, // stays on screen if important
    vibrate: isImportant ? [200, 100, 200, 100, 400] : [100],
    silent: !isImportant, // loud vs soft
    tag: isImportant ? "important" : "message"
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});