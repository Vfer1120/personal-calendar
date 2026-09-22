import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { schedulePeriods } from "@calendar/db/schema";
import { DEFAULT_SCHEDULE_PERIODS, schedulePeriodListSchema } from "@calendar/domain";
import { db } from "../context";
import { requireAuth, type AppEnv } from "../middleware";

export const schedulePeriodsRoute = new Hono<AppEnv>();
schedulePeriodsRoute.use("*", requireAuth);

async function ensurePeriods(workspaceId: string) {
  const existing = await db.select().from(schedulePeriods).where(eq(schedulePeriods.workspaceId, workspaceId)).orderBy(schedulePeriods.sortOrder);
  if (existing.length > 0) return existing;
  const created = await db.insert(schedulePeriods).values(DEFAULT_SCHEDULE_PERIODS.map((period) => ({ ...period, workspaceId }))).returning();
  return created.sort((left, right) => left.sortOrder - right.sortOrder);
}

schedulePeriodsRoute.get("/", async (c) => c.json({ periods: await ensurePeriods(c.get("auth").workspaceId) }));

schedulePeriodsRoute.put("/", async (c) => {
  const input = schedulePeriodListSchema.parse(await c.req.json());
  const workspaceId = c.get("auth").workspaceId;
  const periods = await db.transaction(async (tx) => {
    await tx.delete(schedulePeriods).where(eq(schedulePeriods.workspaceId, workspaceId));
    return tx.insert(schedulePeriods).values(input.periods.map((period) => ({ workspaceId, name: period.name, startTime: period.startTime, endTime: period.endTime, sortOrder: period.sortOrder }))).returning();
  });
  return c.json({ periods: periods.sort((left, right) => left.sortOrder - right.sortOrder) });
});