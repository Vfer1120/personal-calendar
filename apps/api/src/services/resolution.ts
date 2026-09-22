import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { appSettings, deliveries, items, recurrenceExceptions, reminderRules } from "@calendar/db/schema";
import { expandItems, type ExpandedItem, type Item } from "@calendar/domain";
import { db } from "../context";
import { loadItems, writeChange } from "./items";

export type ResolutionOutcome = "completed" | "partial" | "postponed" | "cancelled";
export interface ResolutionInput { itemId: string; occurrenceKey?: string | null; outcome: ResolutionOutcome; startAt?: string | null; endAt?: string | null; dueAt?: string | null; }
export interface RolloverSuggestion { startAt: string | null; endAt: string | null; dueAt: string | null; label: string; }

function overlaps(start: Date, end: Date, otherStart: Date, otherEnd: Date): boolean {
  return start < otherEnd && end > otherStart;
}

function occurrenceFor(item: ExpandedItem, occurrenceKey?: string | null, semesterStartDate?: Date | null) {
  const start = item.startAt ? new Date(item.startAt) : item.dueAt ? new Date(item.dueAt) : new Date();
  const end = item.endAt ? new Date(item.endAt) : new Date(start.getTime() + 3600000);
  if (!item.recurrence || !occurrenceKey) return { start, end, key: item.id };
  const rangeStart = new Date(start.getTime() - 366 * 86400000);
  const rangeEnd = new Date(start.getTime() + 366 * 86400000);
  return expandItems([item], rangeStart, rangeEnd, semesterStartDate).find((value) => value.occurrenceKey === occurrenceKey) ?? { start, end, key: occurrenceKey };
}

function suggestionValue(item: ExpandedItem, start: Date, end: Date): RolloverSuggestion {
  if (item.startAt && item.endAt) return { startAt: start.toISOString(), endAt: end.toISOString(), dueAt: null, label: "同时间段" };
  if (item.startAt && item.dueAt) { const due = new Date(start.getTime() + (new Date(item.dueAt).getTime() - new Date(item.startAt).getTime())); return { startAt: start.toISOString(), endAt: null, dueAt: due.toISOString(), label: "同开始/截止时间" }; }
  if (item.dueAt) return { startAt: null, endAt: null, dueAt: start.toISOString(), label: "同日截止时间" };
  if (item.startAt) return { startAt: start.toISOString(), endAt: null, dueAt: null, label: "同日开始时间" };
  return { startAt: null, endAt: null, dueAt: end.toISOString(), label: "同时间段" };
}

export async function getRolloverSuggestions(workspaceId: string, itemId: string, occurrenceKey?: string | null): Promise<RolloverSuggestion[]> {
  const item = (await loadItems(db, workspaceId, true)).find((value) => value.id === itemId);
  if (!item) return [];
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.workspaceId, workspaceId)).limit(1);
  const semesterStartDate = settings?.semesterStartDate ? new Date(`${settings.semesterStartDate}T12:00:00`) : null;
  const occurrence = occurrenceFor(item, occurrenceKey, semesterStartDate);
  const duration = Math.max(30 * 60000, occurrence.end.getTime() - occurrence.start.getTime());
  const all = await loadItems(db, workspaceId);
  const others = expandItems(all.filter((value) => value.id !== item.id), new Date(occurrence.start.getTime() - 366 * 86400000), new Date(occurrence.start.getTime() + 14 * 86400000), semesterStartDate);
  const suggestions: RolloverSuggestion[] = [];
  const add = (start: Date) => { const end = new Date(start.getTime() + duration); if (!others.some((value) => overlaps(start, end, value.start, value.end))) { const value = suggestionValue(item, start, end); if (!suggestions.some((entry) => entry.startAt === value.startAt && entry.dueAt === value.dueAt)) suggestions.push(value); } };
  for (let offset = 1; offset <= 7 && suggestions.length < 3; offset += 1) { const start = new Date(occurrence.start); start.setDate(start.getDate() + offset); add(start); }
  for (let offset = 1; offset <= 7 && suggestions.length < 3; offset += 1) {
    const day = new Date(occurrence.start); day.setDate(day.getDate() + offset); day.setHours(8, 0, 0, 0);
    const limit = new Date(day); limit.setHours(22, 0, 0, 0);
    while (day <= limit && suggestions.length < 3) { add(new Date(day)); day.setMinutes(day.getMinutes() + 30); }
  }
  return suggestions.slice(0, 3);
}

async function acknowledgeEnd(itemId: string, occurrenceKey?: string | null): Promise<void> {
  const conditions = occurrenceKey ? and(eq(deliveries.itemId, itemId), eq(deliveries.occurrenceKey, occurrenceKey)) : eq(deliveries.itemId, itemId);
  await db.update(deliveries).set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() }).where(conditions);
}

export async function resolveItemOutcome(workspaceId: string, input: ResolutionInput): Promise<Item | null> {
  const existing = (await loadItems(db, workspaceId, true)).find((value) => value.id === input.itemId);
  if (!existing) return null;
  const override = input.outcome === "completed"
    ? { status: "completed" as const, completedAt: new Date().toISOString() }
    : input.outcome === "partial"
      ? { status: "partial" as const, completedAt: null }
      : input.outcome === "postponed"
        ? { startAt: input.startAt ?? existing.startAt, endAt: input.endAt ?? existing.endAt, dueAt: input.dueAt ?? existing.dueAt }
        : { status: "cancelled" as const, completedAt: null };
  const nextVersion = (existing.version ?? 1) + 1;
  if (existing.recurrence && input.occurrenceKey) {
    if (input.outcome === "cancelled") await db.insert(recurrenceExceptions).values({ itemId: input.itemId, occurrenceKey: input.occurrenceKey, action: "cancelled", override: null }).onConflictDoUpdate({ target: [recurrenceExceptions.itemId, recurrenceExceptions.occurrenceKey], set: { action: "cancelled", override: null, updatedAt: new Date() } });
    else await db.insert(recurrenceExceptions).values({ itemId: input.itemId, occurrenceKey: input.occurrenceKey, action: "override", override }).onConflictDoUpdate({ target: [recurrenceExceptions.itemId, recurrenceExceptions.occurrenceKey], set: { action: "override", override, updatedAt: new Date() } });
  } else {
    const update: Partial<typeof items.$inferInsert> = { updatedAt: new Date(), version: nextVersion };
    if (input.outcome === "completed") { update.status = "completed"; update.completedAt = new Date(); }
    else if (input.outcome === "partial") { update.status = "partial"; update.completedAt = null; }
    else if (input.outcome === "cancelled") { update.status = "cancelled"; update.completedAt = null; }
    else {
      update.startAt = input.startAt !== undefined ? (input.startAt ? new Date(input.startAt) : null) : (existing.startAt ? new Date(existing.startAt) : null);
      update.endAt = input.endAt !== undefined ? (input.endAt ? new Date(input.endAt) : null) : (existing.endAt ? new Date(existing.endAt) : null);
      update.dueAt = input.dueAt !== undefined ? (input.dueAt ? new Date(input.dueAt) : null) : (existing.dueAt ? new Date(existing.dueAt) : null);
    }
    await db.update(items).set(update).where(and(eq(items.id, input.itemId), eq(items.workspaceId, workspaceId)));
  }
  await acknowledgeEnd(input.itemId, input.occurrenceKey);
  await writeChange(db, workspaceId, "item", input.itemId, "update", nextVersion, { resolution: input.outcome });
  return (await loadItems(db, workspaceId, true)).find((value) => value.id === input.itemId) ?? null;
}

export async function listReviews(workspaceId: string) {
  const rows = await db.select({ delivery: deliveries, item: items, rule: reminderRules }).from(deliveries)
    .innerJoin(items, eq(items.id, deliveries.itemId))
    .leftJoin(reminderRules, eq(reminderRules.id, deliveries.ruleId))
    .where(and(eq(deliveries.workspaceId, workspaceId), isNull(deliveries.acknowledgedAt), or(eq(deliveries.status, "delivered"), eq(deliveries.status, "missed"), eq(deliveries.status, "pending")), or(eq(reminderRules.trigger, "at_end"), eq(deliveries.status, "missed"))))
    .limit(200);
  return rows.map((row) => ({ deliveryId: row.delivery.id, itemId: row.item.id, occurrenceKey: row.delivery.occurrenceKey, title: row.item.title, scheduledAt: row.delivery.scheduledAt.toISOString(), status: row.delivery.status, autoRollover: row.item.autoRollover }));
}
