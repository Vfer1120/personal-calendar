import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AppEnv } from "../middleware";
import {
  createTimetable,
  deleteTimetable,
  listTimetablePeriods,
  listTimetables,
  replaceTimetablePeriods,
  updateTimetable
} from "../services/timetables";

export const timetablesRoute = new Hono<AppEnv>();
timetablesRoute.use("*", requireAuth);

const timetableInput = z.object({
  name: z.string().trim().min(1).max(30),
  semesterStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)
});

timetablesRoute.get("/", async (c) => c.json({ timetables: await listTimetables(c.get("auth").workspaceId) }));

timetablesRoute.post("/", async (c) => {
  const input = timetableInput.parse(await c.req.json());
  return c.json({ timetable: await createTimetable(c.get("auth").workspaceId, input) }, 201);
});

timetablesRoute.patch("/:id", async (c) => {
  const input = timetableInput.partial().extend({ sortOrder: z.number().int().min(0).max(99).optional() }).parse(await c.req.json());
  const timetable = await updateTimetable(c.get("auth").workspaceId, c.req.param("id"), input);
  return timetable ? c.json({ timetable }) : c.json({ error: "NOT_FOUND" }, 404);
});

timetablesRoute.delete("/:id", async (c) => {
  const result = await deleteTimetable(c.get("auth").workspaceId, c.req.param("id"));
  if (!result.deleted && result.courseCount > 0) return c.json({ error: "TIMETABLE_NOT_EMPTY", courseCount: result.courseCount, message: "该课表内仍有课程，请先移动或删除课程" }, 409);
  return result.deleted ? c.json({ deleted: true }) : c.json({ error: "NOT_FOUND" }, 404);
});

timetablesRoute.get("/:id/periods", async (c) => {
  const periods = await listTimetablePeriods(c.get("auth").workspaceId, c.req.param("id"));
  return periods ? c.json({ periods }) : c.json({ error: "NOT_FOUND" }, 404);
});

timetablesRoute.put("/:id/periods", async (c) => {
  const periods = await replaceTimetablePeriods(c.get("auth").workspaceId, c.req.param("id"), await c.req.json());
  return periods ? c.json({ periods }) : c.json({ error: "NOT_FOUND" }, 404);
});