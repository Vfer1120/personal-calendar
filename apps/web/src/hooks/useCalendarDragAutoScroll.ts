import { useCallback, useEffect, useRef, useState } from "react";
import type { EventDragStartArg, EventResizeStartArg } from "@fullcalendar/interaction";
import { normalizeOccurrenceTimes, type CalendarViewKind } from "../lib/calendarDrag";

type DragMode = "move" | "resize";
type ResizeEdge = "start" | "end";
type ScrollDirection = "up" | "down" | null;

export interface DragPreview {
  start: Date;
  end: Date;
  mode: DragMode;
  resizeEdge: ResizeEdge;
  allDay: boolean;
  itemId: string;
  occurrenceKey: string;
  recurring: boolean;
  fallbackAllowed: boolean;
  view: CalendarViewKind;
  rangeStart?: Date;
  rangeEnd?: Date;
}

interface DragMeta { allDay: boolean; itemId: string; occurrenceKey: string; recurring: boolean; view: CalendarViewKind; rangeStart?: Date; rangeEnd?: Date; }
interface DragOutcome { preview: DragPreview | null; cancelled: boolean; }
interface DragState {
  mode: DragMode;
  resizeEdge: ResizeEdge;
  originalStart: Date;
  originalEnd: Date;
  initialPointerX: number;
  initialPointerY: number;
  initialScrollTop: number;
  pointerX: number;
  pointerY: number;
  pointerId: number;
  pointerType: string;
  dayWidth: number;
  dayGridCellWidth: number;
  dayGridCellHeight: number;
  frame: number | null;
  previousScrollBehavior: string;
  lastPreviewStart: number | null;
  lastPreviewEnd: number | null;
  view: CalendarViewKind;
  rangeStart?: Date;
  rangeEnd?: Date;
}

const EDGE_THRESHOLD = 80;
const MAX_SCROLL_STEP = 24;
const MINUTE_MS = 60_000;

function isDocumentScroller(element: HTMLElement | null): boolean {
  return element === document.scrollingElement || element === document.documentElement || element === document.body;
}
function isScrollable(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return (style.overflowY === "auto" || style.overflowY === "scroll") && element.scrollHeight > element.clientHeight;
}
function getScrollContainer(): HTMLElement {
  const main = document.querySelector<HTMLElement>("main");
  if (main && isScrollable(main)) return main;
  let current = document.querySelector<HTMLElement>(".calendar-shell")?.parentElement ?? null;
  while (current && current !== document.documentElement) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}
function getViewportRect(container: HTMLElement) {
  return isDocumentScroller(container) ? { top: 0, bottom: window.innerHeight } : container.getBoundingClientRect();
}
function getScrollTop(container: HTMLElement): number {
  return isDocumentScroller(container) ? window.scrollY : container.scrollTop;
}
function scrollByAmount(container: HTMLElement, amount: number) {
  if (isDocumentScroller(container)) window.scrollBy({ top: amount, behavior: "auto" });
  else container.scrollTop += amount;
}
function slotMinutes(): number { return 30; }
function slotHeight(): number {
  const slot = document.querySelector(".fc-timegrid-slot-lane") as HTMLElement | null;
  return slot?.getBoundingClientRect().height || 48;
}
function dayGridCellSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.closest(".fc-daygrid-day")?.getBoundingClientRect();
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
}
function parseDataDate(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? new Date(year!, month! - 1, day!, 0, 0, 0, 0) : null;
}
function localDayDelta(from: Date, to: Date): number {
  return Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / 86_400_000);
}
function calendarHitElement(pointerX: number, pointerY: number): HTMLElement | null {
  const elements = document.elementsFromPoint(pointerX, pointerY) as HTMLElement[];
  return elements.find((element) => !element.closest(".fc-event, .fc-event-mirror, .fc-highlight") && element.closest(".calendar-shell")) ?? null;
}
function resolveCellTarget(pointerX: number, pointerY: number): { date: Date | null; allDay: boolean; timeMinutes: number | null } {
  const element = calendarHitElement(pointerX, pointerY);
  if (!element?.closest(".calendar-shell")) return { date: null, allDay: false, timeMinutes: null };
  const dayCell = element.closest<HTMLElement>(".fc-daygrid-day");
  const timeColumn = element.closest<HTMLElement>(".fc-timegrid-col");
  const slot = element.closest<HTMLElement>(".fc-timegrid-slot-lane");
  const timeValue = slot?.dataset.time;
  const timeParts = timeValue?.split(":").map(Number);
  const timeMinutes = timeParts?.length && timeParts.every(Number.isFinite) ? (timeParts[0]! * 60 + timeParts[1]!) : null;
  return {
    date: parseDataDate(dayCell?.dataset.date ?? timeColumn?.dataset.date),
    allDay: Boolean(element.closest(".fc-timegrid-allday") || element.closest(".fc-daygrid-body") || element.closest(".fc-daygrid-event")),
    timeMinutes
  };
}function timeGridColumnWidth(): number {
  const column = document.querySelector(".fc-timegrid-col") as HTMLElement | null;
  return column?.getBoundingClientRect().width || 0;
}
function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}
function dispatchDragMove(state: DragState) {
  const mouseOptions: MouseEventInit = { clientX: state.pointerX, clientY: state.pointerY, buttons: 1, bubbles: true, cancelable: true, view: window };
  document.dispatchEvent(new MouseEvent("mousemove", mouseOptions));
  if (typeof PointerEvent !== "undefined") {
    document.dispatchEvent(new PointerEvent("pointermove", { ...mouseOptions, pointerId: state.pointerId, pointerType: state.pointerType as PointerEvent["pointerType"], isPrimary: true }));
  }
}
export function useCalendarDragAutoScroll() {
  const state = useRef<DragState | null>(null);
  const finalPreview = useRef<DragPreview | null>(null);
  const cancelled = useRef(false);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>(null);

  const clearOutcome = useCallback(() => {
    finalPreview.current = null;
    cancelled.current = false;
  }, []);

  const stop = useCallback(() => {
    const current = state.current;
    if (current && current.frame !== null) cancelAnimationFrame(current.frame);
    const container = getScrollContainer();
    if (current) {
      if (isDocumentScroller(container)) document.documentElement.style.scrollBehavior = current.previousScrollBehavior;
      else container.style.scrollBehavior = current.previousScrollBehavior;
    }
    state.current = null;
    setPreview(null);
    setScrollDirection(null);
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
  }, [stop]);
  const tick = useCallback(() => {
    const current = state.current;
    if (!current) return;
    const container = getScrollContainer();
    const rect = getViewportRect(container);
    let velocity = 0;
    if (current.pointerY < rect.top + EDGE_THRESHOLD) {
      velocity = -Math.ceil(((rect.top + EDGE_THRESHOLD - current.pointerY) / EDGE_THRESHOLD) * MAX_SCROLL_STEP);
    } else if (current.pointerY > rect.bottom - EDGE_THRESHOLD) {
      velocity = Math.ceil(((current.pointerY - (rect.bottom - EDGE_THRESHOLD)) / EDGE_THRESHOLD) * MAX_SCROLL_STEP);
    }
    velocity = Math.max(-MAX_SCROLL_STEP, Math.min(MAX_SCROLL_STEP, velocity));
    setScrollDirection(velocity < 0 ? "up" : velocity > 0 ? "down" : null);
    if (velocity !== 0) {
      scrollByAmount(container, velocity);
      dispatchDragMove(current);
    }
    const previous = finalPreview.current;
    const target = resolveCellTarget(current.pointerX, current.pointerY);
    const targetDayDelta = target.date ? localDayDelta(current.originalStart, target.date) : null;
    const verticalDelta = current.pointerY - current.initialPointerY + getScrollTop(container) - current.initialScrollTop;
    const minuteDelta = Math.round((verticalDelta / slotHeight()) * slotMinutes());
    const gridDayDelta = current.dayGridCellWidth > 0 ? Math.round((current.pointerX - current.initialPointerX) / current.dayGridCellWidth) + Math.round((current.pointerY - current.initialPointerY) / Math.max(1, current.dayGridCellHeight)) * 7 : 0;
    const dayDelta = (current.view === "month" || current.view === "week") ? (targetDayDelta ?? gridDayDelta) : 0;
    const duration = current.originalEnd.getTime() - current.originalStart.getTime();
    let nextStart = new Date(current.originalStart);
    let nextEnd = new Date(current.originalEnd);
    if (current.mode === "move") {
      nextStart = new Date(addDays(current.originalStart, dayDelta).getTime() + ((current.view === "day" || (current.view === "week" && !target.allDay)) ? minuteDelta * MINUTE_MS : 0));
      nextEnd = new Date(nextStart.getTime() + duration);
    } else if (current.resizeEdge === "start") {
      const targetStart = target.date && target.timeMinutes != null ? new Date(target.date.getFullYear(), target.date.getMonth(), target.date.getDate(), Math.floor(target.timeMinutes / 60), target.timeMinutes % 60, 0, 0) : null;
      nextStart = targetStart ?? new Date(addDays(current.originalStart, dayDelta).getTime() + minuteDelta * MINUTE_MS);
    } else {
      const targetEnd = target.date && target.timeMinutes != null ? new Date(target.date.getFullYear(), target.date.getMonth(), target.date.getDate(), Math.floor(target.timeMinutes / 60), target.timeMinutes % 60, 0, 0) : null;
      nextEnd = targetEnd ?? new Date(addDays(current.originalEnd, dayDelta).getTime() + minuteDelta * MINUTE_MS);
    }
    const validTarget = target.date !== null || target.timeMinutes !== null;
    const allDayTarget = current.view === "month" ? (previous?.allDay ?? false) : validTarget ? target.allDay : (previous?.allDay ?? false);
    const shellRect = document.querySelector<HTMLElement>(".calendar-shell")?.getBoundingClientRect();
    const fallbackAllowed = (current.view === "day" || current.view === "week" || current.view === "month") && Boolean(shellRect) && current.pointerX >= shellRect!.left && current.pointerX <= shellRect!.right && current.pointerY >= Math.max(shellRect!.top, 0) && current.pointerY <= Math.min(shellRect!.bottom, window.innerHeight);
    if (!previous || previous.start.getTime() !== nextStart.getTime() || previous.end.getTime() !== nextEnd.getTime() || previous.allDay !== allDayTarget) {
      finalPreview.current = { start: nextStart, end: nextEnd, mode: current.mode, resizeEdge: current.resizeEdge, allDay: allDayTarget, itemId: previous?.itemId ?? "", occurrenceKey: previous?.occurrenceKey ?? "", recurring: previous?.recurring ?? false, fallbackAllowed, view: current.view, rangeStart: previous?.rangeStart ?? current.rangeStart, rangeEnd: previous?.rangeEnd ?? current.rangeEnd };
      setPreview(finalPreview.current);
    }
    current.frame = requestAnimationFrame(tick);
  }, []);
  const begin = useCallback((mode: DragMode, start: Date | null, end: Date | null, event: MouseEvent, element: HTMLElement, meta: DragMeta) => {
    if (!start) return;
    clearOutcome();
    stop();
    const container = getScrollContainer();
    const containerRect = getViewportRect(container);
    const eventRect = element.getBoundingClientRect();
    const eventStart = new Date(start);
    const eventEnd = end ? new Date(end) : new Date(eventStart.getTime() + 60 * MINUTE_MS);
    const pointerType = "pointerType" in event ? String((event as PointerEvent).pointerType) : "mouse";
    const pointerId = "pointerId" in event ? Number((event as PointerEvent).pointerId) : 1;
    const pointerY = Math.min(Math.max(event.clientY, containerRect.top), containerRect.bottom);
    state.current = {
      mode,
      resizeEdge: mode === "resize" && event.clientY < eventRect.top + eventRect.height / 2 ? "start" : "end",
      originalStart: eventStart,
      originalEnd: eventEnd,
      initialPointerX: event.clientX,
      initialPointerY: pointerY,
      initialScrollTop: getScrollTop(container),
      pointerX: event.clientX,
      pointerY,
      pointerId,
      pointerType,
      dayWidth: timeGridColumnWidth(),
      dayGridCellWidth: dayGridCellSize(element).width,
      dayGridCellHeight: dayGridCellSize(element).height,
      frame: null,
      previousScrollBehavior: isDocumentScroller(container) ? document.documentElement.style.scrollBehavior : container.style.scrollBehavior,
      lastPreviewStart: null,
      lastPreviewEnd: null,
          view: meta.view
        };
    if (isDocumentScroller(container)) document.documentElement.style.scrollBehavior = "auto";
    else container.style.scrollBehavior = "auto";
    finalPreview.current = { start: new Date(eventStart), end: new Date(eventEnd), mode, resizeEdge: state.current.resizeEdge, allDay: meta.allDay, itemId: meta.itemId, occurrenceKey: meta.occurrenceKey, recurring: meta.recurring, fallbackAllowed: (meta.view === "day" || meta.view === "week" || meta.view === "month") && (meta.view === "month" || !meta.allDay), view: meta.view, rangeStart: meta.rangeStart, rangeEnd: meta.rangeEnd };
    setPreview(finalPreview.current);
    state.current.frame = requestAnimationFrame(tick);
  }, [clearOutcome, stop, tick]);
  useEffect(() => {
    const move = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const current = state.current;
      if (!current) return;
      if ("touches" in event) {
        const touch = event.touches[0] ?? event.changedTouches[0];
        if (!touch) return;
        current.pointerX = touch.clientX;
        current.pointerY = touch.clientY;
      } else {
        current.pointerX = event.clientX;
        current.pointerY = event.clientY;
      }
    };
    const end = () => stop();
    const cancelDrag = () => cancel();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancelDrag(); };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("touchmove", move as EventListener, { passive: true });
    window.addEventListener("pointerup", end, { passive: true });
    window.addEventListener("mouseup", end, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", cancelDrag, { passive: true });
    window.addEventListener("pointercancel", cancelDrag, { passive: true });
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move as EventListener);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("keydown", key);
      stop();
      clearOutcome();
    };
  }, [cancel, clearOutcome, stop]);

  const getOutcome = useCallback((): DragOutcome => ({
    preview: finalPreview.current ? { ...finalPreview.current, start: new Date(finalPreview.current.start), end: new Date(finalPreview.current.end) } : null,
    cancelled: cancelled.current
  }), []);

  return {
    preview,
    scrollDirection,
    getOutcome,
    clearOutcome,
    cancel,
    stop,
    onDragStart: (arg: EventDragStartArg, view: CalendarViewKind, rangeStart?: Date, rangeEnd?: Date) => begin("move", arg.event.start, arg.event.end, arg.jsEvent, arg.el, {
      allDay: arg.event.allDay,
      itemId: String(arg.event.extendedProps.itemId ?? ""),
      occurrenceKey: String(arg.event.extendedProps.occurrenceKey ?? arg.event.id ?? ""),
      recurring: Boolean(arg.event.extendedProps.recurring),
      view,
      rangeStart,
      rangeEnd
    }),
    onResizeStart: (arg: EventResizeStartArg, view: CalendarViewKind, rangeStart?: Date, rangeEnd?: Date) => begin("resize", arg.event.start, arg.event.end, arg.jsEvent, arg.el, {
      allDay: arg.event.allDay,
      itemId: String(arg.event.extendedProps.itemId ?? ""),
      occurrenceKey: String(arg.event.extendedProps.occurrenceKey ?? arg.event.id ?? ""),
      recurring: Boolean(arg.event.extendedProps.recurring),
      view,
      rangeStart,
      rangeEnd
    })
  };
}
