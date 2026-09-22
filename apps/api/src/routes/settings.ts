import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { appSettings } from "@calendar/db/schema";
import { config } from "../config";
import { db } from "../context";
import { requireAuth, type AppEnv } from "../middleware";

export const settingsRoute = new Hono<AppEnv>();
settingsRoute.use("*", requireAuth);

async function ensureSettings(workspaceId: string) {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.workspaceId, workspaceId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettings).values({ workspaceId, icsToken: randomBytes(32).toString("base64url") }).returning();
  if (!created) throw new Error("无法创建设置");
  return created;
}

settingsRoute.get("/", async (c) => {
  const value = await ensureSettings(c.get("auth").workspaceId);
  return c.json({ settings: { ...value, vapidPublicKey: config.VAPID_PUBLIC_KEY ?? null, icsUrl: `${config.BETTER_AUTH_URL}/api/v1/ics/${value.icsToken}` } });
});

settingsRoute.patch("/", async (c) => {
  const input = z.object({ theme: z.enum(["system", "light", "dark"]).optional(), defaultView: z.enum(["responsive", "day", "week", "month", "agenda"]).optional(), defaultReminderMinutes: z.number().int().optional(), weekStartsOn: z.number().int().min(0).max(6).optional(), reminderSoundEnabled: z.boolean().optional(), semesterStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(await c.req.json());
  const workspaceId = c.get("auth").workspaceId; await ensureSettings(workspaceId);
  const [updated] = await db.update(appSettings).set({ ...input, updatedAt: new Date() }).where(eq(appSettings.workspaceId, workspaceId)).returning();
  return c.json({ settings: updated });
});

settingsRoute.post("/rotate-ics-token", async (c) => {
  const workspaceId = c.get("auth").workspaceId; await ensureSettings(workspaceId);
  const token = randomBytes(32).toString("base64url");
  await db.update(appSettings).set({ icsToken: token, updatedAt: new Date() }).where(eq(appSettings.workspaceId, workspaceId));
  return c.json({ token });
});