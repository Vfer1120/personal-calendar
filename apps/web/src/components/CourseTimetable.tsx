import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { expandItems, isCalendarKind, type ExpandedItem, type Item, type SchedulePeriod, type SchedulePeriodInput, type Tag, type Timetable } from "@calendar/domain";
import { ApiError, api, apiJson } from "../lib/api";
import { cacheSchedulePeriods, cacheTimetables, getCachedSchedulePeriods, getCachedTimetables } from "../lib/offline";
import { CourseEditor } from "./CourseEditor";
import { PRIORITY_META } from "../lib/priority";

interface CourseTimetableProps {
  userId: string;
  items: ExpandedItem[];
  tags: Tag[];
  anchor: Date;
  onChanged: (item?: Item, deleted?: boolean) => void;
}

function mondayOf(date: Date): Date { const value = new Date(date); const day = value.getDay(); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - (day === 0 ? 6 : day - 1)); return value; }
function minutes(value: string): number { const [hour, minute] = value.split(":").map(Number); return (hour ?? 0) * 60 + (minute ?? 0); }
function toDateAt(day: Date, time: string): Date { const date = new Date(day); const [hour, minute] = time.split(":").map(Number); date.setHours(hour ?? 0, minute ?? 0, 0, 0); return date; }
function occurrenceForDay(occurrence: { start: Date; end: Date }, day: Date): { start: Date; end: Date } | null {
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  if (occurrence.end <= dayStart || occurrence.start >= dayEnd) return null;
  return { start: new Date(Math.max(occurrence.start.getTime(), dayStart.getTime())), end: new Date(Math.min(occurrence.end.getTime(), dayEnd.getTime())) };
}
function periodSpan(day: Date, occurrence: { start: Date; end: Date }, periods: SchedulePeriod[]) {
  const windowStart = occurrence.start.getDate() === day.getDate() && occurrence.start.getMonth() === day.getMonth() ? occurrence.start : toDateAt(day, "00:00");
  const windowEnd = occurrence.end.getTime() > windowStart.getTime() ? occurrence.end : new Date(windowStart.getTime() + 60 * 60_000);
  const startIndex = periods.findIndex((period) => minutes(period.endTime) > windowStart.getHours() * 60 + windowStart.getMinutes());
  let endIndex = periods.findIndex((period) => minutes(period.startTime) >= windowEnd.getHours() * 60 + windowEnd.getMinutes());
  if (endIndex < 0) endIndex = periods.length;
  if (startIndex < 0) return null;
  return { startIndex, endIndex: Math.max(startIndex + 1, endIndex) };
}

export function CourseTimetable({ userId, items, tags, anchor, onChanged }: CourseTimetableProps) {
  const queryClient = useQueryClient();
  const storageKey = `active-timetable:${userId}`;
  const [activeTimetableId, setActiveTimetableId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [editingPeriods, setEditingPeriods] = useState(false);
  const [draftPeriods, setDraftPeriods] = useState<SchedulePeriodInput[]>([]);
  const [periodMessage, setPeriodMessage] = useState("");
  const [pageEditor, setPageEditor] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);
  const [pageName, setPageName] = useState("");
  const [pageSemester, setPageSemester] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [courseEditorOpen, setCourseEditorOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<ExpandedItem | null>(null);
  const [editingOccurrence, setEditingOccurrence] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [courseDefaults, setCourseDefaults] = useState<{ startAt: string; endAt: string } | null>(null);
  const [selection, setSelection] = useState<{ startDay: number; startPeriod: number; endDay: number; endPeriod: number } | null>(null);
  const selectionRef = useRef<typeof selection>(null);
  const draggingRef = useRef(false);

  const timetablesQuery = useQuery({
    queryKey: ["timetables", userId],
    queryFn: async () => {
      try {
        const response = await api<{ timetables: Timetable[] }>("/api/v1/timetables");
        await cacheTimetables(response.timetables);
        return response;
      } catch {
        return { timetables: await getCachedTimetables() };
      }
    }
  });
  const timetables = timetablesQuery.data?.timetables ?? [];
  useEffect(() => {
    if (timetables.length === 0) return;
    if (!activeTimetableId || !timetables.some((page) => page.id === activeTimetableId)) {
      setActiveTimetableId(timetables[0]!.id);
    }
  }, [activeTimetableId, timetables]);
  useEffect(() => {
    if (activeTimetableId) localStorage.setItem(storageKey, activeTimetableId);
  }, [activeTimetableId, storageKey]);
  const activeTimetable = timetables.find((page) => page.id === activeTimetableId) ?? null;

  const periodsQuery = useQuery({
    queryKey: ["schedule-periods", activeTimetableId],
    enabled: Boolean(activeTimetableId),
    queryFn: async () => {
      try {
        const response = await api<{ periods: SchedulePeriod[] }>(`/api/v1/timetables/${activeTimetableId}/periods`);
        await cacheSchedulePeriods(activeTimetableId!, response.periods);
        return response;
      } catch {
        return { periods: await getCachedSchedulePeriods(activeTimetableId!) };
      }
    }
  });
  const periods = periodsQuery.data?.periods ?? [];
  const weekStart = mondayOf(anchor);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7); weekEnd.setMilliseconds(-1);
  const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(weekStart); day.setDate(day.getDate() + index); return day; });
  const semesterDate = activeTimetable?.semesterStartDate ? new Date(`${activeTimetable.semesterStartDate}T12:00:00`) : null;
  const pageItems = useMemo(() => items.filter((item) => item.timetableId === activeTimetableId || (!item.timetableId && item.showInTimetable)), [activeTimetableId, items]);
  const occurrences = useMemo(() => expandItems(pageItems, weekStart, weekEnd, semesterDate).filter((occurrence) => occurrence.item.showInTimetable && isCalendarKind(occurrence.item.kind)), [pageItems, semesterDate, weekStart.getTime(), weekEnd.getTime()]);

  function updateSelection(next: typeof selection) { selectionRef.current = next; setSelection(next); }
  function selectionTarget(event: PointerEvent | ReactPointerEvent) { const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-course-cell]"); if (!element) return null; return { day: Number(element.dataset.courseDay), period: Number(element.dataset.coursePeriod) }; }
  function beginSelection(event: ReactPointerEvent<HTMLButtonElement>, day: number, period: number) { if (event.button !== 0) return; event.preventDefault(); draggingRef.current = true; (event.currentTarget.closest(".course-grid") as HTMLElement | null)?.setPointerCapture(event.pointerId); updateSelection({ startDay: day, startPeriod: period, endDay: day, endPeriod: period }); }
  function moveSelection(event: ReactPointerEvent<HTMLDivElement>) { if (!draggingRef.current || !selectionRef.current) return; const target = selectionTarget(event); if (!target) return; const start = selectionRef.current; updateSelection({ startDay: Math.min(start.startDay, target.day), endDay: Math.max(start.startDay, target.day), startPeriod: Math.min(start.startPeriod, target.period), endPeriod: Math.max(start.startPeriod, target.period) }); }
  function finishSelection() {
    const value = selectionRef.current; draggingRef.current = false; updateSelection(null);
    if (!value || !activeTimetableId) return;
    const firstDay = days[value.startDay]; const lastDay = days[value.endDay]; const firstPeriod = periods[value.startPeriod]; const lastPeriod = periods[value.endPeriod];
    if (firstDay && lastDay && firstPeriod && lastPeriod) { setEditingCourse(null); setEditingOccurrence(null); setEditingSlot(null); setCourseDefaults({ startAt: toDateAt(firstDay, firstPeriod.startTime).toISOString(), endAt: toDateAt(lastDay, lastPeriod.endTime).toISOString() }); setCourseEditorOpen(true); }
  }
  function openCourse(item: ExpandedItem, occurrenceKey: string) { const parts = occurrenceKey.split(":"); const slotId = item.courseSlots.find((slot) => parts.includes(slot.id ?? ""))?.id ?? null; setEditingCourse(item); setEditingOccurrence(occurrenceKey); setEditingSlot(slotId); setCourseDefaults(null); setCourseEditorOpen(true); }
  function selected(day: number, period: number) { return Boolean(selection && day >= selection.startDay && day <= selection.endDay && period >= selection.startPeriod && period <= selection.endPeriod); }
  function movePeriod(index: number, direction: number) { const target = index + direction; if (target < 0 || target >= draftPeriods.length) return; setDraftPeriods((current) => { const next = [...current]; const [value] = next.splice(index, 1); next.splice(target, 0, value!); return next; }); }
  function startEditingPeriods() { setDraftPeriods(periods.map((period) => ({ name: period.name, startTime: period.startTime, endTime: period.endTime, sortOrder: period.sortOrder }))); setPeriodMessage(""); setEditingPeriods(true); }
  async function savePeriods() { if (!activeTimetableId) return; try { const response = await apiJson<{ periods: SchedulePeriod[] }>(`/api/v1/timetables/${activeTimetableId}/periods`, "PUT", { periods: draftPeriods.map((period, index) => ({ ...period, sortOrder: index })) }); queryClient.setQueryData(["schedule-periods", activeTimetableId], response); await cacheSchedulePeriods(activeTimetableId, response.periods); setEditingPeriods(false); } catch (error) { setPeriodMessage(error instanceof Error ? error.message : "保存失败"); } }
  async function refreshTimetables() { await queryClient.invalidateQueries({ queryKey: ["timetables", userId] }); }
  function openCreatePage() { setPageName(`课表${timetables.length + 1}`); setPageSemester(""); setPageMessage(""); setPageEditor({ mode: "create" }); }
  function openEditPage() { if (!activeTimetable) return; setPageName(activeTimetable.name); setPageSemester(activeTimetable.semesterStartDate ?? ""); setPageMessage(""); setPageEditor({ mode: "edit", id: activeTimetable.id }); }
  async function savePage() { if (!pageName.trim()) { setPageMessage("请输入课表名称"); return; } try { if (pageEditor?.mode === "edit" && pageEditor.id) { const response = await apiJson<{ timetable: Timetable }>(`/api/v1/timetables/${pageEditor.id}`, "PATCH", { name: pageName.trim(), semesterStartDate: pageSemester || null }); setActiveTimetableId(response.timetable.id); } else { const response = await apiJson<{ timetable: Timetable }>("/api/v1/timetables", "POST", { name: pageName.trim(), semesterStartDate: pageSemester || null }); setActiveTimetableId(response.timetable.id); } setPageEditor(null); await refreshTimetables(); } catch (error) { setPageMessage(error instanceof Error ? error.message : "保存失败"); } }
  async function deletePage() { if (!activeTimetable) return; if (!window.confirm(`删除课表“${activeTimetable.name}”？页面内有课程时无法删除。`)) return; try { await apiJson(`/api/v1/timetables/${activeTimetable.id}`, "DELETE"); setActiveTimetableId(null); await refreshTimetables(); setPageEditor(null); } catch (error) { setPageMessage(error instanceof ApiError ? error.message : "删除失败"); } }

  return <section className="course-timetable">
    <div className="course-toolbar">
      <div className="course-page-switcher">
        {timetables.map((page) => <button key={page.id} onClick={() => setActiveTimetableId(page.id)} className={`course-page-tab ${page.id === activeTimetableId ? "active" : ""}`}>{page.name}</button>)}
        <button onClick={openCreatePage} className="course-icon-button" title="新建课表"><Plus size={15}/></button>
      </div>
      <div className="course-toolbar-actions">
        <button onClick={openEditPage} className="course-icon-button" disabled={!activeTimetable} title="课表设置"><Settings2 size={15}/></button>
        <button onClick={startEditingPeriods} className="course-action-button" disabled={!activeTimetable}><Pencil size={14}/>节次</button>
      </div>
    </div>

    {periods.length === 0 ? <div className="course-empty-state">正在准备课表节次…</div> : <div className="course-scroll"><div className="course-grid" style={{ "--course-period-count": periods.length } as CSSProperties} onPointerMove={moveSelection} onPointerUp={finishSelection} onPointerCancel={finishSelection}>
      <div className="course-corner">节次</div>
      {days.map((day, index) => <div key={index} className="course-day-head"><strong>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index]}</strong><span>{day.getMonth() + 1}/{day.getDate()}</span></div>)}
      {periods.flatMap((period, periodIndex) => [
        <div key={period.id} className="course-period-label"><strong>{period.name}</strong><span>{period.startTime}</span><span>{period.endTime}</span></div>,
        ...days.map((day, dayIndex) => <button key={`${period.id}-${dayIndex}`} data-course-cell data-course-day={dayIndex} data-course-period={periodIndex} onPointerDown={(event) => beginSelection(event, dayIndex, periodIndex)} className={`course-empty ${selected(dayIndex, periodIndex) ? "course-cell-selected" : ""}`} style={{ gridColumn: dayIndex + 2, gridRow: periodIndex + 2 }} aria-label={`选择${period.name}课程`}/>)
      ])}
      {occurrences.filter((occurrence) => !occurrence.allDay).flatMap((occurrence) => days.map((day, dayIndex) => { const onDay = occurrenceForDay(occurrence, day); if (!onDay) return null; const span = periodSpan(day, onDay, periods); if (!span) return null; const tag = tags.find((value) => occurrence.item.tagIds.includes(value.id)); const color = occurrence.item.timetableColor ?? tag?.color ?? PRIORITY_META[occurrence.item.priority].eventColor; const conflict = occurrences.some((other) => other.occurrenceKey !== occurrence.occurrenceKey && !other.allDay && days.some((otherDay) => otherDay.toDateString() === day.toDateString() && occurrenceForDay(other, otherDay) && periodSpan(day, occurrenceForDay(other, otherDay)!, periods) && periodSpan(day, occurrenceForDay(other, otherDay)!, periods)!.startIndex < span.endIndex && periodSpan(day, occurrenceForDay(other, otherDay)!, periods)!.endIndex > span.startIndex)); const exactTime = `${occurrence.start.getHours().toString().padStart(2, "0")}:${occurrence.start.getMinutes().toString().padStart(2, "0")}`; return <button key={`${occurrence.occurrenceKey}-${dayIndex}`} onClick={() => openCourse(occurrence.item, occurrence.occurrenceKey)} className="course-event" style={{ gridColumn: dayIndex + 2, gridRow: `${span.startIndex + 2} / ${span.endIndex + 2}`, "--course-color": color } as CSSProperties} title={`${occurrence.item.title} ${exactTime}-${occurrence.end.getHours().toString().padStart(2, "0")}:${occurrence.end.getMinutes().toString().padStart(2, "0")}`}><span className="course-event-title">{occurrence.item.title}</span><span className="course-event-time">{exactTime}</span>{occurrence.item.location && <span className="course-event-location">@{occurrence.item.location}</span>}{conflict && <span className="course-conflict">冲突</span>}</button>; }))}
    </div></div>}

    {editingPeriods && <div className="course-modal-mask" onClick={() => setEditingPeriods(false)}><div className="course-modal" onClick={(event) => event.stopPropagation()}><div className="course-modal-head"><div><h3>编辑节次</h3><p>{activeTimetable?.name} · 独立节次</p></div><button onClick={() => setEditingPeriods(false)}><X size={17}/></button></div><div className="course-period-editor">{draftPeriods.map((period, index) => <div key={index} className="course-period-row"><input value={period.name} onChange={(event) => setDraftPeriods((current) => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} placeholder="名称"/><input type="time" value={period.startTime} onChange={(event) => setDraftPeriods((current) => current.map((item, position) => position === index ? { ...item, startTime: event.target.value } : item))}/><input type="time" value={period.endTime} onChange={(event) => setDraftPeriods((current) => current.map((item, position) => position === index ? { ...item, endTime: event.target.value } : item))}/><div><button onClick={() => movePeriod(index, -1)} title="上移"><ChevronUp size={14}/></button><button onClick={() => movePeriod(index, 1)} title="下移"><ChevronDown size={14}/></button><button onClick={() => setDraftPeriods((current) => current.filter((_, position) => position !== index))} title="删除"><Trash2 size={14}/></button></div></div>)}</div><button className="course-add-period" onClick={() => setDraftPeriods((current) => [...current, { name: String(current.length + 1), startTime: "08:00", endTime: "08:45", sortOrder: current.length }])}><Plus size={14}/>添加节次</button>{periodMessage && <p className="course-modal-message">{periodMessage}</p>}<div className="course-modal-actions"><button disabled={draftPeriods.length === 0} onClick={() => void savePeriods()} className="primary">保存节次</button><button onClick={() => setEditingPeriods(false)}>取消</button></div></div></div>}

    {pageEditor && <div className="course-modal-mask" onClick={() => setPageEditor(null)}><div className="course-modal course-page-modal" onClick={(event) => event.stopPropagation()}><div className="course-modal-head"><div><h3>{pageEditor.mode === "create" ? "新建课表" : "课表设置"}</h3><p>课程、节次和学期日期互不影响</p></div><button onClick={() => setPageEditor(null)}><X size={17}/></button></div><label>名称<input value={pageName} onChange={(event) => setPageName(event.target.value)} maxLength={30}/></label><label>第 1 周周一<input type="date" value={pageSemester} onChange={(event) => setPageSemester(event.target.value)}/></label>{pageMessage && <p className="course-modal-message">{pageMessage}</p>}<div className="course-modal-actions"><button onClick={() => void savePage()} className="primary">保存</button>{pageEditor.mode === "edit" && <button onClick={() => void deletePage()} className="danger">删除课表</button>}<button onClick={() => setPageEditor(null)}>取消</button></div></div></div>}

    <CourseEditor open={courseEditorOpen} item={editingCourse} occurrenceKey={editingOccurrence} slotId={editingSlot} defaults={courseDefaults} tags={tags} timetables={timetables} timetableId={activeTimetableId} onClose={() => setCourseEditorOpen(false)} onSaved={(savedItem, deleted) => onChanged(savedItem, deleted)} />
  </section>;
}