import * as rruleImport from "rrule";
const rruleModule = rruleImport as unknown as { RRule: any; default?: { RRule: any }; rrule?: { RRule: any } };
const RRule = rruleModule.RRule ?? rruleModule.default?.RRule ?? rruleModule.rrule?.RRule;
if (!RRule) throw new Error("rrule 模块未提供 RRule");
import { DateTime } from "luxon";
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

function itemTimezone(item: Pick<Item, "timezone">): string {
  return item.timezone || "Asia/Shanghai";
}

function mondayDateTime(value: DateTime): DateTime {
  return value.minus({ days: value.weekday - 1 }).startOf("day");
}

function academicWeekNumber(dateKey: string, semesterStartDate: Date): number {
  const target = DateTime.fromISO(dateKey, { zone: "utc" });
  const anchor = DateTime.fromObject({
    year: semesterStartDate.getFullYear(),
    month: semesterStartDate.getMonth() + 1,
    day: semesterStartDate.getDate()
  }, { zone: "utc" });
  return Math.floor(mondayDateTime(target).diff(mondayDateTime(anchor), "days").days / 7) + 1;
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

function dateTimeAt(dateKey: string, time: string, timezone: string): DateTime {
  const value = DateTime.fromISO(`${dateKey}T${time}`, { zone: timezone });
  if (!value.isValid) throw new Error(`无法解析课程时间：${dateKey} ${time} ${timezone}`);
  return value;
}

function itemSemesterStart(item: ExpandedItem, fallback: Date | null | undefined, semesterStarts?: ReadonlyMap<string, Date | null>): Date | null {
  if (item.timetableId && semesterStarts?.has(item.timetableId)) return semesterStarts.get(item.timetableId) ?? null;
  return fallback ?? null;
}

export function expandItemOccurrences(
  item: ExpandedItem,
  rangeStart: Date,
  rangeEnd: Date,
  semesterStartDate?: Date | null,
  semesterStartByTimetable?: ReadonlyMap<string, Date | null>
): ExpandedOccurrence[] {
  if (item.status === "deleted" || item.status === "cancelled" || !item.startAt) return [];
  const timezone = itemTimezone(item);
  const activeSemesterStart = itemSemesterStart(item, semesterStartDate, semesterStartByTimetable);
  const baseStart = new Date(item.startAt);
  const duration = defaultDuration(item);
  const exceptionByKey = new Map((item.recurrenceExceptions ?? []).map((exception) => [exception.occurrenceKey, exception]));

  if (item.courseSlots.length > 0) {
    const expanded: ExpandedOccurrence[] = [];
    let cursor = DateTime.fromJSDate(rangeStart, { zone: timezone }).startOf("day");
    const endCursor = DateTime.fromJSDate(rangeEnd, { zone: timezone }).endOf("day");
    while (cursor <= endCursor) {
      const dateKey = cursor.toFormat("yyyy-MM-dd");
      if (item.courseStartDate && dateKey < item.courseStartDate) { cursor = cursor.plus({ days: 1 }); continue; }
      if (item.courseEndDate && dateKey > item.courseEndDate) { cursor = cursor.plus({ days: 1 }); continue; }
      for (const slot of item.courseSlots) {
        const slotWeekday = slot.weekday === 0 ? 7 : slot.weekday;
        if (cursor.weekday !== slotWeekday) continue;
        const parity = slot.weekParity ?? "all";
        if (parity !== "all" && activeSemesterStart) {
          const week = academicWeekNumber(dateKey, activeSemesterStart);
          if ((parity === "odd" && week % 2 === 0) || (parity === "even" && week % 2 === 1)) continue;
        }
        const start = dateTimeAt(dateKey, slot.startTime, timezone);
        let end = dateTimeAt(dateKey, slot.endTime, timezone);
        if (end <= start) end = end.plus({ days: 1 });
        if (end.toJSDate() < rangeStart || start.toJSDate() > rangeEnd) continue;
        const slotKey = slot.id ?? `${slot.weekday}-${slot.startTime}-${slot.endTime}`;
        const key = `${item.id}:${slotKey}:${dateKey}`;
        const exception = exceptionByKey.get(key);
        if (exception?.action === "cancelled") continue;
        const effectiveItem = exception?.override ? applyOverride(item, exception.override) : item;
        const effectiveStart = exception?.override?.startAt ? new Date(exception.override.startAt) : start.toJSDate();
        const effectiveEnd = exception?.override?.endAt ? new Date(exception.override.endAt) : end.toJSDate();
        expanded.push(occurrenceFromItem(effectiveItem, effectiveStart, effectiveEnd, true, key, Boolean(exception?.override)));
      }
      cursor = cursor.plus({ days: 1 });
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
    if (item.recurrence.frequency === "weekly" && parity !== "all" && activeSemesterStart) {
      const dateKey = DateTime.fromJSDate(originalStart, { zone: timezone }).toFormat("yyyy-MM-dd");
      const week = academicWeekNumber(dateKey, activeSemesterStart);
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

export function expandItems(
  items: ExpandedItem[],
  rangeStart: Date,
  rangeEnd: Date,
  semesterStartDate?: Date | null,
  semesterStartByTimetable?: ReadonlyMap<string, Date | null>
): ExpandedOccurrence[] {
  return items
    .flatMap((item) => expandItemOccurrences(item, rangeStart, rangeEnd, semesterStartDate, semesterStartByTimetable))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}