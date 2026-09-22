import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { calendars, items } from "@calendar/db/schema";
import { csvToItems, icsToItems, itemInputSchema, itemsToCsv, itemsToIcs, type PortableItem } from "@calendar/domain";
import { db } from "../context";
import { requireAuth, type AppEnv } from "../middleware";
import { loadItems, loadTags, replaceItemTags, replaceReminderRules, searchableText } from "../services/items";

export const interchangeRoute = new Hono<AppEnv>();
interchangeRoute.use("*", requireAuth);

async function defaultCalendar(workspaceId: string) {
  const [existing] = await db.select().from(calendars).where(eq(calendars.workspaceId, workspaceId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(calendars).values({ workspaceId, name: "我的日历" }).returning();
  if (!created) throw new Error("无法创建默认日历");
  return created;
}

async function importPortable(workspaceId: string, portable: PortableItem[]) {
  const calendar = await defaultCalendar(workspaceId); const imported: string[] = []; const errors: Array<{ index: number; message: string }> = [];
  for (let index = 0; index < portable.length; index += 1) {
    try {
      const parsed = itemInputSchema.parse({ ...portable[index], calendarId: calendar.id });
      const duplicate = parsed.startAt ? await db.select({ id: items.id }).from(items).where(and(eq(items.workspaceId, workspaceId), eq(items.title, parsed.title), eq(items.startAt, new Date(parsed.startAt)))).limit(1) : [];
      if (duplicate.length > 0) continue;
      const [created] = await db.insert(items).values({ workspaceId, calendarId: calendar.id, parentId: parsed.parentId ?? null, kind: parsed.kind,
        title: parsed.title, description: parsed.description, location: parsed.location, startAt: parsed.startAt ? new Date(parsed.startAt) : null,
        endAt: parsed.endAt ? new Date(parsed.endAt) : null, dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null, isAllDay: parsed.isAllDay,
        timezone: parsed.timezone, priority: parsed.priority, status: parsed.status, completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null, autoRollover: parsed.autoRollover, showInTimetable: parsed.showInTimetable, courseStartDate: parsed.courseStartDate ?? null, courseEndDate: parsed.courseEndDate ?? null,
        courseSlots: parsed.courseSlots,
        timetableColor: parsed.timetableColor,
        recurrence: parsed.recurrence ?? null, searchText: searchableText(parsed) }).returning();
      if (created) { await replaceItemTags(db, created.id, parsed.tagIds); await replaceReminderRules(db, created.id, parsed.reminders); imported.push(created.id); }
    } catch (error) { errors.push({ index, message: error instanceof Error ? error.message : "导入失败" }); }
  }
  return { importedCount: imported.length, skippedCount: portable.length - imported.length - errors.length, errors };
}

interchangeRoute.get("/export", async (c) => {
  const auth = c.get("auth"); const format = c.req.query("format") ?? "json";
  const values = await loadItems(db, auth.workspaceId); const tagValues = await loadTags(db, auth.workspaceId);
  const tagNames = new Map(tagValues.map((tag) => [tag.id, tag.name]));
  if (format === "ics") return new Response(itemsToIcs(values, tagNames), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment; filename=calendar.ics" } });
  if (format === "csv") return new Response(itemsToCsv(values), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=calendar.csv" } });
  return new Response(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: values, tags: tagValues }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=calendar.json" } });
});

interchangeRoute.post("/import", async (c) => {
  const auth = c.get("auth"); const contentType = c.req.header("content-type") ?? "";
  let portable: PortableItem[] = [];
  if (contentType.includes("multipart/form-data")) {
    const file = (await c.req.formData()).get("file");
    if (!(file instanceof File)) return c.json({ error: "FILE_REQUIRED" }, 400);
    const text = await file.text();
    if (file.name.endsWith(".ics")) portable = icsToItems(text);
    else if (file.name.endsWith(".csv")) portable = csvToItems(text);
    else { const json = JSON.parse(text) as { items?: PortableItem[] }; portable = Array.isArray(json.items) ? json.items : []; }
  } else {
    const json = await c.req.json() as { items?: PortableItem[] } | PortableItem[];
    portable = Array.isArray(json) ? json : json.items ?? [];
  }
  return c.json(await importPortable(auth.workspaceId, portable));
});
