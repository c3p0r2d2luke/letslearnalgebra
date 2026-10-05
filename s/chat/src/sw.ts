interface WorkerFetchEvent extends Event {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface PushNotificationData {
  important?: boolean;
  mention?: boolean;
  url?: string;
  body?: string;
  title?: string;
}

interface WorkerPushEvent extends Event {
  data?: { json(): PushNotificationData };
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerNotificationClickEvent extends Event {
  notification: Notification & { data?: { url?: string } };
  action: string;
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerClient {
  url: string;
  focus?(): Promise<unknown>;
}

const worker = self as unknown as {
  registration: {
    scope: string;
    showNotification(title: string, options: NotificationOptions): Promise<void>;
  };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WorkerClient[]>;
    openWindow(url: string): Promise<WorkerClient | null>;
  };
  addEventListener(type: "fetch", listener: (event: WorkerFetchEvent) => void): void;
  addEventListener(type: "push", listener: (event: WorkerPushEvent) => void): void;
  addEventListener(type: "notificationclick", listener: (event: WorkerNotificationClickEvent) => void): void;
};

// ── Network logging to admin panel ─────────────────────────────────────────
const bc = new BroadcastChannel("sw-network-log");
const defaultChatUrl = new URL("index.html", worker.registration.scope).href;
const chatIconUrl = new URL("logo.png", worker.registration.scope).href;

worker.addEventListener("fetch", event => {
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
worker.addEventListener("push", event => {
  const data = event.data?.json() || {};
  const isImportant = data.important === true;
  const isMention = data.mention === true;
  const targetUrl = data.url || defaultChatUrl;

  const options = {
    body: data.body,
    icon: chatIconUrl,
    badge: chatIconUrl,
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
    worker.registration.showNotification(String(data.title || "Chat notification"), options)
  );
});

// ── Notification click ──────────────────────────────────────────────────────
worker.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || defaultChatUrl;

  if (event.action === "open" || !event.action) {
    event.waitUntil(
      worker.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
        for (const client of windowClients) {
          if ("focus" in client && client.url.startsWith(worker.registration.scope)) {
            return client.focus();
          }
        }
        return worker.clients.openWindow(targetUrl);
      })
    );
  }
});