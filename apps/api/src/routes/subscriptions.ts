import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { appSettings, calendars, externalSubscriptions, items } from "@calendar/db/schema";
import { icsToItems, itemInputSchema, itemsToIcs, type PortableItem } from "@calendar/domain";
import { config } from "../config";
import { db } from "../context";
import { blockDemoFeature, requireAuth, type AppEnv } from "../middleware";
import { loadItems, loadTags, replaceItemTags, replaceReminderRules, searchableText } from "../services/items";

export const subscriptionsRoute = new Hono<AppEnv>();
subscriptionsRoute.use("*", requireAuth, blockDemoFeature("subscriptions"));
export const publicIcsRoute = new Hono();

async function refreshSubscription(subscriptionId: string, workspaceId: string) {
  const [subscription] = await db.select().from(externalSubscriptions).where(and(eq(externalSubscriptions.id, subscriptionId), eq(externalSubscriptions.workspaceId, workspaceId))).limit(1);
  if (!subscription || !subscription.enabled) return { notModified: false, imported: 0 };
  let calendarId = subscription.calendarId;
  if (!calendarId) {
    const [calendar] = await db.insert(calendars).values({ workspaceId, name: subscription.name, color: subscription.color, kind: "subscription" }).returning();
    calendarId = calendar?.id ?? null;
    if (calendarId) await db.update(externalSubscriptions).set({ calendarId }).where(eq(externalSubscriptions.id, subscription.id));
  }
  if (!calendarId) throw new Error("无法创建订阅日历");
  const response = await fetch(subscription.url, { headers: { ...(subscription.etag ? { "If-None-Match": subscription.etag } : {}), ...(subscription.lastModified ? { "If-Modified-Since": subscription.lastModified } : {}) } });
  if (response.status === 304) return { notModified: true, imported: 0 };
  if (!response.ok) throw new Error(`订阅源返回 ${response.status}`);
  const portable: PortableItem[] = icsToItems(await response.text());
  await db.delete(items).where(and(eq(items.workspaceId, workspaceId), eq(items.calendarId, calendarId)));
  let imported = 0;
  for (const value of portable) {
    const parsed = itemInputSchema.parse({ ...value, calendarId });
    const [created] = await db.insert(items).values({ workspaceId, calendarId, kind: parsed.kind, title: parsed.title, description: parsed.description, location: parsed.location, startAt: parsed.startAt ? new Date(parsed.startAt) : null, endAt: parsed.endAt ? new Date(parsed.endAt) : null, dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null, isAllDay: parsed.isAllDay, timezone: parsed.timezone, priority: parsed.priority, status: parsed.status, completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null, autoRollover: parsed.autoRollover, showInTimetable: parsed.showInTimetable, courseStartDate: parsed.courseStartDate ?? null, courseEndDate: parsed.courseEndDate ?? null, courseSlots: parsed.courseSlots, timetableColor: parsed.timetableColor, recurrence: parsed.recurrence ?? null, searchText: searchableText(parsed) }).returning();
    if (created) { imported += 1; await replaceItemTags(db, created.id, parsed.tagIds); await replaceReminderRules(db, created.id, parsed.reminders); }
  }
  await db.update(externalSubscriptions).set({ etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), lastFetchedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(externalSubscriptions.id, subscription.id));
  return { notModified: false, imported };
}

subscriptionsRoute.get("/", async (c) => {
  const values = await db.select().from(externalSubscriptions).where(eq(externalSubscriptions.workspaceId, c.get("auth").workspaceId));
  return c.json({ subscriptions: values });
});

subscriptionsRoute.post("/", async (c) => {
  const input = z.object({ name: z.string().trim().min(1).max(120), url: z.string().url(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0ea5e9"), refreshMinutes: z.number().int().min(15).max(1440).default(15) }).parse(await c.req.json());
  const auth = c.get("auth");
  const [calendar] = await db.insert(calendars).values({ workspaceId: auth.workspaceId, name: input.name, color: input.color, kind: "subscription" }).returning();
  const [subscription] = await db.insert(externalSubscriptions).values({ ...input, workspaceId: auth.workspaceId, calendarId: calendar?.id ?? null }).returning();
  if (!subscription) return c.json({ error: "CREATE_FAILED" }, 500);
  return c.json({ subscription }, 201);
});

subscriptionsRoute.post("/:id/refresh", async (c) => {
  try { return c.json(await refreshSubscription(c.req.param("id"), c.get("auth").workspaceId)); }
  catch (error) { const message = error instanceof Error ? error.message : "同步失败"; await db.update(externalSubscriptions).set({ lastError: message, lastFetchedAt: new Date() }).where(eq(externalSubscriptions.id, c.req.param("id"))); return c.json({ error: "REFRESH_FAILED", message }, 502); }
});

subscriptionsRoute.delete("/:id", async (c) => {
  const auth = c.get("auth"); const [subscription] = await db.select().from(externalSubscriptions).where(and(eq(externalSubscriptions.id, c.req.param("id")), eq(externalSubscriptions.workspaceId, auth.workspaceId))).limit(1);
  if (!subscription) return c.json({ error: "NOT_FOUND" }, 404);
  if (subscription.calendarId) await db.delete(items).where(and(eq(items.workspaceId, auth.workspaceId), eq(items.calendarId, subscription.calendarId)));
  await db.delete(externalSubscriptions).where(eq(externalSubscriptions.id, subscription.id));
  if (subscription.calendarId) await db.delete(calendars).where(eq(calendars.id, subscription.calendarId));
  return c.json({ deleted: true });
});

publicIcsRoute.get("/:token", async (c) => {
  if (config.DEMO_MODE) return c.json({ error: "DEMO_FEATURE_DISABLED", message: "体验模式暂不支持公开订阅源" }, 403);
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.icsToken, c.req.param("token"))).limit(1);
  if (!settings) return c.json({ error: "NOT_FOUND" }, 404);
  const [values, tagValues] = await Promise.all([loadItems(db, settings.workspaceId), loadTags(db, settings.workspaceId)]);
  return new Response(itemsToIcs(values, new Map(tagValues.map((tag) => [tag.id, tag.name]))), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
});
