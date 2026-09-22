import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventDragStopArg, EventResizeDoneArg, EventResizeStopArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarDays, CheckSquare2, ChevronLeft, ChevronRight, ListTodo, Menu, Moon, Plus, Search, Settings, Sparkles, Sun, WifiOff } from "lucide-react";
import { expandItems, isCalendarKind, type ExpandedItem, type Item, type ItemKind, type Priority, type Recurrence, type Tag } from "@calendar/domain";
import { authClient } from "./auth";
import { ApiError, api, apiJson } from "./lib/api";
import { readableTextColor } from "./lib/colors";
import { PRIORITY_META } from "./lib/priority";
import { useCalendarDragAutoScroll, type DragPreview } from "./hooks/useCalendarDragAutoScroll";
import { bootstrapOfflineData, cacheSettings, clearOfflineData, configureOfflineScope, getCachedItems, getCachedSettings, getCachedTags, getLastSession, pullChanges, queueMutation, requestPersistentStorage, saveLastSession, upsertCachedItem } from "./lib/offline";
import { findById, replaceById } from "./lib/itemCache";
import { normalizeOccurrenceTimes } from "./lib/calendarDrag";
import { AuthScreen } from "./components/AuthScreen";
import { DemoGate } from "./components/DemoGate";
import { AiImportDialog } from "./components/AiImportDialog";
import { CourseTimetable } from "./components/CourseTimetable";
import { ItemEditor } from "./components/ItemEditor";
import { ReminderCenter } from "./components/ReminderCenter";
import { SettingsPanel } from "./components/SettingsPanel";
import { TasksPanel } from "./components/TasksPanel";

interface Bootstrap { requiresSetup: boolean; ownerEmailConfigured: boolean; appName: string; demoMode: boolean; demoAuthenticated: boolean; demoExpiresAt: string | null; multiUser: boolean; registrationInviteRequired: boolean; }
interface OccurrenceView { id: string; occurrenceKey: string; itemId: string; title: string; description: string; location: string; startAt: string; endAt: string; isAllDay: boolean; kind: ItemKind; priority: Priority; status: string; tagIds: string[]; recurrence: unknown; overridden: boolean; }
type CalendarMode = "day" | "week" | "month" | "agenda" | "course";

function modeToView(mode: CalendarMode, mobile: boolean) { if (mode === "day") return "timeGridDay"; if (mode === "week") return mobile ? "timeGridDay" : "rollingSevenDays"; if (mode === "month") return "dayGridMonth"; return "listMonth"; }
function dayBounds(anchor: Date, mode: CalendarMode) { const start = new Date(anchor); const end = new Date(anchor); if (mode === "day") { start.setHours(0,0,0,0); end.setHours(23,59,59,999); } else if (mode === "week" || mode === "course") { start.setHours(0,0,0,0); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999); } else { start.setDate(1); start.setHours(0,0,0,0); end.setMonth(end.getMonth() + 1, 0); end.setHours(23,59,59,999); } return { start, end }; }
function weekStart(date: Date): Date { const value = new Date(date); const day = value.getDay(); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - (day === 0 ? 6 : day - 1)); return value; }
function academicWeekNumber(date: Date, semesterStartDate?: string | null): number | null { if (!semesterStartDate) return null; const target = weekStart(date); const anchor = weekStart(new Date(`${semesterStartDate}T12:00:00`)); return Math.floor((target.getTime() - anchor.getTime()) / (7 * 86400000)) + 1; }
function localDateValue(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function parseLocalDate(value: string): Date { const [year, month, day] = value.split("-").map(Number); return new Date(year!, month! - 1, day!, 12, 0, 0, 0); }
function localDateFromCell(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? new Date(year!, month! - 1, day!, 0, 0, 0, 0) : null;
}
function withLocalClock(target: Date, source: Date): Date {
  return new Date(target.getFullYear(), target.getMonth(), target.getDate(), source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
}
function calendarHitElement(clientX: number, clientY: number): HTMLElement | null {
  const elements = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
  return elements.find((element) => !element.closest(".fc-event, .fc-event-mirror, .fc-highlight") && element.closest(".calendar-shell")) ?? null;
}
function resolveDropDate(event: MouseEvent): Date | null {
  const element = calendarHitElement(event.clientX, event.clientY);
  if (!element) return null;
  const cell = element.closest<HTMLElement>(".fc-daygrid-day[data-date], .fc-timegrid-col[data-date]");
  return localDateFromCell(cell?.dataset.date);
}
function resolveDropAllDay(event: MouseEvent): boolean | null {
  const element = calendarHitElement(event.clientX, event.clientY);
  if (!element) return null;
  if (element.closest(".fc-daygrid-body") || element.closest(".fc-daygrid-event") || element.closest(".fc-timegrid-allday")) return true;
  if (element.closest(".fc-timegrid-col") || element.closest(".fc-timegrid-slot-lane")) return false;
  return null;
}
function formatDragDuration(start: Date, end: Date): string { const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)); const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours > 0 ? `${hours} 小时${rest ? ` ${rest} 分钟` : ""}` : `${rest} 分钟`; }
export function App() {
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: () => api<Bootstrap>("/api/v1/bootstrap") });
  const session = authClient.useSession();
  useEffect(() => {
    const user = session.data?.user;
    if (!user) return;
    saveLastSession({ userId: user.id, email: user.email, name: user.name, savedAt: new Date().toISOString() });
  }, [session.data?.user?.id]);
  useEffect(() => {
    const onOnline = () => { void session.refetch(); void bootstrap.refetch(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [session, bootstrap]);
  const cachedSession = !navigator.onLine ? getLastSession() : null;
  if ((bootstrap.isPending || session.isPending) && !cachedSession) return <div className="grid min-h-screen place-items-center"><div className="size-9 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500"/></div>;
  if (bootstrap.data?.demoMode) {
    if (!bootstrap.data.demoAuthenticated) return <DemoGate onEnter={() => { void bootstrap.refetch(); }} />;
    return <CalendarApp demoMode demoExpiresAt={bootstrap.data.demoExpiresAt} userId="demo" offlineSession={false} />;
  }
  const offlineUser = !session.data?.user ? cachedSession : null;
  if (!session.data?.user && !offlineUser) return <AuthScreen ownerEmailConfigured={bootstrap.data?.ownerEmailConfigured ?? false} requiresSetup={bootstrap.data?.requiresSetup ?? false} registrationInviteRequired={bootstrap.data?.registrationInviteRequired ?? false} onSignedIn={() => { void session.refetch(); void bootstrap.refetch(); }} />;
  return <CalendarApp demoMode={false} demoExpiresAt={null} userId={session.data?.user?.id ?? offlineUser!.userId} offlineSession={Boolean(offlineUser)} />;
}
function CalendarApp({ demoMode, demoExpiresAt, userId, offlineSession }: { demoMode: boolean; demoExpiresAt: string | null; userId: string; offlineSession: boolean }) {
  configureOfflineScope(userId); const queryClient = useQueryClient(); const calendarRef = useRef<FullCalendar>(null); const searchRef = useRef<HTMLInputElement>(null); const appHeaderRef = useRef<HTMLElement>(null); const pendingTaskIdsRef = useRef<Set<string>>(new Set()); const dragFallbackTokenRef = useRef(0); const dragAutoScroll = useCalendarDragAutoScroll();
  const [mode, setMode] = useState<CalendarMode>(() => window.innerWidth < 768 ? "day" : "week"); const [page, setPage] = useState<"calendar" | "tasks">("calendar");
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark"); const [anchor, setAnchor] = useState(new Date()); const [pickerDate, setPickerDate] = useState(new Date());
  const [range, setRange] = useState(() => dayBounds(new Date(), window.innerWidth < 768 ? "day" : "week")); const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false); const [searchOpen, setSearchOpen] = useState(false); const [aiOpen, setAiOpen] = useState(false); const [defaultShowInTimetable, setDefaultShowInTimetable] = useState(false); const [defaultRecurrenceFrequency, setDefaultRecurrenceFrequency] = useState<"" | Recurrence["frequency"]>(""); const [editorOpen, setEditorOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ExpandedItem | null>(null); const [selectedOccurrence, setSelectedOccurrence] = useState<string | null>(null); const [editorDefaults, setEditorDefaults] = useState<{ startAt: string; endAt: string; isAllDay: boolean } | null>(null); const [defaultKind, setDefaultKind] = useState<ItemKind>("event");
  const [online, setOnline] = useState(navigator.onLine); const [notice, setNotice] = useState(""); const [pendingTaskIds, setPendingTaskIds] = useState<ReadonlySet<string>>(() => new Set()); const [calendarHeaderOffset, setCalendarHeaderOffset] = useState(0);
  const itemsQuery = useQuery({ queryKey: ["items", userId], queryFn: bootstrapOfflineData }); const settingsQuery = useQuery({ queryKey: ["settings", userId], queryFn: async () => { try { const remote = await api<{ settings: { semesterStartDate: string | null; reminderSoundEnabled: boolean; icsUrl: string } }>("/api/v1/settings"); await cacheSettings(remote); return remote; } catch { const cached = await getCachedSettings<{ settings: { semesterStartDate: string | null; reminderSoundEnabled: boolean; icsUrl: string } }>(); if (cached) return cached; throw new Error("设置暂时不可用"); } } });
  const tagsQuery = useQuery({ queryKey: ["tags", userId], queryFn: async () => { const cached = await getCachedTags(); try { const remote = await api<{ tags: Tag[] }>("/api/v1/tags"); return remote.tags; } catch { return cached; } } });
  const occurrencesQuery = useQuery({ queryKey: ["occurrences", userId, range.start.toISOString(), range.end.toISOString()], queryFn: async () => {
    try { return (await api<{ occurrences: OccurrenceView[] }>(`/api/v1/items/occurrences?from=${range.start.toISOString()}&to=${range.end.toISOString()}`)).occurrences; }
    catch { return expandItems(await getCachedItems(), range.start, range.end).map((occurrence) => ({ id: occurrence.id, occurrenceKey: occurrence.occurrenceKey, itemId: occurrence.itemId, title: occurrence.item.title, description: occurrence.item.description, location: occurrence.item.location, startAt: occurrence.start.toISOString(), endAt: occurrence.end.toISOString(), isAllDay: occurrence.allDay, kind: occurrence.item.kind, priority: occurrence.item.priority, status: occurrence.item.status, tagIds: occurrence.item.tagIds, recurrence: occurrence.item.recurrence, overridden: occurrence.overridden })); }
  }, enabled: page === "calendar" });  useEffect(() => { document.documentElement.classList.toggle("dark", dark); localStorage.setItem("theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { void requestPersistentStorage(); }, [userId]);
  useEffect(() => { if (!offlineSession) return; setNotice("当前离线，正在使用本机数据"); }, [offlineSession]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { const on = () => { setOnline(true); void pullChanges().then(() => queryClient.invalidateQueries()); }; const off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, [queryClient]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return; if (event.key.toLowerCase() === "c") openNew(); if (event.key.toLowerCase() === "t") goToday(); if (event.key.toLowerCase() === "d") setMode("day"); if (event.key.toLowerCase() === "w") setMode("week"); if (event.key.toLowerCase() === "m") setMode("month"); if (event.key.toLowerCase() === "a") setMode("agenda"); if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); });
  useEffect(() => { calendarRef.current?.getApi().changeView(modeToView(mode, window.innerWidth < 768)); }, [mode]);
  useEffect(() => { const node = appHeaderRef.current; if (!node) return; const update = () => setCalendarHeaderOffset(node.getBoundingClientRect().height); update(); const observer = new ResizeObserver(update); observer.observe(node); window.addEventListener("resize", update); return () => { observer.disconnect(); window.removeEventListener("resize", update); }; }, [mode, page]);
  const items = itemsQuery.data ?? []; const tags = tagsQuery.data ?? [];
  const events: EventInput[] = useMemo(() => (occurrencesQuery.data ?? []).filter((occurrence) => isCalendarKind(occurrence.kind) && (!search || occurrence.title.toLowerCase().includes(search.toLowerCase()))).map((occurrence) => { const tag = tags.find((value) => occurrence.tagIds.includes(value.id)); const priority = PRIORITY_META[occurrence.priority]; const backgroundColor = tag?.color ?? priority.eventColor; return { id: occurrence.occurrenceKey, title: occurrence.title, start: occurrence.startAt, end: occurrence.endAt, allDay: occurrence.isAllDay, backgroundColor, textColor: readableTextColor(backgroundColor), borderColor: priority.eventColor, extendedProps: { itemId: occurrence.itemId, occurrenceKey: occurrence.occurrenceKey, recurring: Boolean(occurrence.recurrence), status: occurrence.status, kind: occurrence.kind }, classNames: [...(occurrence.status === "completed" ? ["opacity-70", "line-through"] : []), `priority-${occurrence.priority}`] }; }), [occurrencesQuery.data, search, tags]);
  const eventConstraint = useMemo(() => {
    if (mode === "week") return { start: range.start, end: range.end };
    if (mode === "month") {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 0, 0, 0, 0);
      return { start, end };
    }
    if (mode !== "day") return undefined;
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, [anchor, mode, range.end, range.start]);
  const dragRange = mode === "week" || mode === "month" ? eventConstraint : undefined;
  const refresh = () => { void queryClient.invalidateQueries(); };

  async function resetDemo() { await apiJson("/api/v1/demo/reset", "POST"); await clearOfflineData(); await queryClient.invalidateQueries(); setNotice("示例数据已重置"); }
  async function leaveDemo() { await apiJson("/api/v1/demo/leave", "POST"); await clearOfflineData(); window.location.reload(); }
  function writeItemCache(item: Item | ExpandedItem) {
    queryClient.setQueryData<ExpandedItem[]>(["items"], (current) => replaceById(current, item as ExpandedItem));
    queryClient.setQueriesData<OccurrenceView[]>({ queryKey: ["occurrences"] }, (current) => current?.map((value) => value.itemId === item.id ? { ...value, status: item.status } : value));
  }
  function setTaskPending(id: string, pending: boolean) {
    if (pending) pendingTaskIdsRef.current.add(id);
    else pendingTaskIdsRef.current.delete(id);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
  }
  function handleSaved(item: Item) { writeItemCache(item); void queryClient.invalidateQueries({ queryKey: ["occurrences"] }); }
  function handleDeleted(id: string) { queryClient.setQueryData<ExpandedItem[]>(["items"], (current) => (current ?? []).filter((value) => value.id !== id)); queryClient.setQueriesData<OccurrenceView[]>({ queryKey: ["occurrences"] }, (current) => current?.filter((value) => value.itemId !== id)); void queryClient.invalidateQueries({ queryKey: ["items"] }); void queryClient.invalidateQueries({ queryKey: ["occurrences"] }); }
  function goToday() { const today = new Date(); setPickerDate(today); setAnchor(today); if (mode !== "course") calendarRef.current?.getApi().today(); }
  function jumpToDate(value: string) { if (!value) return; const date = parseLocalDate(value); if (Number.isNaN(date.getTime())) return; setPickerDate(date); setAnchor(date); if (mode !== "course") calendarRef.current?.getApi().gotoDate(date); }
  function shift(direction: number) { if (mode === "course") { const date = new Date(anchor); date.setDate(date.getDate() + direction * 7); setAnchor(date); setPickerDate(date); return; } const calendar = calendarRef.current?.getApi(); if (!calendar) return; if (mode === "week" && window.innerWidth < 768) { const date = new Date(anchor); date.setDate(date.getDate() + direction * 7); calendar.gotoDate(date); return; } if (direction < 0) calendar.prev(); else calendar.next(); }
  function openNew(options: { date?: Date | null; start?: Date | null; end?: Date | null; allDay?: boolean; kind?: ItemKind; showInTimetable?: boolean; recurrenceFrequency?: "" | Recurrence["frequency"] } = {}) { const nextKind = options.kind ?? (page === "tasks" ? "task" : "event"); setSelectedItem(null); setSelectedOccurrence(null); setDefaultKind(nextKind); setDefaultShowInTimetable(options.showInTimetable ?? false); setDefaultRecurrenceFrequency(options.recurrenceFrequency ?? ""); if (nextKind === "task" && page === "tasks") { setEditorDefaults(null); } else { const start = options.start ?? options.date ?? new Date(); const end = options.end ?? new Date(start.getTime() + (options.allDay ? 86400000 - 1 : 3600000)); setEditorDefaults({ startAt: start.toISOString(), endAt: end.toISOString(), isAllDay: options.allDay ?? false }); } setEditorOpen(true); }
  function openItem(itemId: string, occurrenceKey?: string) { const item = items.find((value) => value.id === itemId) ?? null; if (!item) return; setSelectedItem(item); setSelectedOccurrence(occurrenceKey ?? null); setEditorDefaults(null); setEditorOpen(true); }
  function handleEventClick(value: EventClickArg) { openItem(value.event.extendedProps.itemId as string, value.event.extendedProps.occurrenceKey as string); }
  async function patchItemVersionSafe(item: ExpandedItem, fields: Record<string, unknown>, force = false) {
    const suffix = force ? "?force=true" : "";
    try {
      return await apiJson<{ item: Item }>(`/api/v1/items/${item.id}${suffix}`, "PATCH", { ...fields, baseVersion: item.version });
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== "VERSION_CONFLICT") throw cause;
      const current = (cause.payload as { current?: Item } | undefined)?.current;
      if (!current) throw cause;
      return apiJson<{ item: Item }>(`/api/v1/items/${item.id}${suffix}`, "PATCH", { ...fields, baseVersion: current.version });
    }
  }
  function updateOccurrenceTimes(itemId: string, occurrenceKey: string, startAt: string, endAt: string, isAllDay: boolean) {
    queryClient.setQueriesData<OccurrenceView[]>({ queryKey: ["occurrences"] }, (current) => current?.map((value) => value.itemId === itemId && value.occurrenceKey === occurrenceKey ? { ...value, startAt, endAt, isAllDay } : value));
  }
  function getCachedOccurrence(itemId: string, occurrenceKey: string) {
    const queries = queryClient.getQueriesData<OccurrenceView[]>({ queryKey: ["occurrences"] });
    for (const [, values] of queries) {
      const value = values?.find((entry) => entry.itemId === itemId && entry.occurrenceKey === occurrenceKey);
      if (value) return value;
    }
    return undefined;
  }
  async function persistOccurrenceTimes(change: { itemId: string; occurrenceKey: string; start: Date; end: Date; allDay: boolean; revert?: () => void; restore?: () => void }) {
    const item = findById(items, change.itemId);
    if (!item || !change.occurrenceKey) { change.revert?.(); change.restore?.(); return; }
    if (change.end.getTime() <= change.start.getTime()) { change.revert?.(); change.restore?.(); return; }
    const startAt = change.start.toISOString();
    const endAt = (change.allDay ? new Date(change.end.getTime() - 1) : change.end).toISOString();
    const onlyThis = Boolean(item.recurrence) && window.confirm("重复日程：选择“确定”仅调整本次，选择“取消”调整全部。");
    try {
      if (onlyThis) await apiJson(`/api/v1/items/${item.id}/exceptions/${encodeURIComponent(change.occurrenceKey)}`, "PUT", { action: "override", override: { startAt, endAt, isAllDay: change.allDay } });
      else { const updated = await patchItemVersionSafe(item, { startAt, endAt, isAllDay: change.allDay }, true); handleSaved(updated.item); }
      updateOccurrenceTimes(change.itemId, change.occurrenceKey, startAt, endAt, change.allDay);
      refresh();
    } catch {
      change.revert?.();
      change.restore?.();
    }
  }
  async function moveOccurrence(value: EventDropArg | EventResizeDoneArg, operation: "move" | "resize", preview?: DragPreview) {
    if (!value.event.start) return;
    const itemId = String(value.event.extendedProps.itemId);
    const occurrenceKey = String(value.event.extendedProps.occurrenceKey);
    const cachedOccurrence = getCachedOccurrence(itemId, occurrenceKey);
    const sourceItem = findById(items, itemId);
    const sourceStart = cachedOccurrence?.startAt ?? sourceItem?.startAt ?? null;
    const sourceEnd = cachedOccurrence?.endAt ?? sourceItem?.endAt ?? null;
    const originalStart = sourceStart ? new Date(sourceStart) : value.oldEvent?.start ?? value.event.start;
    const originalEnd = sourceEnd ? new Date(sourceEnd) : value.oldEvent?.end ?? value.event.end ?? new Date(originalStart.getTime() + 3600000);
    const rawEnd = value.event.end ?? new Date(value.event.start.getTime() + 3600000);
    const dropDate = (mode === "week" || mode === "month") ? resolveDropDate(value.jsEvent) : null;
    const dropAllDay = mode === "month" ? null : resolveDropAllDay(value.jsEvent);
    const usePreview = Boolean(preview && preview.itemId === itemId && preview.fallbackAllowed);
    const previewStart = usePreview && preview ? preview.start : value.event.start;
    const previewEnd = usePreview && preview ? preview.end : rawEnd;
    const dropTime = mode === "week" ? value.event.start : originalStart;
    const dropStart = dropDate ? new Date(dropDate.getFullYear(), dropDate.getMonth(), dropDate.getDate(), dropTime.getHours(), dropTime.getMinutes(), dropTime.getSeconds(), dropTime.getMilliseconds()) : previewStart;
    const candidateStart = usePreview && preview ? previewStart : (operation === "move" && dropDate ? dropStart : previewStart);
    const candidateEnd = usePreview && preview ? previewEnd : (operation === "move" && dropDate ? new Date(candidateStart.getTime() + originalEnd.getTime() - originalStart.getTime()) : previewEnd);
    const resolvedAllDay = usePreview && preview ? preview.allDay : (dropAllDay ?? value.event.allDay);
    const resizeEdge = operation === "resize" && value.oldEvent?.start && value.event.start.getTime() !== value.oldEvent.start.getTime() ? "start" : "end";
    const originalAllDay = cachedOccurrence?.isAllDay ?? sourceItem?.isAllDay ?? value.oldEvent?.allDay ?? value.event.allDay;
    const normalized = normalizeOccurrenceTimes({ view: mode as Exclude<CalendarMode, "course">, operation, resizeEdge, originalStart, originalEnd, candidateStart, candidateEnd, rangeStart: dragRange?.start, rangeEnd: dragRange?.end });
    if (normalized.start.getTime() === originalStart.getTime() && normalized.end.getTime() === originalEnd.getTime() && resolvedAllDay === originalAllDay) return;
    const normalizedEnd = originalAllDay && normalized.end.getMilliseconds() === 999 ? new Date(normalized.end.getTime() + 1) : normalized.end;
    await persistOccurrenceTimes({ itemId, occurrenceKey, start: normalized.start, end: normalizedEnd, allDay: resolvedAllDay, revert: value.revert });
  }
  async function moveOccurrenceFromPreview(preview: DragPreview) {
    if (!preview.fallbackAllowed || !preview.itemId || !preview.occurrenceKey) return;
    const previous = getCachedOccurrence(preview.itemId, preview.occurrenceKey);
    const sourceItem = findById(items, preview.itemId);
    const sourceStartAt = previous?.startAt ?? sourceItem?.startAt ?? null;
    const sourceEndAt = previous?.endAt ?? sourceItem?.endAt ?? null;
    const sourceStart = sourceStartAt ? new Date(sourceStartAt) : null;
    const sourceEnd = sourceEndAt ? new Date(sourceEndAt) : null;
    const originalAllDay = previous?.isAllDay ?? sourceItem?.isAllDay ?? preview.allDay;
    const preserveClock = preview.mode === "move" && (preview.view === "month" || originalAllDay !== preview.allDay);
    let changedStart = preview.start;
    let changedEnd = preview.end;
    if (preserveClock && sourceStart) {
      changedStart = withLocalClock(preview.start, sourceStart);
      const durationEnd = sourceEnd && originalAllDay && sourceEnd.getMilliseconds() === 999 ? new Date(sourceEnd.getTime() + 1) : sourceEnd;
      const duration = durationEnd ? durationEnd.getTime() - sourceStart.getTime() : changedEnd.getTime() - changedStart.getTime();
      changedEnd = new Date(changedStart.getTime() + Math.max(30 * 60_000, duration));
    }
    const normalized = normalizeOccurrenceTimes({
      view: preview.view,
      operation: preview.mode,
      resizeEdge: preview.resizeEdge,
      originalStart: sourceStart ?? preview.start,
      originalEnd: sourceEnd ?? preview.end,
      candidateStart: changedStart,
      candidateEnd: changedEnd,
      rangeStart: preview.rangeStart ?? dragRange?.start,
      rangeEnd: preview.rangeEnd ?? dragRange?.end
    });
    if (sourceStart && sourceEnd && normalized.start.getTime() === sourceStart.getTime() && normalized.end.getTime() === sourceEnd.getTime() && preview.allDay === originalAllDay) return;
    changedStart = normalized.start;
    changedEnd = originalAllDay && normalized.end.getMilliseconds() === 999 ? new Date(normalized.end.getTime() + 1) : normalized.end;
    updateOccurrenceTimes(preview.itemId, preview.occurrenceKey, changedStart.toISOString(), changedEnd.toISOString(), preview.allDay);
    await persistOccurrenceTimes({
      itemId: preview.itemId,
      occurrenceKey: preview.occurrenceKey,
      start: changedStart,
      end: changedEnd,
      allDay: preview.allDay,
      restore: () => { if (previous) updateOccurrenceTimes(preview.itemId, preview.occurrenceKey, previous.startAt, previous.endAt, previous.isAllDay); else void queryClient.invalidateQueries({ queryKey: ["occurrences"] }); }
    });
  }
  function handleDragStop() {
    dragAutoScroll.stop();
    const outcome = dragAutoScroll.getOutcome();
    if (!outcome.preview || outcome.cancelled) {
      dragAutoScroll.clearOutcome();
      return;
    }
    const token = ++dragFallbackTokenRef.current;
    window.setTimeout(() => {
      if (token !== dragFallbackTokenRef.current || !outcome.preview) return;
      dragAutoScroll.clearOutcome();
      void moveOccurrenceFromPreview(outcome.preview);
    }, 0);
  }
  function handleDrop(value: EventDropArg | EventResizeDoneArg, operation: "move" | "resize") {
    const preview = dragAutoScroll.getOutcome().preview ?? undefined;
    dragFallbackTokenRef.current += 1;
    dragAutoScroll.clearOutcome();
    void moveOccurrence(value, operation, preview);
  }
  async function resolveTask(item: ExpandedItem, outcome: "completed" | "partial" | "postponed" | "cancelled", occurrenceKey?: string | null, suggestion?: { startAt: string | null; endAt: string | null; dueAt: string | null }) { const resolvedOccurrenceKey = occurrenceKey ?? (item.recurrence ? expandItems([item], new Date(Date.now() - 86400000), new Date(Date.now() + 31 * 86400000)).sort((left, right) => left.start.getTime() - right.start.getTime())[0]?.occurrenceKey ?? null : null); const response = await apiJson<{ item: Item }>(`/api/v1/items/${item.id}/resolve`, "POST", { occurrenceKey: resolvedOccurrenceKey, outcome, ...(suggestion ?? {}) }); writeItemCache(response.item); void queryClient.invalidateQueries({ queryKey: ["occurrences"] }); void queryClient.invalidateQueries({ queryKey: ["reviews"] }); setNotice(outcome === "completed" ? "已完成" : outcome === "partial" ? "已标记为部分完成" : outcome === "postponed" ? "已顺延" : "已取消本次"); }
  async function toggleTask(item: ExpandedItem) {
    if (pendingTaskIdsRef.current.has(item.id)) return;
    setTaskPending(item.id, true);
    try {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["items"] }),
        queryClient.cancelQueries({ queryKey: ["occurrences"] })
      ]);
      const latest = findById(queryClient.getQueryData<ExpandedItem[]>(["items"]), item.id) ?? item;
      const completed = latest.status !== "completed";
      const optimistic = { ...latest, status: completed ? "completed" as const : "active" as const, completedAt: completed ? new Date().toISOString() : null } as ExpandedItem;
      writeItemCache(optimistic);
      try {
        const updated = await patchItemVersionSafe(latest, { status: optimistic.status, completedAt: optimistic.completedAt });
        writeItemCache(updated.item);
        void upsertCachedItem(updated.item).catch(() => undefined);
      } catch (cause) {
        if (cause instanceof TypeError) {
          void upsertCachedItem(optimistic).catch(() => undefined);
          void queueMutation({ entity: "item", action: "update", entityId: latest.id, baseVersion: latest.version, fields: { status: optimistic.status, completedAt: optimistic.completedAt } }).catch(() => undefined);
          setNotice("当前离线，完成状态将在恢复联网后同步");
          return;
        }
        writeItemCache(latest);
        setNotice("状态更新失败，请稍后重试");
      }
    } finally {
      setTaskPending(item.id, false);
    }
  }
  const title = mode === "course" ? `${academicWeekNumber(anchor, settingsQuery.data?.settings.semesterStartDate) ? `第 ${academicWeekNumber(anchor, settingsQuery.data?.settings.semesterStartDate)} 周 · ` : ""}${new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(weekStart(anchor))} - ${new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(weekStart(anchor).getTime() + 6 * 86400000))}` : mode === "week" ? `${new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(range.start)} - ${new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(range.end.getTime() - 1))}` : new Intl.DateTimeFormat("zh-CN", mode === "month" ? { year: "numeric", month: "long" } : mode === "agenda" ? { year: "numeric", month: "long" } : { year: "numeric", month: "long", day: "numeric" }).format(anchor);
  const navItems = [{ id: "calendar" as const, label: "日历", icon: CalendarDays }, { id: "tasks" as const, label: "任务", icon: ListTodo }];
  return <div className="min-h-screen md:grid md:h-screen md:grid-cols-[230px_minmax(0,1fr)] md:overflow-hidden">
    <aside className="hidden border-r border-app p-5 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:overflow-y-auto"><div className="mb-10 flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-orange-500 text-stone-950"><CalendarDays/></div><div><p className="font-black">个人日程</p><p className="muted text-xs">Personal Calendar</p></div></div><nav className="space-y-2">{navItems.map((item) => <button key={item.id} onClick={() => setPage(item.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 font-bold ${page === item.id ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200" : "hover-surface"}`}><item.icon size={19}/>{item.label}</button>)}<button onClick={() => setSearchOpen(true)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 font-bold hover-surface"><Search size={19}/>搜索</button><button onClick={() => setAiOpen(true)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 font-bold hover-surface"><Sparkles size={19}/>AI 导入</button></nav><div className="mt-auto space-y-2"><button onClick={() => setDark(!dark)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold">{dark ? <Sun size={17}/> : <Moon size={17}/>}{dark ? "浅色模式" : "深色模式"}</button><button onClick={() => setSettingsOpen(true)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold"><Settings size={17}/>设置</button><div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${online ? "text-success" : "text-danger"}`}><span className={`size-2 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`}/>{online ? "已同步" : "离线模式"}</div></div></aside>
    <main className="min-w-0 md:h-screen md:overflow-y-auto">
      <header ref={appHeaderRef} className="safe-top sticky top-0 z-30 glass border-b border-app px-4 py-3 md:px-6"><div className="flex items-center gap-3"><button onClick={() => setSettingsOpen(true)} className="grid size-10 place-items-center rounded-xl border border-app md:hidden"><Menu size={19}/></button><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-500">个人日程</p><h1 className="truncate text-lg font-black md:text-xl">{page === "calendar" ? title : "任务"}</h1>{demoMode && <p className="text-[10px] font-bold text-orange-500">体验站 · 24 小时后自动清理</p>}</div>{!online && <WifiOff className="text-danger" size={19}/>}<button onClick={() => setAiOpen(true)} className="grid size-11 place-items-center rounded-xl border border-app" title="AI 导入"><Sparkles size={18}/></button><button onClick={() => openNew()} className="grid size-11 place-items-center rounded-xl bg-orange-500 text-stone-950 shadow-lg shadow-orange-500/20"><Plus/></button></div>
        {page === "calendar" && <div className="mt-3 flex items-center gap-2"><button onClick={() => shift(-1)} className="grid size-10 place-items-center rounded-xl border border-app"><ChevronLeft size={18}/></button><button onClick={goToday} className="min-h-10 rounded-xl border border-app px-4 text-sm font-bold">今天</button><label className="relative flex items-center"><CalendarDays size={16} className="pointer-events-none absolute left-3 text-orange-500"/><input aria-label="跳转到日期" type="date" value={localDateValue(pickerDate)} onChange={(event) => jumpToDate(event.target.value)} className="min-h-10 w-40 rounded-xl border border-app bg-[var(--input-bg)] pl-9 pr-2 text-xs font-bold" /></label><button onClick={() => shift(1)} className="grid size-10 place-items-center rounded-xl border border-app"><ChevronRight size={18}/></button><div className="ml-auto hidden items-center gap-1 rounded-xl border border-app bg-[var(--surface-muted)] p-1 shadow-sm md:flex">{[["day","日"],["week","周"],["month","月"],["agenda","议程"],["course","课表"]].map(([value,label]) => <button key={value} onClick={() => setMode(value as CalendarMode)} className={`min-w-12 rounded-lg border px-3 py-2 text-xs font-bold transition ${mode === value ? "border-orange-500 bg-orange-500 text-stone-950 shadow-sm" : "border-transparent text-secondary hover-surface"}`}>{label}</button>)}</div></div>}
      </header>
      {dragAutoScroll.preview && <><div className="drag-scroll-mask drag-scroll-mask-top" aria-hidden="true"/><div className="drag-scroll-mask drag-scroll-mask-bottom" aria-hidden="true"/></>}
      {notice && <div role="status" className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-app bg-[var(--surface-elevated)] px-4 py-2 text-sm font-bold text-primary shadow-xl md:bottom-6">{notice}</div>}
      {dragAutoScroll.scrollDirection && <div className={`pointer-events-none fixed left-1/2 z-40 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full border border-orange-300 bg-white/90 text-orange-600 shadow-xl dark:bg-stone-900/90 ${dragAutoScroll.scrollDirection === "up" ? "top-24" : "bottom-24"}`}>{dragAutoScroll.scrollDirection === "up" ? <ArrowUp/> : <ArrowDown/>}</div>} {dragAutoScroll.preview && <div className={`pointer-events-none fixed left-1/2 top-24 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-bold shadow-xl ${dragAutoScroll.preview.end.getTime() - dragAutoScroll.preview.start.getTime() > 86400000 ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100" : "border-app bg-[var(--surface-elevated)] text-secondary"}`}>{dragAutoScroll.preview.start.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} → {dragAutoScroll.preview.end.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {formatDragDuration(dragAutoScroll.preview.start, dragAutoScroll.preview.end)}</div>} {searchOpen && <div className="fixed inset-0 z-50 bg-stone-950/40 p-4 backdrop-blur-sm" onClick={() => setSearchOpen(false)}><div className="mx-auto mt-16 max-w-2xl rounded-3xl bg-[var(--surface)] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center gap-2 rounded-2xl border border-app px-4"><Search size={20}/><input ref={searchRef} autoFocus className="min-h-12 flex-1 bg-transparent outline-none" placeholder="搜索标题、地点或备注" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setSearchOpen(false); setPage("calendar"); } }}/></div><div className="mt-3 max-h-80 overflow-y-auto">{items.filter((item) => !search || `${item.title} ${item.location} ${item.description}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20).map((item) => <button key={item.id} onClick={() => { setSearchOpen(false); openItem(item.id); }} className="flex w-full items-center justify-between rounded-xl p-3 text-left hover-surface"><span className="font-bold">{item.title}</span><span className="muted text-xs">{item.startAt ? new Date(item.startAt).toLocaleString("zh-CN") : "待安排"}</span></button>)}</div></div></div>}
      {page === "calendar" ? mode === "course" ? <CourseTimetable items={items} tags={tags} anchor={anchor} semesterStartDate={settingsQuery.data?.settings.semesterStartDate ?? null} onChanged={refresh} /> : <section className="calendar-shell min-h-[calc(100vh-150px)] p-2 md:p-5" style={{ "--calendar-header-offset": `${calendarHeaderOffset}px` } as CSSProperties}><FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView={modeToView(mode, window.innerWidth < 768)} views={{ rollingSevenDays: { type: "timeGrid", duration: { days: 7 }, dateIncrement: { days: 7 } } }} headerToolbar={false} locale="zh-cn" firstDay={1} weekends height="auto" editable eventStartEditable eventDurationEditable eventResizableFromStart slotEventOverlap={false} eventMaxStack={4} eventDragMinDistance={5} nowIndicator selectable selectMirror dayMaxEvents={4} fixedWeekCount={false} allDaySlot slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime="07:00:00" eventConstraint={eventConstraint} longPressDelay={300} eventLongPressDelay={300} events={events} dateClick={(value) => openNew({ start: value.date, end: new Date(value.date.getTime() + (value.allDay ? 86400000 - 1 : 3600000)), allDay: value.allDay })} select={(value) => { openNew({ start: value.start, end: value.allDay ? new Date(value.end.getTime() - 1) : value.end, allDay: value.allDay }); value.view.calendar.unselect(); }} eventClick={handleEventClick} eventDragStart={(arg) => dragAutoScroll.onDragStart(arg, mode as Exclude<CalendarMode, "course">, dragRange?.start, dragRange?.end)} eventResizeStart={(arg) => dragAutoScroll.onResizeStart(arg, mode as Exclude<CalendarMode, "course">, dragRange?.start, dragRange?.end)} eventDragStop={handleDragStop} eventResizeStop={handleDragStop} eventDrop={(value) => handleDrop(value, "move")} eventResize={(value) => handleDrop(value, "resize")} datesSet={(value) => { setAnchor(value.view.currentStart); setPickerDate(value.view.currentStart); setRange({ start: value.start, end: value.end }); }} /></section> : <TasksPanel items={items} tags={tags} pendingTaskIds={pendingTaskIds} onCreate={() => openNew({ kind: "task", date: null })} onOpen={(item) => openItem(item.id)} onToggle={toggleTask} onResolve={resolveTask} onRefresh={refresh} />}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-app glass px-2 pt-2 md:hidden"><button onClick={() => setPage("calendar")} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold ${page === "calendar" ? "text-orange-500" : "muted"}`}><CalendarDays size={20}/>日历</button><button onClick={() => setPage("tasks")} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold ${page === "tasks" ? "text-orange-500" : "muted"}`}><CheckSquare2 size={20}/>任务</button><button onClick={() => setSearchOpen(true)} className="muted flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold"><Search size={20}/>搜索</button><button onClick={() => setSettingsOpen(true)} className="muted flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold"><Settings size={20}/>设置</button></nav>
    </main>
    <AiImportDialog open={aiOpen} onClose={() => setAiOpen(false)} onImported={refresh} tags={tags} items={items} demoMode={demoMode} />
    <ItemEditor open={editorOpen} item={selectedItem} occurrenceKey={selectedOccurrence} defaultStartAt={editorDefaults?.startAt} defaultEndAt={editorDefaults?.endAt} defaultIsAllDay={editorDefaults?.isAllDay} defaultKind={defaultKind} semesterStartDate={settingsQuery.data?.settings.semesterStartDate ? String(settingsQuery.data.settings.semesterStartDate).slice(0, 10) : null} demoMode={demoMode} tags={tags} items={items} onClose={() => setEditorOpen(false)} onSaved={handleSaved} onDeleted={handleDeleted} />
    <SettingsPanel open={settingsOpen} dark={dark} onDarkChange={setDark} onClose={() => setSettingsOpen(false)} onDataChanged={refresh} demoMode={demoMode} demoExpiresAt={demoExpiresAt} onDemoReset={() => void resetDemo()} onDemoLeave={() => void leaveDemo()} />
    <ReminderCenter onResolved={refresh} soundEnabled={settingsQuery.data?.settings.reminderSoundEnabled ?? true} />
  </div>;
}
