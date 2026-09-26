/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
import { StaleWhileRevalidate } from "workbox-strategies";
import Dexie from "dexie";

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

async function flushScopedOutboxes() {
  if (!("indexedDB" in self) || typeof indexedDB.databases !== "function") return;
  const databases = await indexedDB.databases();
  for (const info of databases) {
    const name = info.name ?? "";
    if (!name.startsWith("personal-calendar:")) continue;
    const database = new Dexie(name);
    database.version(1).stores({ items: "id,startAt,updatedAt,status,kind", tags: "id", outbox: "++localId,entityId,clientMutationId", meta: "key" });
    try {
      await database.open();
      const entries = await database.table("outbox").orderBy("localId").limit(200).toArray() as Array<{ localId: number; clientMutationId: string; entity: string; action: string; entityId: string; baseVersion?: number; fields: Record<string, unknown>; createdAt: string }>;
      if (entries.length === 0) continue;
      const response = await fetch("/api/v1/sync/push", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: entries.map(({ localId, createdAt, ...mutation }) => mutation) })
      });
      if (!response.ok) continue;
      const result = await response.json() as { applied: Array<{ clientMutationId: string }>; conflicts: unknown[] };
      const applied = new Set(result.applied.map((entry) => entry.clientMutationId));
      await database.table("outbox").bulkDelete(entries.filter((entry) => applied.has(entry.clientMutationId)).map((entry) => entry.localId));
      if (result.conflicts.length > 0) await database.table("meta").put({ key: "sync-conflicts", value: result.conflicts });
    } catch {
      // Keep the outbox for the next background sync or app launch.
    } finally {
      database.close();
    }
  }
}

self.addEventListener("sync", (event) => {
  const syncEvent = event as Event & { tag?: string; waitUntil: (promise: Promise<unknown>) => void };
  if (syncEvent.tag === "calendar-outbox") syncEvent.waitUntil(flushScopedOutboxes());
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