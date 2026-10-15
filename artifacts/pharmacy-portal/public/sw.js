/*
 * MobiCare notifications that drop down even when the app is closed.
 *
 * This worker only shows notifications: it never caches pages or answers
 * requests, so it cannot serve a stale app. The patient app has its own
 * copy (mobicare-gateway/public/sw.js); keep the two in step.
 */
// The patient site serves the icon at the root of the same address.
const ICON = "/icon-192.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  const title = message.title || "MobiCare";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message.body || "",
      icon: ICON,
      badge: ICON,
      tag: message.tag,
      renotify: Boolean(message.tag),
      data: { url: message.url || "/pharmacy-portal/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/pharmacy-portal/notifications", self.location.origin);
  // Only open pages on this site.
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname.startsWith("/pharmacy-portal"));
      if (open) return open.focus().then((w) => w.navigate(url.href)).catch(() => self.clients.openWindow(url.href));
      return self.clients.openWindow(url.href);
    }),
  );
});
