import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import {
  appSettings,
  calendars,
  items,
  recurrenceExceptions,
} from "@calendar/db/schema";
import {
  courseSlotSchema,
  expandItems,
  findConflicts,
  occurrenceToTimeRange,
  itemInputSchema,
  prioritySchema,
  type ExpandedItem,
  type Item,
  type ItemInput,
} from "@calendar/domain";
import { db } from "../context";
import { requireAuth, type AppEnv } from "../middleware";
import {
  loadItems,
  loadTags,
  replaceItemTags,
  replaceReminderRules,
  searchableText,
  writeChange,
} from "../services/items";
import {
  getRolloverSuggestions,
  resolveItemOutcome,
} from "../services/resolution";
import { timetableSemesterStarts } from "../services/timetables";

export const itemsRoute = new Hono<AppEnv>();
itemsRoute.use("*", requireAuth);

async function getSemesterStartDate(workspaceId: string): Promise<Date | null> {
  const [settings] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.workspaceId, workspaceId))
    .limit(1);
  return settings?.semesterStartDate
    ? new Date(`${settings.semesterStartDate}T12:00:00`)
    : null;
}
async function ensureDefaultCalendar(workspaceId: string) {
  const [existing] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.workspaceId, workspaceId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(calendars)
    .values({ workspaceId, name: "我的日历", color: "#f97316" })
    .returning();
  if (!created) throw new Error("无法创建默认日历");
  return created;
}

function itemValues(input: ItemInput, workspaceId: string) {
  return {
    workspaceId,
    calendarId: input.calendarId ?? null,
    parentId: input.parentId ?? null,
    kind: input.kind,
    title: input.title,
    description: input.description,
    location: input.location,
    startAt: input.startAt ? new Date(input.startAt) : null,
    endAt: input.endAt ? new Date(input.endAt) : null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    isAllDay: input.isAllDay,
    timezone: input.timezone,
    priority: input.priority,
    status: input.status,
    completedAt: input.completedAt ? new Date(input.completedAt) : null,
    autoRollover: input.autoRollover,
    showInTimetable: input.showInTimetable,
    timetableId: input.timetableId ?? null,
    courseStartDate: input.courseStartDate ?? null,
    courseEndDate: input.courseEndDate ?? null,
    courseSlots: input.courseSlots,
    timetableColor: input.timetableColor,
    recurrence: input.recurrence ?? null,
    searchText: searchableText(input),
    updatedAt: new Date(),
  };
}

function candidateItem(
  input: ItemInput,
  workspaceId: string,
  id: string = randomUUID(),
): ExpandedItem {
  const now = new Date().toISOString();
  return {
    ...input,
    id,
    workspaceId,
    calendarId: input.calendarId ?? null,
    parentId: input.parentId ?? null,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    dueAt: input.dueAt ?? null,
    completedAt: input.completedAt ?? null,
    autoRollover: input.autoRollover,
    showInTimetable: input.showInTimetable,
    timetableId: input.timetableId ?? null,
    courseStartDate: input.courseStartDate ?? null,
    courseEndDate: input.courseEndDate ?? null,
    recurrence: input.recurrence ?? null,
    tagIds: input.tagIds,
    courseSlots: input.courseSlots,
    timetableColor: input.timetableColor,
    reminders: input.reminders,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

async function detectConflicts(workspaceId: string, candidate: ExpandedItem) {
  if (!candidate.startAt) return [];
  const all = await loadItems(db, workspaceId);
  const start = new Date(candidate.startAt);
  const duration = candidate.endAt
    ? new Date(candidate.endAt).getTime() - start.getTime()
    : 3600000;
  const rangeStart = new Date(start.getTime() - 366 * 86400000);
  const rangeEnd = new Date(
    start.getTime() + Math.max(duration, 86400000) + 366 * 86400000,
  );
  const semesterStartDate = await getSemesterStartDate(workspaceId);
  const semesterStarts = await timetableSemesterStarts(workspaceId);
  const target = expandItems(
    [candidate],
    rangeStart,
    rangeEnd,
    semesterStartDate,
    semesterStarts,
  );
  const existing = expandItems(
    all.filter((item) => item.id !== candidate.id),
    rangeStart,
    rangeEnd,
    semesterStartDate,
    semesterStarts,
  );
  const seen = new Set<string>();
  return target
    .flatMap((occurrence) =>
      findConflicts(
        occurrenceToTimeRange(occurrence),
        existing.map(occurrenceToTimeRange),
      ),
    )
    .filter((conflict) => {
      const key = `${conflict.candidate.id}:${conflict.overlapStart.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20)
    .map((conflict) => ({
      id: conflict.candidate.id,
      title:
        all.find((item) => item.id === conflict.candidate.id)?.title ??
        "重叠日程",
      startAt: conflict.overlapStart.toISOString(),
      endAt: conflict.overlapEnd.toISOString(),
    }));
}

const parseJsonError = (error: unknown) =>
  error instanceof ZodError
    ? { error: "VALIDATION_ERROR", details: error.flatten() }
    : {
        error: "INVALID_REQUEST",
        message: error instanceof Error ? error.message : "请求解析失败",
      };

itemsRoute.get("/", async (c) => {
  const auth = c.get("auth");
  const query = c.req.query("q")?.toLowerCase();
  let values = await loadItems(
    db,
    auth.workspaceId,
    c.req.query("includeDeleted") === "true",
  );
  if (query)
    values = values.filter((item) =>
      `${item.title} ${item.description} ${item.location}`
        .toLowerCase()
        .includes(query),
    );
  const kind = c.req.query("kind");
  const status = c.req.query("status");
  const priority = c.req.query("priority");
  if (kind) values = values.filter((item) => item.kind === kind);
  if (status) values = values.filter((item) => item.status === status);
  if (priority) values = values.filter((item) => item.priority === priority);
  return c.json({ items: values });
});

itemsRoute.get("/occurrences", async (c) => {
  const auth = c.get("auth");
  const from = new Date(c.req.query("from") ?? new Date().toISOString());
  const to = new Date(
    c.req.query("to") ?? new Date(from.getTime() + 30 * 86400000).toISOString(),
  );
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
    return c.json({ error: "INVALID_RANGE" }, 400);
  const occurrences = expandItems(
    await loadItems(db, auth.workspaceId),
    from,
    to,
    await getSemesterStartDate(auth.workspaceId),
    await timetableSemesterStarts(auth.workspaceId),
  ).map((occurrence) => ({
    id: occurrence.id,
    occurrenceKey: occurrence.occurrenceKey,
    itemId: occurrence.itemId,
    title: occurrence.item.title,
    description: occurrence.item.description,
    location: occurrence.item.location,
    startAt: occurrence.start.toISOString(),
    endAt: occurrence.end.toISOString(),
    isAllDay: occurrence.allDay,
    kind: occurrence.item.kind,
    priority: occurrence.item.priority,
    status: occurrence.item.status,
    tagIds: occurrence.item.tagIds,
    recurrence: occurrence.item.recurrence,
    overridden: occurrence.overridden,
  }));
  return c.json({ occurrences });
});

const bulkActionSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(["status", "delete", "priority", "tags", "postpone"]),
    status: z.enum(["completed", "partial", "cancelled"]).optional(),
    priority: prioritySchema.optional(),
    addTagIds: z.array(z.string().uuid()).max(100).optional(),
    removeTagIds: z.array(z.string().uuid()).max(100).optional(),
    days: z.number().int().min(1).max(365).optional(),
    occurrenceKey: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "status" && !value.status)
      ctx.addIssue({ code: "custom", path: ["status"], message: "请选择状态" });
    if (value.action === "priority" && !value.priority)
      ctx.addIssue({
        code: "custom",
        path: ["priority"],
        message: "请选择优先级",
      });
    if (
      value.action === "tags" &&
      (value.addTagIds?.length ?? 0) + (value.removeTagIds?.length ?? 0) === 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["addTagIds"],
        message: "请选择要添加或移除的标签",
      });
    if (value.action === "postpone" && !value.days)
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message: "请选择顺延天数",
      });
  });

function currentOccurrenceKey(
  item: ExpandedItem,
  semesterStartDate: Date | null,
  semesterStarts: ReadonlyMap<string, Date | null>,
): string | null {
  if (!item.recurrence) return null;
  const now = new Date();
  const anchor = item.startAt
    ? new Date(item.startAt)
    : item.dueAt
      ? new Date(item.dueAt)
      : now;
  const rangeStart = new Date(
    Math.min(now.getTime(), anchor.getTime()) - 86400000,
  );
  const rangeEnd = new Date(
    Math.max(now.getTime(), anchor.getTime()) + 31 * 86400000,
  );
  const occurrences = expandItems(
    [item],
    rangeStart,
    rangeEnd,
    semesterStartDate,
    semesterStarts,
  ).sort((left, right) => left.start.getTime() - right.start.getTime());
  return (
    occurrences.find(
      (occurrence) => occurrence.start.getTime() >= now.getTime() - 86400000,
    )?.occurrenceKey ??
    occurrences[0]?.occurrenceKey ??
    null
  );
}

function shiftedDate(value: string | null, days: number): Date | null {
  return value ? new Date(new Date(value).getTime() + days * 86400000) : null;
}

itemsRoute.post("/bulk", async (c) => {
  try {
    const auth = c.get("auth");
    const input = bulkActionSchema.parse(await c.req.json());
    const ids = [...new Set(input.ids)];
    const allItems = await loadItems(db, auth.workspaceId, true);
    const byId = new Map(allItems.map((item) => [item.id, item]));
    const semesterStartDate = await getSemesterStartDate(auth.workspaceId);
    const updated: Item[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const errors: Array<{ id: string; message: string }> = [];

    for (const id of ids) {
      const item = byId.get(id);
      if (!item) {
        skipped.push({ id, reason: "NOT_FOUND" });
        continue;
      }
      if (item.status === "deleted" || item.deletedAt) {
        skipped.push({ id, reason: "DELETED" });
        continue;
      }
      try {
        if (input.action === "status") {
          let occurrenceKey = input.occurrenceKey ?? null;
          if (item.recurrence && !occurrenceKey)
            occurrenceKey = currentOccurrenceKey(item, semesterStartDate, await timetableSemesterStarts(auth.workspaceId));
          if (item.recurrence && !occurrenceKey) {
            skipped.push({ id, reason: "NO_CURRENT_OCCURRENCE" });
            continue;
          }
          const resolved = await resolveItemOutcome(auth.workspaceId, {
            itemId: id,
            occurrenceKey,
            outcome: input.status!,
          });
          if (!resolved) skipped.push({ id, reason: "NOT_FOUND" });
          else updated.push(resolved);
          continue;
        }

        if (input.action === "delete") {
          const [deleted] = await db
            .update(items)
            .set({
              deletedAt: new Date(),
              status: "deleted",
              updatedAt: new Date(),
              version: sql`${items.version} + 1`,
            })
            .where(
              and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)),
            )
            .returning();
          if (!deleted) {
            skipped.push({ id, reason: "NOT_FOUND" });
            continue;
          }
          await writeChange(
            db,
            auth.workspaceId,
            "item",
            id,
            "delete",
            deleted.version,
            { id },
          );
          updated.push(
            (await loadItems(db, auth.workspaceId, true)).find(
              (value) => value.id === id,
            )!,
          );
          continue;
        }

        if (input.action === "priority") {
          const [changed] = await db
            .update(items)
            .set({
              priority: input.priority!,
              updatedAt: new Date(),
              version: sql`${items.version} + 1`,
            })
            .where(
              and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)),
            )
            .returning();
          if (!changed) {
            skipped.push({ id, reason: "NOT_FOUND" });
            continue;
          }
          await writeChange(
            db,
            auth.workspaceId,
            "item",
            id,
            "update",
            changed.version,
            { priority: changed.priority },
          );
          updated.push(
            (await loadItems(db, auth.workspaceId, true)).find(
              (value) => value.id === id,
            )!,
          );
          continue;
        }

        if (input.action === "tags") {
          const available = new Set(
            (await loadTags(db, auth.workspaceId)).map((tag) => tag.id),
          );
          const additions = (input.addTagIds ?? []).filter((tagId) =>
            available.has(tagId),
          );
          const removals = new Set(
            (input.removeTagIds ?? []).filter((tagId) => available.has(tagId)),
          );
          const nextTagIds = [
            ...new Set([...item.tagIds, ...additions]),
          ].filter((tagId) => !removals.has(tagId));
          const [changed] = await db
            .update(items)
            .set({ updatedAt: new Date(), version: sql`${items.version} + 1` })
            .where(
              and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)),
            )
            .returning();
          if (!changed) {
            skipped.push({ id, reason: "NOT_FOUND" });
            continue;
          }
          await replaceItemTags(db, id, nextTagIds);
          await writeChange(
            db,
            auth.workspaceId,
            "item",
            id,
            "update",
            changed.version,
            { tagIds: nextTagIds },
          );
          updated.push(
            (await loadItems(db, auth.workspaceId, true)).find(
              (value) => value.id === id,
            )!,
          );
          continue;
        }

        if (item.recurrence) {
          skipped.push({ id, reason: "RECURRING_ITEM_REQUIRES_OCCURRENCE" });
          continue;
        }
        if (!item.startAt && !item.dueAt) {
          skipped.push({ id, reason: "NO_SCHEDULE" });
          continue;
        }
        const nextStartAt = shiftedDate(item.startAt ?? null, input.days!);
        const nextEndAt = shiftedDate(item.endAt ?? null, input.days!);
        const nextDueAt = shiftedDate(item.dueAt ?? null, input.days!);
        const [changed] = await db
          .update(items)
          .set({
            startAt: nextStartAt,
            endAt: nextEndAt,
            dueAt: nextDueAt,
            updatedAt: new Date(),
            version: sql`${items.version} + 1`,
          })
          .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
          .returning();
        if (!changed) {
          skipped.push({ id, reason: "NOT_FOUND" });
          continue;
        }
        await writeChange(
          db,
          auth.workspaceId,
          "item",
          id,
          "update",
          changed.version,
          { postponedDays: input.days },
        );
        updated.push(
          (await loadItems(db, auth.workspaceId, true)).find(
            (value) => value.id === id,
          )!,
        );
      } catch (error) {
        errors.push({
          id,
          message: error instanceof Error ? error.message : "处理失败",
        });
      }
    }

    return c.json({ updated, skipped, errors });
  } catch (error) {
    return c.json(parseJsonError(error), 400);
  }
});
itemsRoute.get("/:id", async (c) => {
  const auth = c.get("auth");
  const all = await loadItems(db, auth.workspaceId, true);
  const item = all.find((value) => value.id === c.req.param("id"));
  return item ? c.json({ item }) : c.json({ error: "NOT_FOUND" }, 404);
});
itemsRoute.post("/", async (c) => {
  try {
    const auth = c.get("auth");
    const raw = (await c.req.json()) as Record<string, unknown>;
    const parsedId =
      typeof raw.id === "string" ? z.string().uuid().safeParse(raw.id) : null;
    const input = itemInputSchema.parse(raw);
    const calendar = input.calendarId
      ? { id: input.calendarId }
      : await ensureDefaultCalendar(auth.workspaceId);
    const candidate = candidateItem(
      { ...input, calendarId: calendar.id },
      auth.workspaceId,
      parsedId?.success ? parsedId.data : randomUUID(),
    );
    const conflicts = await detectConflicts(auth.workspaceId, candidate);
    if (conflicts.length > 0 && c.req.query("force") !== "true")
      return c.json({ error: "CONFLICT", conflicts }, 409);
    const [created] = await db
      .insert(items)
      .values({
        id: parsedId?.success ? parsedId.data : undefined,
        ...itemValues({ ...input, calendarId: calendar.id }, auth.workspaceId),
      })
      .returning();
    if (!created) throw new Error("创建日程失败");
    await replaceItemTags(db, created.id, input.tagIds);
    await replaceReminderRules(db, created.id, input.reminders);
    await writeChange(
      db,
      auth.workspaceId,
      "item",
      created.id,
      "create",
      created.version,
      { id: created.id },
    );
    const item = (await loadItems(db, auth.workspaceId, true)).find(
      (value) => value.id === created.id,
    );
    return c.json({ item, conflicts }, 201);
  } catch (error) {
    return c.json(parseJsonError(error), 400);
  }
});

itemsRoute.patch("/:id", async (c) => {
  try {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const existing = (await loadItems(db, auth.workspaceId, true)).find(
      (value) => value.id === id,
    );
    if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
    const raw = (await c.req.json()) as Record<string, unknown>;
    const baseVersion =
      typeof raw.baseVersion === "number" ? raw.baseVersion : undefined;
    const changedFields = Object.keys(raw).filter(
      (key) => key !== "baseVersion",
    );
    const statusOnlyPatch = changedFields.every(
      (key) => key === "status" || key === "completedAt",
    );
    if (
      baseVersion !== undefined &&
      baseVersion !== existing.version &&
      !statusOnlyPatch
    )
      return c.json({ error: "VERSION_CONFLICT", current: existing }, 409);
    const input = itemInputSchema.parse({
      ...existing,
      ...raw,
      id: existing.id,
      workspaceId: existing.workspaceId,
    });
    const candidate = candidateItem(input, auth.workspaceId, id);
    const conflicts = await detectConflicts(auth.workspaceId, candidate);
    if (conflicts.length > 0 && c.req.query("force") !== "true")
      return c.json({ error: "CONFLICT", conflicts }, 409);
    const [updated] = await db
      .update(items)
      .set({
        ...itemValues(input, auth.workspaceId),
        version: sql`${items.version} + 1`,
      })
      .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
      .returning();
    if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
    await replaceItemTags(db, id, input.tagIds);
    await replaceReminderRules(db, id, input.reminders);
    await writeChange(
      db,
      auth.workspaceId,
      "item",
      id,
      "update",
      updated.version,
      { id },
    );
    const item = (await loadItems(db, auth.workspaceId, true)).find(
      (value) => value.id === id,
    );
    return c.json({ item, conflicts });
  } catch (error) {
    return c.json(parseJsonError(error), 400);
  }
});
itemsRoute.post("/:id/course-slots", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = (await loadItems(db, auth.workspaceId, true)).find(
    (value) => value.id === id,
  );
  if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
  const input = z
    .object({
      weekday: z.number().int().min(0).max(6),
      startTime: z.string(),
      endTime: z.string(),
      weekParity: z.enum(["all", "odd", "even"]),
    })
    .parse(await c.req.json());
  const slot = { ...input, id: randomUUID() };
  const [updated] = await db
    .update(items)
    .set({
      courseSlots: [...existing.courseSlots, slot],
      updatedAt: new Date(),
      version: sql`${items.version} + 1`,
    })
    .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
    .returning();
  if (!updated) return c.json({ error: "UPDATE_FAILED" }, 500);
  await writeChange(
    db,
    auth.workspaceId,
    "item",
    id,
    "update",
    updated.version,
    { courseSlot: slot.id },
  );
  return c.json(
    {
      item: (await loadItems(db, auth.workspaceId, true)).find(
        (value) => value.id === id,
      ),
      slot,
    },
    201,
  );
});

itemsRoute.patch("/:id/course-slots/:slotId", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const slotId = c.req.param("slotId");
  const existing = (await loadItems(db, auth.workspaceId, true)).find(
    (value) => value.id === id,
  );
  if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
  const slotIndex = existing.courseSlots.findIndex(
    (slot) => slot.id === slotId,
  );
  if (slotIndex < 0) return c.json({ error: "SLOT_NOT_FOUND" }, 404);
  const patch = z
    .object({
      weekday: z.number().int().min(0).max(6),
      startTime: z.string(),
      endTime: z.string(),
      weekParity: z.enum(["all", "odd", "even"]),
    })
    .partial()
    .parse(await c.req.json());
  const nextSlot = { ...existing.courseSlots[slotIndex]!, ...patch };
  const courseSlots = existing.courseSlots.map((slot, index) =>
    index === slotIndex ? nextSlot : slot,
  );
  const [updated] = await db
    .update(items)
    .set({
      courseSlots,
      updatedAt: new Date(),
      version: sql`${items.version} + 1`,
    })
    .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
    .returning();
  if (!updated) return c.json({ error: "UPDATE_FAILED" }, 500);
  await writeChange(
    db,
    auth.workspaceId,
    "item",
    id,
    "update",
    updated.version,
    { courseSlot: slotId },
  );
  return c.json({
    item: (await loadItems(db, auth.workspaceId, true)).find(
      (value) => value.id === id,
    ),
    slot: nextSlot,
  });
});

itemsRoute.delete("/:id/course-slots/:slotId", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const slotId = c.req.param("slotId");
  const existing = (await loadItems(db, auth.workspaceId, true)).find(
    (value) => value.id === id,
  );
  if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
  const courseSlots = existing.courseSlots.filter((slot) => slot.id !== slotId);
  if (courseSlots.length === existing.courseSlots.length)
    return c.json({ error: "SLOT_NOT_FOUND" }, 404);
  if (courseSlots.length === 0) {
    const [deleted] = await db
      .update(items)
      .set({
        courseSlots: [],
        status: "deleted",
        deletedAt: new Date(),
        updatedAt: new Date(),
        version: sql`${items.version} + 1`,
      })
      .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
      .returning();
    return c.json({ deleted: Boolean(deleted), item: null });
  }
  const [updated] = await db
    .update(items)
    .set({
      courseSlots,
      updatedAt: new Date(),
      version: sql`${items.version} + 1`,
    })
    .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
    .returning();
  return c.json({
    deleted: false,
    item: updated
      ? (await loadItems(db, auth.workspaceId, true)).find(
          (value) => value.id === id,
        )
      : null,
  });
});
itemsRoute.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const [existing] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
    .limit(1);
  if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
  if (existing.status === "deleted" || existing.deletedAt)
    return c.json({ deletedAt: existing.deletedAt, alreadyDeleted: true });
  const [deleted] = await db
    .update(items)
    .set({
      deletedAt: new Date(),
      status: "deleted",
      updatedAt: new Date(),
      version: sql`${items.version} + 1`,
    })
    .where(and(eq(items.id, id), eq(items.workspaceId, auth.workspaceId)))
    .returning();
  if (!deleted) return c.json({ error: "DELETE_FAILED" }, 500);
  await writeChange(
    db,
    auth.workspaceId,
    "item",
    id,
    "delete",
    deleted.version,
    { id },
  );
  return c.json({ deletedAt: deleted.deletedAt });
});

itemsRoute.post("/:id/restore", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const [restored] = await db
    .update(items)
    .set({
      deletedAt: null,
      status: "active",
      updatedAt: new Date(),
      version: sql`${items.version} + 1`,
    })
    .where(
      and(
        eq(items.id, id),
        eq(items.workspaceId, auth.workspaceId),
        eq(items.status, "deleted"),
      ),
    )
    .returning();
  if (!restored) return c.json({ error: "NOT_FOUND" }, 404);
  await writeChange(
    db,
    auth.workspaceId,
    "item",
    id,
    "restore",
    restored.version,
    { id },
  );
  return c.json({ restored: true });
});

itemsRoute.post("/:id/copy", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const source = (await loadItems(db, auth.workspaceId, true)).find(
    (value) => value.id === id,
  );
  if (!source) return c.json({ error: "NOT_FOUND" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    startAt?: string;
    endAt?: string;
  };
  const duration =
    source.startAt && source.endAt
      ? new Date(source.endAt).getTime() - new Date(source.startAt).getTime()
      : 3600000;
  const startAt =
    body.startAt ??
    (source.startAt
      ? new Date(new Date(source.startAt).getTime() + 86400000).toISOString()
      : null);
  const input = {
    ...source,
    id: undefined,
    title: `${source.title}（副本）`,
    startAt,
    endAt: startAt
      ? new Date(new Date(startAt).getTime() + duration).toISOString()
      : source.endAt,
    status: "active" as const,
    completedAt: null,
  };
  const [created] = await db
    .insert(items)
    .values(itemValues(input, auth.workspaceId))
    .returning();
  if (!created) return c.json({ error: "COPY_FAILED" }, 500);
  await replaceItemTags(db, created.id, source.tagIds);
  await replaceReminderRules(db, created.id, source.reminders);
  await writeChange(
    db,
    auth.workspaceId,
    "item",
    created.id,
    "create",
    created.version,
    { copiedFrom: id },
  );
  const item = (await loadItems(db, auth.workspaceId, true)).find(
    (value) => value.id === created.id,
  );
  return c.json({ item }, 201);
});

itemsRoute.put("/:id/exceptions/:occurrenceKey", async (c) => {
  const auth = c.get("auth");
  const itemId = c.req.param("id");
  const occurrenceKey = decodeURIComponent(c.req.param("occurrenceKey"));
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.workspaceId, auth.workspaceId)))
    .limit(1);
  if (!item) return c.json({ error: "NOT_FOUND" }, 404);
  const body = (await c.req.json()) as {
    action?: "cancelled" | "override";
    override?: Partial<ItemInput>;
  };
  const action = body.action ?? "override";
  const [exception] = await db
    .insert(recurrenceExceptions)
    .values({ itemId, occurrenceKey, action, override: body.override ?? null })
    .onConflictDoUpdate({
      target: [recurrenceExceptions.itemId, recurrenceExceptions.occurrenceKey],
      set: { action, override: body.override ?? null, updatedAt: new Date() },
    })
    .returning();
  return c.json({ exception });
});

itemsRoute.get("/:id/rollover-suggestions", async (c) => {
  const suggestions = await getRolloverSuggestions(
    c.get("auth").workspaceId,
    c.req.param("id"),
    c.req.query("occurrenceKey"),
  );
  return c.json({ suggestions });
});

itemsRoute.post("/:id/resolve", async (c) => {
  const input = z
    .object({
      occurrenceKey: z.string().nullable().optional(),
      outcome: z.enum(["completed", "partial", "postponed", "cancelled"]),
      startAt: z.string().datetime({ offset: true }).nullable().optional(),
      endAt: z.string().datetime({ offset: true }).nullable().optional(),
      dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .parse(await c.req.json());
  const item = await resolveItemOutcome(c.get("auth").workspaceId, {
    itemId: c.req.param("id"),
    ...input,
  });
  if (!item) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ item });
});
