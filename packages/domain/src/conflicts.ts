import type { ExpandedItem, ExpandedOccurrence } from "./recurrence";

export interface TimeRange {
  start: Date;
  end: Date;
  allDay?: boolean;
  status?: "active" | "partial" | "completed" | "cancelled" | "deleted";
  id?: string;
}

export interface ConflictResult<T> {
  candidate: T;
  overlapStart: Date;
  overlapEnd: Date;
}

export function defaultEnd(start: Date, allDay: boolean): Date {
  return new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
}

export function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  if (left.allDay !== right.allDay) return false;
  return left.start.getTime() < right.end.getTime() && left.end.getTime() > right.start.getTime();
}

export function findConflicts<T extends TimeRange>(target: TimeRange, candidates: T[], excludedIds: string[] = []): ConflictResult<T>[] {
  const excluded = new Set(excludedIds);
  return candidates
    .filter((candidate) => !candidate.id || !excluded.has(candidate.id))
    .filter((candidate) => candidate.status !== "cancelled" && candidate.status !== "deleted" && candidate.status !== "completed")
    .filter((candidate) => rangesOverlap(target, candidate))
    .map((candidate) => ({
      candidate,
      overlapStart: new Date(Math.max(target.start.getTime(), candidate.start.getTime())),
      overlapEnd: new Date(Math.min(target.end.getTime(), candidate.end.getTime()))
    }))
    .sort((left, right) => left.overlapStart.getTime() - right.overlapStart.getTime());
}

export function itemToTimeRange(item: ExpandedItem): TimeRange | null {
  if (!item.startAt) return null;
  const start = new Date(item.startAt);
  const end = item.endAt ? new Date(item.endAt) : defaultEnd(start, item.isAllDay);
  return { id: item.id, start, end, allDay: item.isAllDay, status: item.status };
}

export function occurrenceToTimeRange(occurrence: ExpandedOccurrence): TimeRange {
  return {
    id: occurrence.itemId,
    start: occurrence.start,
    end: occurrence.end,
    allDay: occurrence.allDay,
    status: occurrence.item.status
  };
}