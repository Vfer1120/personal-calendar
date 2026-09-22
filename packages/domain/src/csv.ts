import type { Item, ItemInput } from "./schemas";
import type { PortableItem } from "./ics";

function csvCell(value: unknown): string {
  const text = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function itemsToCsv(items: Item[]): string {
  const headers = ["uid", "kind", "title", "description", "location", "startAt", "endAt", "dueAt", "isAllDay", "timezone", "priority", "status", "completedAt", "autoRollover", "showInTimetable", "timetableColor", "courseStartDate", "courseEndDate", "courseSlots", "parentId", "recurrence", "tagIds", "reminders"];
  const rows = items.map((item) => [
    `${item.id}@personal-calendar`, item.kind, item.title, item.description, item.location,
    item.startAt ?? "", item.endAt ?? "", item.dueAt ?? "", item.isAllDay, item.timezone,
    item.priority, item.status, item.completedAt ?? "", item.showInTimetable, item.timetableColor ?? "", item.courseStartDate ?? "", item.courseEndDate ?? "", item.courseSlots, item.parentId ?? "", item.recurrence ?? "", item.tagIds, item.reminders
  ].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\r\n");
}

export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    const next = input[index + 1];
    if (quoted && character === '"' && next === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function safeJson<T>(value: string, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function csvToItems(input: string): PortableItem[] {
  const rows = parseCsvRows(input);
  const headers = rows.shift() ?? [];
  const index = new Map(headers.map((header, position) => [header, position]));
  const value = (row: string[], key: string) => row[index.get(key) ?? -1] ?? "";
  return rows.filter((row) => value(row, "title")).map((row) => ({
    uid: value(row, "uid"),
    kind: value(row, "kind") === "task" ? "task" : value(row, "kind") === "both" ? "both" : "event",
    title: value(row, "title"),
    description: value(row, "description"),
    location: value(row, "location"),
    startAt: value(row, "startAt") || null,
    endAt: value(row, "endAt") || null,
    dueAt: value(row, "dueAt") || null,
    isAllDay: value(row, "isAllDay") === "true",
    timezone: value(row, "timezone") || "Asia/Shanghai",
    priority: (value(row, "priority") || "none") as ItemInput["priority"],
    status: (value(row, "status") || "active") as ItemInput["status"],
    completedAt: value(row, "completedAt") || null,
    autoRollover: value(row, "autoRollover") === "true",
    showInTimetable: value(row, "showInTimetable") === "true",
    timetableColor: value(row, "timetableColor") || null,
    courseStartDate: value(row, "courseStartDate") || null,
    courseEndDate: value(row, "courseEndDate") || null,
    courseSlots: safeJson(value(row, "courseSlots"), []),
    parentId: value(row, "parentId") || null,
    recurrence: safeJson(value(row, "recurrence"), null),
    tagIds: safeJson(value(row, "tagIds"), []),
    reminders: safeJson(value(row, "reminders"), [])
  }));
}
