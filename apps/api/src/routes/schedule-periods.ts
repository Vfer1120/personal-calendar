import { Hono } from "hono";
import { requireAuth, type AppEnv } from "../middleware";
import { ensureDefaultTimetable, listTimetablePeriods, replaceTimetablePeriods } from "../services/timetables";

export const schedulePeriodsRoute = new Hono<AppEnv>();
schedulePeriodsRoute.use("*", requireAuth);

schedulePeriodsRoute.get("/", async (c) => {
  const timetable = await ensureDefaultTimetable(c.get("auth").workspaceId);
  return c.json({ periods: await listTimetablePeriods(c.get("auth").workspaceId, timetable.id) ?? [] });
});

schedulePeriodsRoute.put("/", async (c) => {
  const timetable = await ensureDefaultTimetable(c.get("auth").workspaceId);
  const periods = await replaceTimetablePeriods(c.get("auth").workspaceId, timetable.id, await c.req.json());
  return c.json({ periods: periods ?? [] });
});