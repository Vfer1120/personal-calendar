/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
import { StaleWhileRevalidate } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));
registerRoute(({ url }) => /\/api\/v1\/attachments\/.+\/content$/.test(url.pathname), new StaleWhileRevalidate({ cacheName: "attachment-cache" }));

self.addEventListener("push", (event) => {
  const fallback = { title: "日程提醒", body: "有一项日程需要处理", url: "/" };
  let payload = fallback;
  try { payload = { ...fallback, ...(event.data?.json() as Partial<typeof fallback>) }; } catch { payload = { ...fallback, body: event.data?.text() ?? fallback.body }; }
  event.waitUntil((async () => { const notificationDeliveryId = (payload as typeof fallback & { deliveryId?: string }).deliveryId; await self.registration.showNotification(payload.title, { body: payload.body, icon: "/pwa-192.png", badge: "/pwa-192.png", tag: notificationDeliveryId ?? payload.url, data: { url: payload.url }, requireInteraction: false, silent: false }); const deliveryId = (payload as typeof fallback & { deliveryId?: string }).deliveryId; const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); for (const client of clients) client.postMessage({ type: "reminder-push", deliveryId }); })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { await existing.focus(); if ("navigate" in existing) await existing.navigate(target); return; }
    await self.clients.openWindow(target);
  }));
});