import { and, desc, eq, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { deliveries, items, pushSubscriptions, reminderRules } from "@calendar/db/schema";
import { config } from "../config";
import { db } from "../context";
import { blockDemoFeature, requireAuth, type AppEnv } from "../middleware";
import { publish } from "../events";

export const remindersRoute = new Hono<AppEnv>();
remindersRoute.use("*", requireAuth, blockDemoFeature("reminders"));

remindersRoute.get("/deliveries", async (c) => {
  const auth = c.get("auth"); const missed = c.req.query("missed") === "true";
  const rows = await db.select({ delivery: deliveries, item: items, rule: reminderRules }).from(deliveries).innerJoin(items, eq(items.id, deliveries.itemId)).leftJoin(reminderRules, eq(reminderRules.id, deliveries.ruleId))
    .where(and(eq(deliveries.workspaceId, auth.workspaceId), missed ? eq(deliveries.status, "missed") : or(and(eq(deliveries.status, "pending"), lte(deliveries.scheduledAt, new Date())), eq(deliveries.status, "delivered"))))
    .orderBy(desc(deliveries.scheduledAt)).limit(200);
  return c.json({ deliveries: rows.map((row) => ({ ...row.delivery, itemTitle: row.item.title, trigger: row.rule?.trigger ?? "before_start" })) });
});

remindersRoute.post("/deliveries/:id/ack", async (c) => {
  const auth = c.get("auth"); const now = new Date();
  const [updated] = await db.update(deliveries).set({ status: "acknowledged", acknowledgedAt: now, updatedAt: now })
    .where(and(eq(deliveries.id, c.req.param("id")), eq(deliveries.workspaceId, auth.workspaceId))).returning();
  if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
  publish(auth.workspaceId, { type: "delivery.acknowledged", deliveryId: updated.id });
  return c.json({ delivery: updated });
});

remindersRoute.post("/deliveries/:id/snooze", async (c) => {
  const input = z.object({ minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]) }).parse(await c.req.json());
  const auth = c.get("auth"); const now = new Date(); const scheduledAt = new Date(now.getTime() + input.minutes * 60000);
  const [updated] = await db.update(deliveries).set({ status: "pending", scheduledAt, snoozedUntil: scheduledAt, updatedAt: now, nextAttemptAt: null, deliveredAt: null, lastError: null, attempt: 0 })
    .where(and(eq(deliveries.id, c.req.param("id")), eq(deliveries.workspaceId, auth.workspaceId))).returning();
  if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ delivery: updated });
});

remindersRoute.post("/push-subscriptions", async (c) => {
  const input = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(await c.req.json());
  const auth = c.get("auth");
  const [subscription] = await db.insert(pushSubscriptions).values({ workspaceId: auth.workspaceId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: c.req.header("user-agent") ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: input.keys.p256dh, auth: input.keys.auth, lastSeenAt: new Date() } }).returning();
  return c.json({ subscription }, 201);
});

remindersRoute.get("/vapid-public-key", (c) => c.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null }));