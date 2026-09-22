import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { changeLog, itemTags, items, reminderRules, syncMutations, tags } from "@calendar/db/schema";
import { itemInputSchema, syncPushSchema, type ItemInput } from "@calendar/domain";
import { db } from "../context";
import { requireAuth, type AppEnv } from "../middleware";
import { loadItems, loadTags, searchableText } from "../services/items";

export const syncRoute = new Hono<AppEnv>();
syncRoute.use("*", requireAuth);

function itemDbValues(input: ItemInput, workspaceId: string) {
  return { workspaceId, calendarId: input.calendarId ?? null, parentId: input.parentId ?? null, kind: input.kind,
    title: input.title, description: input.description, location: input.location,
    startAt: input.startAt ? new Date(input.startAt) : null, endAt: input.endAt ? new Date(input.endAt) : null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null, isAllDay: input.isAllDay, timezone: input.timezone,
    priority: input.priority, status: input.status, completedAt: input.completedAt ? new Date(input.completedAt) : null, autoRollover: input.autoRollover, showInTimetable: input.showInTimetable, courseStartDate: input.courseStartDate ?? null, courseEndDate: input.courseEndDate ?? null,
    courseSlots: input.courseSlots,
    timetableColor: input.timetableColor,
    recurrence: input.recurrence ?? null, searchText: searchableText(input), updatedAt: new Date() };
}

async function replaceAssociations(itemId: string, input: ItemInput) {
  await db.delete(itemTags).where(eq(itemTags.itemId, itemId));
  if (input.tagIds.length > 0) await db.insert(itemTags).values([...new Set(input.tagIds)].map((tagId) => ({ itemId, tagId })));
  await db.delete(reminderRules).where(eq(reminderRules.itemId, itemId));
  if (input.reminders.length > 0) await db.insert(reminderRules).values(input.reminders.map((rule) => ({ itemId, trigger: rule.trigger, offsetMinutes: rule.offsetMinutes, channels: rule.channels, repeatEveryMinutes: rule.repeatEveryMinutes ?? 5, enabled: rule.enabled })));
}

syncRoute.post("/push", async (c) => {
  const auth = c.get("auth"); const body = syncPushSchema.parse(await c.req.json());
  const applied: Array<{ clientMutationId: string; entityId: string; version?: number }> = [];
  const conflicts: Array<{ clientMutationId: string; entityId: string; fields: string[]; current?: unknown }> = [];
  let highestCursor = 0;
  for (const mutation of body.mutations) {
    const [previous] = await db.select().from(syncMutations).where(and(eq(syncMutations.workspaceId, auth.workspaceId), eq(syncMutations.clientMutationId, mutation.clientMutationId))).limit(1);
    if (previous) { if (previous.result) applied.push(previous.result as { clientMutationId: string; entityId: string; version?: number }); continue; }
    if (mutation.entity === "item") {
      const all = await loadItems(db, auth.workspaceId, true);
      const existing = all.find((item) => item.id === mutation.entityId);
      if (mutation.action === "delete") {
        const [deleted] = await db.update(items).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date(), version: sql`${items.version} + 1` })
          .where(and(eq(items.id, mutation.entityId), eq(items.workspaceId, auth.workspaceId))).returning();
        if (deleted) {
          const [change] = await db.insert(changeLog).values({ workspaceId: auth.workspaceId, entity: "item", entityId: deleted.id, operation: "delete", version: deleted.version, payload: { id: deleted.id } }).returning({ id: changeLog.id });
          highestCursor = Math.max(highestCursor, change?.id ?? 0);
          const result = { clientMutationId: mutation.clientMutationId, entityId: deleted.id, version: deleted.version };
          await db.insert(syncMutations).values({ workspaceId: auth.workspaceId, clientMutationId: mutation.clientMutationId, entity: mutation.entity, entityId: mutation.entityId, action: mutation.action, payload: mutation.fields, result });
          applied.push(result);
        }
        continue;
      }
      const staleFields = existing && mutation.baseVersion !== undefined && mutation.baseVersion !== existing.version
        ? Object.keys(mutation.fields).filter((field) => { const current = (existing as unknown as Record<string, unknown>)[field]; const incoming = mutation.fields[field]; return current !== incoming; })
        : [];
      if (staleFields.length > 0) {
        conflicts.push({ clientMutationId: mutation.clientMutationId, entityId: mutation.entityId, fields: staleFields, current: existing });
        continue;
      }
      const merged = itemInputSchema.parse(existing ? { ...existing, ...mutation.fields } : mutation.fields);
      if (mutation.action === "create" && !existing) {
        const [created] = await db.insert(items).values({ id: mutation.entityId, ...itemDbValues(merged, auth.workspaceId) }).returning();
        if (created) { await replaceAssociations(created.id, merged); const [change] = await db.insert(changeLog).values({ workspaceId: auth.workspaceId, entity: "item", entityId: created.id, operation: "create", version: created.version, payload: { id: created.id } }).returning({ id: changeLog.id }); highestCursor = Math.max(highestCursor, change?.id ?? 0); const result = { clientMutationId: mutation.clientMutationId, entityId: created.id, version: created.version }; await db.insert(syncMutations).values({ workspaceId: auth.workspaceId, clientMutationId: mutation.clientMutationId, entity: mutation.entity, entityId: mutation.entityId, action: mutation.action, payload: mutation.fields, result }); applied.push(result); }
      } else if (existing) {
        const [updated] = await db.update(items).set({ ...itemDbValues(merged, auth.workspaceId), version: sql`${items.version} + 1` }).where(and(eq(items.id, mutation.entityId), eq(items.workspaceId, auth.workspaceId))).returning();
        if (updated) { await replaceAssociations(updated.id, merged); const [change] = await db.insert(changeLog).values({ workspaceId: auth.workspaceId, entity: "item", entityId: updated.id, operation: mutation.action, version: updated.version, payload: { id: updated.id } }).returning({ id: changeLog.id }); highestCursor = Math.max(highestCursor, change?.id ?? 0); const result = { clientMutationId: mutation.clientMutationId, entityId: updated.id, version: updated.version }; await db.insert(syncMutations).values({ workspaceId: auth.workspaceId, clientMutationId: mutation.clientMutationId, entity: mutation.entity, entityId: mutation.entityId, action: mutation.action, payload: mutation.fields, result }); applied.push(result); }
      }
    }
    if (mutation.entity === "tag") {
      const name = String(mutation.fields.name ?? "标签"); const color = String(mutation.fields.color ?? "#64748b");
      const [tag] = mutation.action === "delete"
        ? await db.delete(tags).where(and(eq(tags.id, mutation.entityId), eq(tags.workspaceId, auth.workspaceId))).returning()
        : await db.insert(tags).values({ id: mutation.entityId, workspaceId: auth.workspaceId, name, color }).onConflictDoUpdate({ target: tags.id, set: { name, color, updatedAt: new Date() } }).returning();
      if (tag) { const [change] = await db.insert(changeLog).values({ workspaceId: auth.workspaceId, entity: "tag", entityId: tag.id, operation: mutation.action, version: 1, payload: mutation.fields }).returning({ id: changeLog.id }); highestCursor = Math.max(highestCursor, change?.id ?? 0); }
    }
  }
  const [cursorRow] = await db.select({ value: sql<number>`coalesce(max(${changeLog.id}), 0)` }).from(changeLog).where(eq(changeLog.workspaceId, auth.workspaceId));
  return c.json({ applied, conflicts, cursor: String(Math.max(highestCursor, cursorRow?.value ?? 0)) });
});

syncRoute.get("/pull", async (c) => {
  const auth = c.get("auth"); const cursor = Number(c.req.query("cursor") ?? 0) || 0;
  const changes = await db.select().from(changeLog).where(and(eq(changeLog.workspaceId, auth.workspaceId), gt(changeLog.id, cursor))).orderBy(changeLog.id).limit(500);
  const allItems = await loadItems(db, auth.workspaceId, true); const allTags = await loadTags(db, auth.workspaceId);
  const nextCursor = changes.length > 0 ? String(changes[changes.length - 1]?.id ?? cursor) : String(cursor);
  return c.json({ changes: changes.map((change) => ({ cursor: String(change.id), entity: change.entity, operation: change.operation, entityId: change.entityId,
    payload: change.entity === "item" ? allItems.find((item) => item.id === change.entityId) ?? null : allTags.find((tag) => tag.id === change.entityId) ?? change.payload })), cursor: nextCursor });
});
