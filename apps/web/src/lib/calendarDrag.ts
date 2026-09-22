export type CalendarViewKind = "day" | "week" | "month" | "agenda";
export type DragOperation = "move" | "resize";
export type ResizeEdge = "start" | "end";
const MINUTE_MS = 60_000;

interface NormalizeTimesInput {
  view: CalendarViewKind;
  operation: DragOperation;
  resizeEdge: ResizeEdge;
  originalStart: Date;
  originalEnd: Date;
  candidateStart: Date;
  candidateEnd: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
}

function snapTo30Minutes(date: Date): Date {
  const value = new Date(date);
  const minutes = Math.round(value.getMinutes() / 30) * 30;
  value.setMinutes(minutes, 0, 0);
  return value;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function atLocalTime(day: Date, time: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
}

function clamp(value: Date, min: Date, max: Date): Date {
  if (value.getTime() < min.getTime()) return new Date(min);
  if (value.getTime() > max.getTime()) return new Date(max);
  return value;
}

export function normalizeOccurrenceTimes(input: NormalizeTimesInput): { start: Date; end: Date } {
  const originalDuration = Math.max(30 * 60_000, input.originalEnd.getTime() - input.originalStart.getTime());
  let start = snapTo30Minutes(input.candidateStart);
  let end = snapTo30Minutes(input.candidateEnd);

  if (input.view === "day") {
    const dayStart = startOfLocalDay(input.originalStart);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
    if (input.operation === "move") {
      start = atLocalTime(dayStart, start);
      end = new Date(start.getTime() + originalDuration);
      if (end.getTime() - start.getTime() >= dayEnd.getTime() - dayStart.getTime()) {
        start = dayStart;
        end = dayEnd;
      } else {
        start = clamp(start, dayStart, new Date(dayEnd.getTime() - originalDuration));
        end = new Date(start.getTime() + originalDuration);
      }
    } else if (input.resizeEdge === "start") {
      end = atLocalTime(dayStart, input.originalEnd);
      start = clamp(atLocalTime(dayStart, start), dayStart, new Date(end.getTime() - 30 * 60_000));
    } else {
      start = atLocalTime(dayStart, input.originalStart);
      end = clamp(atLocalTime(dayStart, end), new Date(start.getTime() + 30 * 60_000), dayEnd);
    }
  } else if (input.view === "week") {
    const edgeOriginal = input.resizeEdge === "start" ? input.originalStart : input.originalEnd;
    const edgeCandidate = input.resizeEdge === "start" ? input.candidateStart : input.candidateEnd;
    const dayDelta = Math.round((startOfLocalDay(edgeCandidate).getTime() - startOfLocalDay(edgeOriginal).getTime()) / (24 * 60 * 60_000));
    if (input.operation === "move") {
      const candidateClock = atLocalTime(startOfLocalDay(input.candidateStart), input.candidateStart);
      const changedClock = candidateClock.getHours() !== input.originalStart.getHours() || candidateClock.getMinutes() !== input.originalStart.getMinutes();
      start = changedClock ? snapTo30Minutes(candidateClock) : candidateClock;
      end = new Date(start.getTime() + originalDuration);
    } else if (input.resizeEdge === "start") {
      start = new Date(edgeOriginal);
      start.setDate(start.getDate() + dayDelta);
      start.setHours(edgeCandidate.getHours(), edgeCandidate.getMinutes(), 0, 0);
      start = snapTo30Minutes(start);
      end = new Date(input.originalEnd);
    } else {
      start = new Date(input.originalStart);
      end = new Date(edgeOriginal);
      end.setDate(end.getDate() + dayDelta);
      end.setHours(edgeCandidate.getHours(), edgeCandidate.getMinutes(), 0, 0);
      end = snapTo30Minutes(end);
    }
    if (input.rangeStart && input.rangeEnd) {
      const rangeDuration = input.rangeEnd.getTime() - input.rangeStart.getTime();
      if (originalDuration >= rangeDuration) {
        start = new Date(input.rangeStart);
        end = new Date(input.rangeEnd);
      } else if (input.operation === "move") {
        const firstDay = startOfLocalDay(input.rangeStart);
        const lastDay = startOfLocalDay(new Date(input.rangeEnd.getTime() - 1));
        const selectedDay = clamp(startOfLocalDay(input.candidateStart), firstDay, lastDay);
        const candidateClock = atLocalTime(selectedDay, input.candidateStart);
        const changedClock = candidateClock.getHours() !== input.originalStart.getHours() || candidateClock.getMinutes() !== input.originalStart.getMinutes();
        start = changedClock ? snapTo30Minutes(candidateClock) : candidateClock;
        start = clamp(start, input.rangeStart, new Date(input.rangeEnd.getTime() - originalDuration));
        end = new Date(start.getTime() + originalDuration);
      } else if (input.resizeEdge === "start") {
        start = clamp(start, input.rangeStart, new Date(end.getTime() - 30 * MINUTE_MS));
      } else {
        end = clamp(end, new Date(start.getTime() + 30 * MINUTE_MS), input.rangeEnd);
      }
    }
  } else if (input.view === "month") {
    if (input.operation === "move") {
      start = atLocalTime(startOfLocalDay(input.candidateStart), input.originalStart);
      end = new Date(start.getTime() + originalDuration);
      if (input.rangeStart && input.rangeEnd) {
        const minStart = atLocalTime(startOfLocalDay(input.rangeStart), input.originalStart);
        let maxStart = atLocalTime(startOfLocalDay(new Date(input.rangeEnd.getTime() - originalDuration)), input.originalStart);
        while (maxStart.getTime() + originalDuration > input.rangeEnd.getTime()) maxStart = new Date(maxStart.getTime() - 24 * 60 * 60_000);
        if (maxStart.getTime() < minStart.getTime()) { start = new Date(input.originalStart); end = new Date(input.originalEnd); }
        else { start = clamp(start, minStart, maxStart); end = new Date(start.getTime() + originalDuration); }
      }
    } else if (input.resizeEdge === "start") {
      start = atLocalTime(startOfLocalDay(input.candidateStart), input.originalStart);
      end = new Date(input.originalEnd);
      if (input.rangeStart && input.rangeEnd) start = clamp(start, atLocalTime(startOfLocalDay(input.rangeStart), input.originalStart), new Date(end.getTime() - 30 * 60_000));
    } else {
      start = new Date(input.originalStart);
      end = atLocalTime(startOfLocalDay(input.candidateEnd), input.originalEnd);
      if (input.rangeStart && input.rangeEnd) end = clamp(end, new Date(start.getTime() + 30 * 60_000), atLocalTime(startOfLocalDay(new Date(input.rangeEnd.getTime() - 1)), input.originalEnd));
    }
  }

  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 30 * 60_000);
  return { start, end };
}
