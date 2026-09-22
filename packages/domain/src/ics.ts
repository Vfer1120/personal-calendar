import type { Item, ItemInput, Recurrence, ReminderInput } from "./schemas";

export interface PortableItem extends ItemInput { uid?: string; }

const WEEKDAY_NAMES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const pad = (value: number) => String(value).padStart(2, "0");
const escapeIcs = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
const unescapeIcs = (value: string) => value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

function toIcsDate(value: string, allDay: boolean): string {
  const date = new Date(value);
  if (allDay) return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function recurrenceToRRule(recurrence: Recurrence): string {
  const parts = [`FREQ=${recurrence.frequency.toUpperCase()}`, `INTERVAL=${recurrence.interval}`];
  if (recurrence.byWeekday.length > 0) parts.push(`BYDAY=${recurrence.byWeekday.map((day) => WEEKDAY_NAMES[day]).filter(Boolean).join(",")}`);
  if (recurrence.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${recurrence.byMonthDay.join(",")}`);
  if (recurrence.count) parts.push(`COUNT=${recurrence.count}`);
  if (recurrence.until) parts.push(`UNTIL=${toIcsDate(recurrence.until, false)}`);
  return parts.join(";");
}

function parseRRule(value: string): Recurrence | undefined {
  const parts = new Map(value.split(";").map((part) => {
    const [key, item] = part.split("=", 2);
    return [key?.toUpperCase() ?? "", item ?? ""];
  }));
  const frequency = parts.get("FREQ")?.toLowerCase();
  if (!["daily", "weekly", "monthly", "yearly"].includes(frequency ?? "")) return undefined;
  const weekdayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  return {
    frequency: frequency as Recurrence["frequency"],
    interval: Number(parts.get("INTERVAL") ?? 1),
    byWeekday: (parts.get("BYDAY") ?? "").split(",").filter(Boolean).map((day) => weekdayMap[day.replace(/^[-+]?\d+/, "")] ?? -1).filter((day) => day >= 0),
    byMonthDay: (parts.get("BYMONTHDAY") ?? "").split(",").filter(Boolean).map(Number),
    weekParity: "all",
    count: parts.has("COUNT") ? Number(parts.get("COUNT")) : null,
    until: parts.has("UNTIL") ? parseIcsDate(parts.get("UNTIL")!) : null
  };
}

function reminderToIcs(reminder: ReminderInput): string[] {
  if (!reminder.enabled) return [];
  const amount = reminder.offsetMinutes === 1440 ? "PT24H" : reminder.offsetMinutes === 0 ? "PT0M" : `PT${reminder.offsetMinutes}M`;
  return ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:日程提醒", `TRIGGER:-${amount}`, "END:VALARM"];
}

function itemToIcsLines(item: Item, tags: Map<string, string>): string[] {
  const lines = item.kind === "task" ? ["BEGIN:VTODO"] : ["BEGIN:VEVENT"];
  lines.push(`UID:${item.id}@personal-calendar`, `DTSTAMP:${toIcsDate(item.updatedAt, false)}`, `SUMMARY:${escapeIcs(item.title)}`);
  if (item.description) lines.push(`DESCRIPTION:${escapeIcs(item.description)}`);
  if (item.location) lines.push(`LOCATION:${escapeIcs(item.location)}`);
  if (item.startAt) lines.push(`DTSTART${item.isAllDay ? ";VALUE=DATE" : ""}:${toIcsDate(item.startAt, item.isAllDay)}`);
  if (item.endAt) {
    const end = item.isAllDay ? new Date(new Date(item.endAt).getTime() + 86400000).toISOString() : item.endAt;
    lines.push(`DTEND${item.isAllDay ? ";VALUE=DATE" : ""}:${toIcsDate(end, item.isAllDay)}`);
  }
  if (item.dueAt) lines.push(`DUE:${toIcsDate(item.dueAt, false)}`);
  if (item.recurrence) lines.push(`RRULE:${recurrenceToRRule(item.recurrence)}`);
  if (item.status === "completed") lines.push("STATUS:COMPLETED");
  if (item.completedAt) lines.push(`COMPLETED:${toIcsDate(item.completedAt, false)}`);
  const priority = { urgent: 1, high: 3, medium: 5, low: 7, none: 0 }[item.priority];
  if (priority) lines.push(`PRIORITY:${priority}`);
  if (item.tagIds.length > 0) lines.push(`CATEGORIES:${item.tagIds.map((id) => escapeIcs(tags.get(id) ?? id)).join(",")}`);
  for (const reminder of item.reminders) lines.push(...reminderToIcs(reminder));
  lines.push(item.kind === "task" ? "END:VTODO" : "END:VEVENT");
  return lines;
}

export function itemsToIcs(items: Item[], tags = new Map<string, string>()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "PRODID:-//Personal Calendar//ZH-CN//EN"];
  for (const item of items) lines.push(...itemToIcsLines(item, tags));
  lines.push("END:VCALENDAR");
  return lines.map((line) => {
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += 73) chunks.push(line.slice(index, index + 73));
    return chunks.join("\r\n ");
  }).join("\r\n");
}
function unfoldIcs(input: string): string[] {
  const lines = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  return unfolded;
}

function parseIcsDate(value: string): string | undefined {
  if (/^\d{8}$/.test(value)) return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))).toISOString();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, zulu] = match;
  if (zulu) return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString();
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).toISOString();
}

export function parseTrigger(value: string): number | undefined {
  const match = value.replace(/^-/, "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!match) return undefined;
  return (Number(match[1] ?? 0) * 1440) + (Number(match[2] ?? 0) * 60) + Number(match[3] ?? 0);
}

export function icsToItems(input: string): PortableItem[] {
  const lines = unfoldIcs(input);
  const items: PortableItem[] = [];
  let component: "VEVENT" | "VTODO" | null = null;
  let properties = new Map<string, string>();
  let alarmTrigger: string | undefined;

  const flush = () => {
    if (!component) return;
    const title = unescapeIcs(properties.get("SUMMARY") ?? "");
    if (title) {
      const triggerMinutes = alarmTrigger ? parseTrigger(alarmTrigger) : undefined;
      const offset = triggerMinutes === undefined ? undefined : ([0, 5, 15, 30, 60, 1440].includes(triggerMinutes) ? triggerMinutes : 15) as ReminderInput["offsetMinutes"];
      items.push({
        uid: properties.get("UID"), kind: component === "VTODO" ? "task" : "event", title,
        description: unescapeIcs(properties.get("DESCRIPTION") ?? ""), location: unescapeIcs(properties.get("LOCATION") ?? ""),
        startAt: parseIcsDate(properties.get("DTSTART") ?? "") ?? null,
        endAt: parseIcsDate(properties.get("DTEND") ?? "") ?? null,
        dueAt: parseIcsDate(properties.get("DUE") ?? "") ?? null,
        isAllDay: properties.get("DTSTART")?.startsWith(";") ?? false,
        timezone: "Asia/Shanghai", priority: "none",
        status: properties.get("STATUS") === "COMPLETED" ? "completed" : "active",
        completedAt: parseIcsDate(properties.get("COMPLETED") ?? "") ?? null,
        autoRollover: false,
        showInTimetable: false,
        timetableColor: null,
        courseSlots: [],
        parentId: null,
        recurrence: properties.get("RRULE") ? parseRRule(properties.get("RRULE")!) ?? null : null,
        tagIds: [], reminders: offset === undefined ? [] : [{ trigger: "before_start", offsetMinutes: offset, channels: ["in_app"], enabled: true }]
      });
    }
    component = null; properties = new Map(); alarmTrigger = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "BEGIN:VEVENT" || line === "BEGIN:VTODO") {
      component = line.slice(6) as "VEVENT" | "VTODO"; properties = new Map(); continue;
    }
    if (line === "END:VEVENT" || line === "END:VTODO") { flush(); continue; }
    if (line === "BEGIN:VALARM") { alarmTrigger = undefined; continue; }
    if (line === "END:VALARM") continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const rawKey = line.slice(0, separator);
    const key = rawKey.split(";", 1)[0]?.toUpperCase();
    const value = line.slice(separator + 1);
    if (!key || !component) continue;
    if (key === "TRIGGER") alarmTrigger = value;
    else properties.set(key, value);
  }
  return items;
}
