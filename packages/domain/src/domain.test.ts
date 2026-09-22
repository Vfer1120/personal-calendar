import { describe, expect, it } from "vitest";
import { aiProviderResponseSchema, itemInputSchema, schedulePeriodListSchema, expandItemOccurrences, findConflicts, icsToItems, isCalendarKind, isTaskKind, itemsToIcs, rangesOverlap } from "./index";
import type { ExpandedItem, Item } from "./index";

const now = new Date("2026-09-15T01:00:00.000Z");
const base: ExpandedItem = {
  id: "10000000-0000-4000-8000-000000000001", workspaceId: "20000000-0000-4000-8000-000000000001",
  calendarId: null, kind: "event", title: "站会", description: "", location: "线上", startAt: "2026-09-15T01:00:00.000Z",
  endAt: "2026-09-15T01:15:00.000Z", dueAt: null, isAllDay: false, timezone: "Asia/Shanghai", priority: "medium",
  status: "active", completedAt: null, autoRollover: false, showInTimetable: false, timetableColor: null, courseSlots: [], parentId: null, recurrence: { frequency: "daily", interval: 1, byWeekday: [], byMonthDay: [], weekParity: "all" },
  tagIds: [], reminders: [], version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), deletedAt: null
};

describe("recurrence", () => {
  it("expands daily occurrences inside a range", () => {
    const result = expandItemOccurrences(base, new Date("2026-09-15T00:00:00Z"), new Date("2026-09-18T23:59:59Z"));
    expect(result.map((item) => item.start.toISOString())).toEqual([
      "2026-09-15T01:00:00.000Z", "2026-09-16T01:00:00.000Z", "2026-09-17T01:00:00.000Z", "2026-09-18T01:00:00.000Z"
    ]);
  });

  it("honors a cancelled occurrence", () => {
    const item: ExpandedItem = { ...base, recurrenceExceptions: [{ id: "30000000-0000-4000-8000-000000000001", itemId: base.id, occurrenceKey: `${base.id}:2026-09-16T01:00:00.000Z`, action: "cancelled", override: null }] };
    const result = expandItemOccurrences(item, new Date("2026-09-15T00:00:00Z"), new Date("2026-09-17T23:59:59Z"));
    expect(result).toHaveLength(2);
  });
});

describe("academic week parity", () => {
  it("expands only odd weeks relative to the semester start", () => {
    const item: ExpandedItem = { ...base, recurrence: { frequency: "weekly", interval: 1, byWeekday: [], byMonthDay: [], weekParity: "odd" } };
    const result = expandItemOccurrences(item, new Date("2026-09-14T00:00:00+08:00"), new Date("2026-10-04T23:59:59+08:00"), new Date("2026-09-14T12:00:00+08:00"));
    expect(result.map((value) => value.start.toISOString())).toEqual(["2026-09-15T01:00:00.000Z", "2026-09-29T01:00:00.000Z"]);
  });
  it("keeps every weekly occurrence when parity is all", () => {
    const item: ExpandedItem = { ...base, recurrence: { frequency: "weekly", interval: 1, byWeekday: [], byMonthDay: [], weekParity: "all" } };
    const result = expandItemOccurrences(item, new Date("2026-09-14T00:00:00+08:00"), new Date("2026-10-04T23:59:59+08:00"), new Date("2026-09-14T12:00:00+08:00"));
    expect(result).toHaveLength(3);
  });
});
describe("schedule periods", () => {
  it("validates ordered period times", () => {
    expect(schedulePeriodListSchema.safeParse({ periods: [{ name: "1", startTime: "08:00", endTime: "08:45", sortOrder: 0 }] }).success).toBe(true);
    expect(schedulePeriodListSchema.safeParse({ periods: [{ name: "1", startTime: "09:00", endTime: "08:45", sortOrder: 0 }] }).success).toBe(false);
  });
});
describe("AI extraction schema", () => {
  it("accepts multiple structured drafts and fills safe defaults", () => {
    const result = aiProviderResponseSchema.parse({ items: [{ title: "交作业", dueAt: "2026-09-21T12:00:00+08:00" }] });
    expect(result.items[0]?.kind).toBe("task");
    expect(result.items[0]?.priority).toBe("none");
    expect(result.items[0]?.reminderMinutes).toEqual([]);
  });
  it("rejects invalid date strings before import", () => {
    expect(aiProviderResponseSchema.safeParse({ items: [{ title: "会议", startAt: "tomorrow" }] }).success).toBe(false);
  });
});
describe("course slots", () => {
  it("expands multiple weekly slots from one item", () => {
    const item: ExpandedItem = { ...base, startAt: "2026-09-14T08:00:00+08:00", endAt: "2026-09-14T08:45:00+08:00", courseSlots: [{ id: "40000000-0000-4000-8000-000000000001", weekday: 1, startTime: "08:00", endTime: "08:45", weekParity: "all" }, { id: "40000000-0000-4000-8000-000000000002", weekday: 3, startTime: "09:50", endTime: "10:35", weekParity: "all" }] };
    const result = expandItemOccurrences(item, new Date("2026-09-14T00:00:00+08:00"), new Date("2026-09-20T23:59:59+08:00"));
    expect(result.map((value) => value.start.toISOString())).toEqual(["2026-09-14T00:00:00.000Z", "2026-09-16T01:50:00.000Z"]);
  });
});
  it("limits course slots to an inclusive course date range", () => {
    const item: ExpandedItem = { ...base, startAt: "2026-09-16T09:50:00+08:00", endAt: "2026-09-16T10:35:00+08:00", courseStartDate: "2026-09-16", courseEndDate: "2026-09-23", courseSlots: [{ id: "40000000-0000-4000-8000-000000000003", weekday: 3, startTime: "09:50", endTime: "10:35", weekParity: "all" }] };
    const result = expandItemOccurrences(item, new Date("2026-09-14T00:00:00+08:00"), new Date("2026-09-27T23:59:59+08:00"));
    expect(result.map((value) => value.start.toISOString())).toEqual(["2026-09-16T01:50:00.000Z", "2026-09-23T01:50:00.000Z"]);
  });
  it("rejects a course end date before its start date", () => {
    const result = itemInputSchema.safeParse({ kind: "event", title: "课程", startAt: "2026-09-16T09:50:00+08:00", endAt: "2026-09-16T10:35:00+08:00", courseStartDate: "2026-09-20", courseEndDate: "2026-09-19", courseSlots: [] });
    expect(result.success).toBe(false);
  });

describe("item kinds", () => {
  it("shows combined items in both calendar and task views", () => {
    expect(isCalendarKind("both")).toBe(true);
    expect(isTaskKind("both")).toBe(true);
  });
});

describe("conflicts", () => {
  it("does not treat touching boundaries as a conflict", () => {
    expect(rangesOverlap({ start: new Date("2026-09-15T01:00:00Z"), end: new Date("2026-09-15T02:00:00Z") }, { start: new Date("2026-09-15T02:00:00Z"), end: new Date("2026-09-15T03:00:00Z") })).toBe(false);
  });

  it("finds overlapping timed events", () => {
    const result = findConflicts(
      { id: "a", start: new Date("2026-09-15T01:00:00Z"), end: new Date("2026-09-15T02:00:00Z") },
      [{ id: "b", start: new Date("2026-09-15T01:30:00Z"), end: new Date("2026-09-15T02:30:00Z"), status: "active" }]
    );
    expect(result).toHaveLength(1);
  });
});

describe("ICS", () => {
  it("round trips core event fields", () => {
    const item = { ...base } as unknown as Item;
    const result = icsToItems(itemsToIcs([item]));
    expect(result[0]?.title).toBe("站会");
    expect(result[0]?.recurrence?.frequency).toBe("daily");
  });
});