import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@calendar/db";
import { changeLog, itemTags, items, recurrenceExceptions, reminderRules, tags } from "@calendar/db/schema";
import type { ExpandedItem, Item, ItemInput, RecurrenceException, Tag } from "@calendar/domain";

type ItemRow = typeof items.$inferSelect;
type TagRow = typeof tags.$inferSelect;
type RuleRow = typeof reminderRules.$inferSelect;
type ExceptionRow = typeof recurrenceExceptions.$inferSelect;

export function searchableText(input: Pick<ItemInput, "title" | "description" | "location">): string {
  return [input.title, input.description, input.location].filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
}

export function rowToItem(row: ItemRow, tagIds: string[], rules: RuleRow[], exceptions: ExceptionRow[]): ExpandedItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    calendarId: row.calendarId,
    parentId: row.parentId,
    kind: row.kind as Item["kind"],
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    priority: row.priority as Item["priority"],
    status: row.status as Item["status"],
    completedAt: row.completedAt?.toISOString() ?? null,
    autoRollover: row.autoRollover,
    showInTimetable: row.showInTimetable,
    courseStartDate: row.courseStartDate,
    courseEndDate: row.courseEndDate,
    courseSlots: row.courseSlots,
    timetableColor: row.timetableColor,
    recurrence: row.recurrence ?? null,
    tagIds,
    reminders: rules.map((rule) => ({
      id: rule.id,
      trigger: rule.trigger as Item["reminders"][number]["trigger"],
      offsetMinutes: rule.offsetMinutes as Item["reminders"][number]["offsetMinutes"],
      channels: rule.channels as Item["reminders"][number]["channels"],
      repeatEveryMinutes: rule.repeatEveryMinutes,
      enabled: rule.enabled
    })),
    version: row.version,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    recurrenceExceptions: exceptions.map((exception) => ({
      id: exception.id,
      itemId: exception.itemId,
      occurrenceKey: exception.occurrenceKey,
      action: exception.action as RecurrenceException["action"],
      override: exception.override ?? null
    }))
  };
}

export async function loadItems(db: Database, workspaceId: string, includeDeleted = false): Promise<ExpandedItem[]> {
  const conditions = [eq(items.workspaceId, workspaceId)];
  if (!includeDeleted) conditions.push(isNull(items.deletedAt));
  const rows = await db.select().from(items).where(and(...conditions));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [tagLinks, allRules, allExceptions] = await Promise.all([
    db.select().from(itemTags).where(inArray(itemTags.itemId, ids)),
    db.select().from(reminderRules).where(inArray(reminderRules.itemId, ids)),
    db.select().from(recurrenceExceptions).where(inArray(recurrenceExceptions.itemId, ids))
  ]);
  const tagsByItem = new Map<string, string[]>();
  for (const link of tagLinks) tagsByItem.set(link.itemId, [...(tagsByItem.get(link.itemId) ?? []), link.tagId]);
  const rulesByItem = new Map<string, RuleRow[]>();
  for (const rule of allRules) rulesByItem.set(rule.itemId, [...(rulesByItem.get(rule.itemId) ?? []), rule]);
  const exceptionsByItem = new Map<string, ExceptionRow[]>();
  for (const exception of allExceptions) exceptionsByItem.set(exception.itemId, [...(exceptionsByItem.get(exception.itemId) ?? []), exception]);
  return rows.map((row) => rowToItem(row, tagsByItem.get(row.id) ?? [], rulesByItem.get(row.id) ?? [], exceptionsByItem.get(row.id) ?? []));
}

export async function loadTags(db: Database, workspaceId: string): Promise<Tag[]> {
  const rows = await db.select().from(tags).where(eq(tags.workspaceId, workspaceId));
  return rows.map((row: TagRow) => ({ id: row.id, name: row.name, color: row.color }));
}

export async function replaceItemTags(db: Database, itemId: string, tagIds: string[]): Promise<void> {
  await db.delete(itemTags).where(eq(itemTags.itemId, itemId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) await db.insert(itemTags).values(unique.map((tagId) => ({ itemId, tagId })));
}

export async function replaceReminderRules(db: Database, itemId: string, reminders: ItemInput["reminders"]): Promise<void> {
  await db.delete(reminderRules).where(eq(reminderRules.itemId, itemId));
  if (reminders.length === 0) return;
  await db.insert(reminderRules).values(reminders.map((reminder) => ({
    itemId,
    trigger: reminder.trigger,
    offsetMinutes: reminder.offsetMinutes,
    channels: reminder.channels,
    repeatEveryMinutes: reminder.repeatEveryMinutes ?? 5,
    enabled: reminder.enabled
  })));
}

export async function writeChange(db: Database, workspaceId: string, entity: string, entityId: string, operation: string, version: number, payload: Record<string, unknown>): Promise<void> {
  await db.insert(changeLog).values({ workspaceId, entity, entityId, operation, version, payload });
}
