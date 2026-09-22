import * as rruleImport from "rrule";
const rruleModule = rruleImport as unknown as { RRule: any; default?: { RRule: any }; rrule?: { RRule: any } };
const RRule = rruleModule.RRule ?? rruleModule.default?.RRule ?? rruleModule.rrule?.RRule;
if (!RRule) throw new Error("rrule 模块未提供 RRule");
import type { Item, ItemInput, RecurrenceException } from "./schemas";

export interface ExpandedOccurrence {
  id: string;
  occurrenceKey: string;
  itemId: string;
  item: Item;
  start: Date;
  end: Date;
  allDay: boolean;
  recurring: boolean;
  overridden: boolean;
}

export interface ExpandedItem extends Item {
  recurrenceExceptions?: RecurrenceException[];
}

const JS_TO_RRULE_WEEKDAY = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];

function startOfWeekMonday(date: Date): Date {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return value;
}

function academicWeekNumber(date: Date, semesterStartDate: Date): number {
  const target = startOfWeekMonday(date);
  const anchor = startOfWeekMonday(semesterStartDate);
  return Math.floor((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())) / (7 * 86_400_000)) + 1;
}

function frequencyToRRule(frequency: NonNullable<Item["recurrence"]>["frequency"]): number {
  const map = { daily: 3, weekly: 2, monthly: 1, yearly: 0 } as const;
  return map[frequency];
}

function applyOverride(base: Item, override: Partial<ItemInput>): ExpandedItem {
  return {
    ...base,
    ...override,
    id: base.id,
    workspaceId: base.workspaceId,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    recurrence: override.recurrence === undefined ? base.recurrence : override.recurrence,
    tagIds: override.tagIds ?? base.tagIds,
    reminders: override.reminders ?? base.reminders
  } as ExpandedItem;
}

function occurrenceFromItem(item: ExpandedItem, start: Date, end: Date, recurring: boolean, key: string, overridden = false): ExpandedOccurrence {
  return {
    id: recurring ? key : item.id,
    occurrenceKey: key,
    itemId: item.id,
    item,
    start,
    end,
    allDay: item.isAllDay,
    recurring,
    overridden
  };
}

function defaultDuration(item: ExpandedItem): number {
  if (item.startAt && item.endAt) return Math.max(1, new Date(item.endAt).getTime() - new Date(item.startAt).getTime());
  if (item.isAllDay) return 24 * 60 * 60 * 1000;
  return 60 * 60 * 1000;
}

function localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function expandItemOccurrences(item: ExpandedItem, rangeStart: Date, rangeEnd: Date, semesterStartDate?: Date | null): ExpandedOccurrence[] {
  if (item.status === "deleted" || item.status === "cancelled" || !item.startAt) return [];
  const baseStart = new Date(item.startAt);
  const duration = defaultDuration(item);
  const exceptionByKey = new Map((item.recurrenceExceptions ?? []).map((exception) => [exception.occurrenceKey, exception]));

  if (item.courseSlots.length > 0) {
    const expanded: ExpandedOccurrence[] = [];
    const cursor = new Date(rangeStart); cursor.setHours(0, 0, 0, 0);
    const endCursor = new Date(rangeEnd); endCursor.setHours(23, 59, 59, 999);
    while (cursor <= endCursor) {
      const dateKey = localDateKey(cursor);
      if (item.courseStartDate && dateKey < item.courseStartDate) { cursor.setDate(cursor.getDate() + 1); continue; }
      if (item.courseEndDate && dateKey > item.courseEndDate) { cursor.setDate(cursor.getDate() + 1); continue; }
      for (const slot of item.courseSlots) {
        if (cursor.getDay() !== slot.weekday) continue;
        const parity = slot.weekParity ?? "all";
        if (parity !== "all" && semesterStartDate) {
          const week = academicWeekNumber(cursor, semesterStartDate);
          if ((parity === "odd" && week % 2 === 0) || (parity === "even" && week % 2 === 1)) continue;
        }
        const start = new Date(cursor); const [startHour, startMinute] = slot.startTime.split(":").map(Number);
        start.setHours(startHour ?? 0, startMinute ?? 0, 0, 0);
        const end = new Date(cursor); const [endHour, endMinute] = slot.endTime.split(":").map(Number);
        end.setHours(endHour ?? 0, endMinute ?? 0, 0, 0);
        if (end <= start) end.setDate(end.getDate() + 1);
        if (end < rangeStart || start > rangeEnd) continue;
        const slotKey = slot.id ?? `${slot.weekday}-${slot.startTime}-${slot.endTime}`;
        const key = `${item.id}:${slotKey}:${localDateKey(cursor)}`;
        const exception = exceptionByKey.get(key);
        if (exception?.action === "cancelled") continue;
        const effectiveItem = exception?.override ? applyOverride(item, exception.override) : item;
        const effectiveStart = exception?.override?.startAt ? new Date(exception.override.startAt) : start;
        const effectiveEnd = exception?.override?.endAt ? new Date(exception.override.endAt) : end;
        expanded.push(occurrenceFromItem(effectiveItem, effectiveStart, effectiveEnd, true, key, Boolean(exception?.override)));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return expanded.sort((left, right) => left.start.getTime() - right.start.getTime());
  }
  if (!item.recurrence) {
    const baseEnd = item.endAt ? new Date(item.endAt) : new Date(baseStart.getTime() + duration);
    if (baseEnd < rangeStart || baseStart > rangeEnd) return [];
    return [occurrenceFromItem(item, baseStart, baseEnd, false, item.id)];
  }

  const options = {
    dtstart: baseStart,
    freq: frequencyToRRule(item.recurrence.frequency),
    interval: item.recurrence.interval,
    byweekday: item.recurrence.byWeekday.length > 0
      ? item.recurrence.byWeekday.map((day) => JS_TO_RRULE_WEEKDAY[day]).filter((day): day is (typeof JS_TO_RRULE_WEEKDAY)[number] => day !== undefined)
      : undefined,
    bymonthday: item.recurrence.byMonthDay.length > 0 ? item.recurrence.byMonthDay : undefined,
    count: item.recurrence.count ?? undefined,
    until: item.recurrence.until ? new Date(item.recurrence.until) : undefined
  };
  const rule = new RRule(options);
  const occurrences = rule.between(rangeStart, rangeEnd, true);
  const expanded: ExpandedOccurrence[] = [];

  for (const originalStart of occurrences) {
    const parity = item.recurrence.weekParity ?? "all";
    if (item.recurrence.frequency === "weekly" && parity !== "all" && semesterStartDate) {
      const week = academicWeekNumber(originalStart, semesterStartDate);
      if ((parity === "odd" && week % 2 === 0) || (parity === "even" && week % 2 === 1)) continue;
    }
    const key = `${item.id}:${originalStart.toISOString()}`;
    const exception = exceptionByKey.get(key);
    if (exception?.action === "cancelled") continue;
    const effectiveItem = exception?.override ? applyOverride(item, exception.override) : item;
    const effectiveStart = exception?.override?.startAt ? new Date(exception.override.startAt) : originalStart;
    const effectiveDuration = exception?.override?.startAt || exception?.override?.endAt
      ? defaultDuration(effectiveItem)
      : duration;
    const effectiveEnd = exception?.override?.endAt ? new Date(exception.override.endAt) : new Date(effectiveStart.getTime() + effectiveDuration);
    if (effectiveEnd < rangeStart || effectiveStart > rangeEnd) continue;
    expanded.push(occurrenceFromItem(effectiveItem, effectiveStart, effectiveEnd, true, key, Boolean(exception?.override)));
  }
  return expanded;
}

export function expandItems(items: ExpandedItem[], rangeStart: Date, rangeEnd: Date, semesterStartDate?: Date | null): ExpandedOccurrence[] {
  return items
    .flatMap((item) => expandItemOccurrences(item, rangeStart, rangeEnd, semesterStartDate))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}
