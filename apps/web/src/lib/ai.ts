import type { AiDraft, ExpandedItem, ItemInput, Tag } from "@calendar/domain";

export function localDateTimeInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function valueToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function draftToItemPayload(draft: AiDraft, tags: Tag[]): ItemInput {
  const matchedTagIds = tags.filter((tag) => draft.suggestedTagNames.some((name) => name.toLowerCase() === tag.name.toLowerCase())).map((tag) => tag.id);
  const reminders = [...new Set(draft.reminderMinutes)].map((offsetMinutes) => ({ trigger: "before_start" as const, offsetMinutes, channels: ["in_app", "browser_push"] as Array<"in_app" | "browser_push">, repeatEveryMinutes: 5, enabled: true }));
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    description: draft.description,
    location: draft.location,
    startAt: draft.startAt,
    endAt: draft.endAt,
    dueAt: draft.dueAt,
    isAllDay: draft.isAllDay,
    timezone: draft.timezone,
    priority: draft.priority,
    status: "active",
    autoRollover: false,
    showInTimetable: false,
    timetableColor: null,
    courseSlots: [],
    recurrence: draft.recurrence,
    tagIds: matchedTagIds,
    reminders
  };
}

export function isPossibleDuplicate(draft: AiDraft, items: ExpandedItem[]): boolean {
  const title = draft.title.trim().toLowerCase();
  if (!title) return false;
  return items.some((item) => {
    if (item.title.trim().toLowerCase() !== title) return false;
    if (!draft.startAt || !item.startAt) return true;
    return Math.abs(new Date(draft.startAt).getTime() - new Date(item.startAt).getTime()) < 60 * 60_000;
  });
}

export async function compressImage(file: File, maxEdge = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 10 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") || "schedule-image";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}