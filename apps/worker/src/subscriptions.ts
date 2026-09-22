import { and, eq } from "drizzle-orm";
import { calendars, externalSubscriptions, items } from "@calendar/db/schema";
import { icsToItems, itemFieldsSchema } from "@calendar/domain";
import { db } from "./db";

function searchText(value: { title: string; description: string; location: string }) {
  return [value.title, value.description, value.location].filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
}

export async function refreshDueSubscriptions(): Promise<number> {
  const now = new Date(); const subscriptions = (await db.select().from(externalSubscriptions).where(eq(externalSubscriptions.enabled, true)))
    .filter((subscription) => !subscription.lastFetchedAt || now.getTime() - subscription.lastFetchedAt.getTime() >= subscription.refreshMinutes * 60000);
  let refreshed = 0;
  for (const subscription of subscriptions) {
    try {
      let calendarId = subscription.calendarId;
      if (!calendarId) {
        const [calendar] = await db.insert(calendars).values({ workspaceId: subscription.workspaceId, name: subscription.name, color: subscription.color, kind: "subscription" }).returning();
        calendarId = calendar?.id ?? null;
        if (calendarId) await db.update(externalSubscriptions).set({ calendarId }).where(eq(externalSubscriptions.id, subscription.id));
      }
      if (!calendarId) continue;
      const response = await fetch(subscription.url, { headers: { ...(subscription.etag ? { "If-None-Match": subscription.etag } : {}), ...(subscription.lastModified ? { "If-Modified-Since": subscription.lastModified } : {}) } });
      if (response.status === 304) { await db.update(externalSubscriptions).set({ lastFetchedAt: now, lastError: null }).where(eq(externalSubscriptions.id, subscription.id)); continue; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = icsToItems(await response.text());
      await db.delete(items).where(and(eq(items.workspaceId, subscription.workspaceId), eq(items.calendarId, calendarId)));
      for (const item of parsed) {
        const valid = itemFieldsSchema.parse({ ...item, calendarId });
        await db.insert(items).values({ workspaceId: subscription.workspaceId, calendarId, kind: valid.kind, title: valid.title, description: valid.description, location: valid.location,
          startAt: valid.startAt ? new Date(valid.startAt) : null, endAt: valid.endAt ? new Date(valid.endAt) : null, dueAt: valid.dueAt ? new Date(valid.dueAt) : null,
          isAllDay: valid.isAllDay, timezone: valid.timezone, priority: valid.priority, status: valid.status, recurrence: valid.recurrence ?? null, searchText: searchText(valid) });
      }
      await db.update(externalSubscriptions).set({ etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), lastFetchedAt: now, lastError: null, updatedAt: now }).where(eq(externalSubscriptions.id, subscription.id));
      refreshed += 1;
    } catch (error) {
      await db.update(externalSubscriptions).set({ lastFetchedAt: now, lastError: error instanceof Error ? error.message : "刷新失败", updatedAt: now }).where(eq(externalSubscriptions.id, subscription.id));
    }
  }
  return refreshed;
}