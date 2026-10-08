import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Image as ImageIcon, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import type { AiDraft, AiStatus, ExpandedItem, SchedulePeriod, Tag, Timetable } from "@calendar/domain";
import { ApiError, api, apiJson } from "../lib/api";
import { cacheSchedulePeriods, cacheTimetables, getCachedSchedulePeriods, getCachedTimetables } from "../lib/offline";
import { compressImage, draftToItemPayload, isPossibleDuplicate, localDateTimeInput, valueToIso } from "../lib/ai";
import { PRIORITY_META } from "../lib/priority";

interface AiImportDialogProps { userId: string; open: boolean; onClose: () => void; onImported: () => void; tags: Tag[]; items: ExpandedItem[]; demoMode?: boolean; }
interface PageContext extends Timetable { periods: SchedulePeriod[] }

function exactTime(value?: string | null): string { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return date.toISOString(); }

export function AiImportDialog({ userId, open, onClose, onImported, tags, items, demoMode = false }: AiImportDialogProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forceAvailable, setForceAvailable] = useState(false);
  const [targetTimetableId, setTargetTimetableId] = useState<string | null>(null);
  const [pagePeriods, setPagePeriods] = useState<Record<string, SchedulePeriod[]>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  const timetablesQuery = useQuery({ queryKey: ["timetables", userId], queryFn: async () => { try { const value = await api<{ timetables: Timetable[] }>("/api/v1/timetables"); await cacheTimetables(value.timetables); return value.timetables; } catch { return getCachedTimetables(); } } });
  const timetables = timetablesQuery.data ?? [];
  const activeTimetable = timetables.find((page) => page.id === targetTimetableId) ?? timetables[0] ?? null;

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);
  useEffect(() => {
    if (!open) return;
    setError(""); setForceAvailable(false);
    void api<AiStatus>("/api/v1/ai/status").then(setStatus).catch(() => setStatus(null));
    void queryClient.invalidateQueries({ queryKey: ["timetables", userId] });
    const stored = localStorage.getItem(`active-timetable:${userId}`);
    setTargetTimetableId(stored);
  }, [open, queryClient, userId]);

  async function loadPeriods(timetableId: string): Promise<SchedulePeriod[]> {
    if (pagePeriods[timetableId]) return pagePeriods[timetableId]!;
    try { const value = await api<{ periods: SchedulePeriod[] }>(`/api/v1/timetables/${timetableId}/periods`); await cacheSchedulePeriods(timetableId, value.periods); setPagePeriods((current) => ({ ...current, [timetableId]: value.periods })); return value.periods; }
    catch { const cached = await getCachedSchedulePeriods(timetableId); setPagePeriods((current) => ({ ...current, [timetableId]: cached })); return cached; }
  }
  useEffect(() => { if (activeTimetable) void loadPeriods(activeTimetable.id); }, [activeTimetable?.id]);
  async function context(): Promise<{ activeTimetableId: string | null; timetables: PageContext[] }> {
    const contexts = await Promise.all(timetables.map(async (page) => ({ ...page, periods: await loadPeriods(page.id) })));
    return { activeTimetableId: activeTimetable?.id ?? null, timetables: contexts };
  }
  async function addFiles(incoming: File[]) {
    const images = incoming.filter((file) => file.type.startsWith("image/")).slice(0, 3 - files.length);
    if (images.length === 0) return;
    try { const compressed = await Promise.all(images.map((file) => compressImage(file))); setFiles((current) => [...current, ...compressed].slice(0, 3)); setTab("image"); setError(""); }
    catch { setError("图片处理失败，请换一张图片重试"); }
  }
  async function extract() {
    if (!status?.configured) { setError("AI 尚未配置，请先在后端设置 AI_API_KEY 并启用 AI_ENABLED"); return; }
    setBusy(true); setError(""); setForceAvailable(false);
    try {
      const timetableContext = await context();
      const form = new FormData(); if (text.trim()) form.append("text", text.trim()); for (const file of files) form.append("images", file); form.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone); form.append("timetableContext", JSON.stringify(timetableContext));
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      let result: { drafts: AiDraft[]; transcript: string; provider: string; model: string };
      if (files.length > 0 && totalBytes > 3_500_000) {
        const uploads = [];
        for (const file of files) { const init = await apiJson<{ uploadUrl: string; uploadToken: string; headers: Record<string, string> }>("/api/v1/ai/uploads/init", "POST", { fileName: file.name, mimeType: file.type, size: file.size }); const upload = await fetch(init.uploadUrl, { method: "PUT", headers: init.headers, body: file }); if (!upload.ok) throw new Error(`图片上传失败 (${upload.status})`); uploads.push({ uploadToken: init.uploadToken, fileName: file.name, mimeType: file.type, size: file.size }); }
        result = await api("/api/v1/ai/extract", { method: "POST", body: JSON.stringify({ text: text.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, images: uploads, timetableContext }), timeoutMs: 120000 });
      } else result = await api("/api/v1/ai/extract", { method: "POST", body: form, timeoutMs: 120000 });
      setDrafts(result.drafts); if (result.drafts.length === 0) setError("没有识别到可导入的日程、任务或课程");
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "AI 提取失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  function updateDraft(index: number, patch: Partial<AiDraft>) { setDrafts((current) => current.map((draft, position) => position === index ? { ...draft, ...patch } : draft)); setError(""); setForceAvailable(false); }
  function updateSlot(index: number, slotIndex: number, patch: Partial<AiDraft["courseSlots"][number]>) { setDrafts((current) => current.map((draft, position) => position === index ? { ...draft, courseSlots: draft.courseSlots.map((slot, position2) => position2 === slotIndex ? { ...slot, ...patch } : slot) } : draft)); }
  function removeSlot(index: number, slotIndex: number) { setDrafts((current) => current.map((draft, position) => position === index ? { ...draft, courseSlots: draft.courseSlots.filter((_, position2) => position2 !== slotIndex) } : draft)); }
  function removeDraft(index: number) { setDrafts((current) => current.filter((_, position) => position !== index)); }
  function mismatch(draft: AiDraft): boolean {
    if (draft.importTarget !== "timetable" || draft.courseSlots.length === 0) return false;
    const periods = (draft.timetableId ? pagePeriods[draft.timetableId] : undefined) ?? [];
    return periods.length > 0 && draft.courseSlots.some((slot) => !periods.some((period) => period.startTime === slot.startTime && period.endTime === slot.endTime));
  }
  async function resolveMismatch(draft: AiDraft, mode: "keep" | "update") {
    if (mode === "keep") { setDrafts((current) => current.map((value) => value.title === draft.title && value.timetableId === draft.timetableId ? { ...value, periodMatch: "mapped" } : value)); return; }
    if (!draft.timetableId) return;
    const unique = new Map<string, { startTime: string; endTime: string }>();
    for (const slot of draft.courseSlots) unique.set(`${slot.startTime}-${slot.endTime}`, { startTime: slot.startTime, endTime: slot.endTime });
    const periods = [...unique.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((value, index) => ({ name: String(index + 1), startTime: value.startTime, endTime: value.endTime, sortOrder: index }));
    if (periods.length === 0) return;
    const response = await apiJson<{ periods: SchedulePeriod[] }>(`/api/v1/timetables/${draft.timetableId}/periods`, "PUT", { periods });
    setPagePeriods((current) => ({ ...current, [draft.timetableId!]: response.periods }));
    setDrafts((current) => current.map((value) => value.title === draft.title && value.timetableId === draft.timetableId ? { ...value, periodMatch: "exact" } : value));
    await queryClient.invalidateQueries({ queryKey: ["schedule-periods", draft.timetableId] });
  }
  async function importDrafts(force = false) {
    if (drafts.length === 0) return;
    const unresolved = drafts.find((draft) => draft.importTarget === "timetable" && (draft.courseSlots.length === 0 || draft.periodMatch === "uncertain"));
    if (unresolved) { setError(`课程「${unresolved.title}」的上课时间尚未确定，请先编辑时间段或确认节次映射。`); return; }
    setBusy(true); setError("");
    try {
      for (const [index, raw] of drafts.entries()) {
        const draft = raw.kind === "event" && !raw.startAt && raw.importTarget !== "timetable" ? { ...raw, kind: raw.dueAt ? "task" as const : "both" as const } : raw;
        try { await api(`/api/v1/items${force ? "?force=true" : ""}`, { method: "POST", body: JSON.stringify(draftToItemPayload(draft, tags)) }); }
        catch (cause) { if (cause instanceof ApiError && cause.status === 409) { setDrafts(drafts.slice(index)); setError("导入结果可能与已有课程冲突。你可以在预览中修改，或点击“仍然导入”。"); setForceAvailable(true); return; } throw cause; }
      }
      setDrafts([]); setText(""); setFiles([]); onImported(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  const configured = status?.configured ?? false;

  return <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-stone-950/45 backdrop-blur-sm"/><Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[94vh] overflow-y-auto rounded-t-3xl border border-app bg-[var(--surface)] p-5 shadow-2xl sm:inset-x-4 sm:bottom-4 sm:mx-auto sm:max-w-3xl sm:rounded-3xl">
    <div className="flex items-start justify-between"><div><Dialog.Title className="flex items-center gap-2 text-xl font-black"><Sparkles size={19}/>AI 导入</Dialog.Title><Dialog.Description className="muted mt-1 text-sm">长文本、课表图片、作业截图都可以识别；时间不确定时不会强行导入。</Dialog.Description></div><Dialog.Close className="grid size-10 place-items-center rounded-full hover-surface"><X size={18}/></Dialog.Close></div>
    <div className="mt-4 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${configured ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>{configured ? `${status?.provider} · ${status?.textModel}` : "未配置 AI Key"}</span><div className="ml-auto flex rounded-xl border border-app p-1"><button onClick={() => setTab("text")} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${tab === "text" ? "bg-orange-500 text-stone-950" : "muted"}`}>文字</button><button onClick={() => setTab("image")} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${tab === "image" ? "bg-orange-500 text-stone-950" : "muted"}`}>图片</button></div></div>
    {timetables.length > 0 && <label className="mt-4 block text-sm font-bold">课表导入目标页面<select value={activeTimetable?.id ?? ""} onChange={(event) => setTargetTimetableId(event.target.value)} className="mt-1 w-full rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2.5"><option value="">自动选择</option>{timetables.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>}
    {tab === "text" ? <textarea value={text} onChange={(event) => setText(event.target.value)} className="mt-4 min-h-44 w-full rounded-2xl border border-app bg-[var(--input-bg)] p-4" placeholder="粘贴通知、课程安排、作业要求或课表文字…"/> : <div className="mt-4 rounded-2xl border border-dashed border-app p-4" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}/><button onClick={() => fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-app p-5 font-bold"><Upload size={17}/>选择或拖入图片</button>{previews.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">{previews.map((preview) => <div key={preview.url} className="relative"><img src={preview.url} alt="" className="h-24 w-full rounded-xl object-cover"/><button onClick={() => setFiles((current) => current.filter((file) => file !== preview.file))} className="absolute right-1 top-1 rounded-full bg-stone-950/70 p-1 text-white"><X size={12}/></button></div>)}</div>}</div>}
    {drafts.length > 0 && <div className="mt-5 space-y-3">{drafts.map((draft, index) => <div key={`${draft.title}-${index}`} className="rounded-2xl border border-app p-4"><div className="flex items-start gap-2"><div className="grid size-7 shrink-0 place-items-center rounded-full bg-orange-500 text-xs font-black text-stone-950">{index + 1}</div><div className="min-w-0 flex-1 space-y-3"><input value={draft.title} onChange={(event) => updateDraft(index, { title: event.target.value })} className="w-full rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 font-bold" placeholder="标题"/><div className="grid gap-2 sm:grid-cols-3"><select value={draft.importTarget} onChange={(event) => { const importTarget = event.target.value as AiDraft["importTarget"]; updateDraft(index, { importTarget, timetableId: importTarget === "timetable" ? activeTimetable?.id ?? draft.timetableId : null }); }} className="rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm"><option value="calendar">导入日历/任务</option><option value="timetable">导入课表</option></select><select value={draft.priority} onChange={(event) => updateDraft(index, { priority: event.target.value as AiDraft["priority"] })} className="rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm">{Object.keys(PRIORITY_META).map((value) => <option key={value} value={value}>{PRIORITY_META[value as AiDraft["priority"]].label}</option>)}</select>{draft.importTarget === "timetable" && <select value={draft.timetableId ?? ""} onChange={(event) => updateDraft(index, { timetableId: event.target.value || null })} className="rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm">{timetables.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select>}</div>
      {draft.importTarget === "timetable" ? <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-bold">每周时间段</span><span className="muted text-xs">{draft.periodMatch === "uncertain" ? "时间待确认" : draft.periodMatch === "mapped" ? "已按节次匹配" : "时间已识别"}</span></div>{draft.courseSlots.map((slot, slotIndex) => <div key={slot.id ?? slotIndex} className="grid gap-2 rounded-xl border border-app p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><select value={slot.weekday} onChange={(event) => updateSlot(index, slotIndex, { weekday: Number(event.target.value) })} className="rounded-lg border border-app bg-[var(--input-bg)] px-2 py-2 text-sm">{["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((label, value) => <option key={value} value={value}>{label}</option>)}</select><input type="time" value={slot.startTime} onChange={(event) => updateSlot(index, slotIndex, { startTime: event.target.value })} className="rounded-lg border border-app bg-[var(--input-bg)] px-2 py-2 text-sm"/><input type="time" value={slot.endTime} onChange={(event) => updateSlot(index, slotIndex, { endTime: event.target.value })} className="rounded-lg border border-app bg-[var(--input-bg)] px-2 py-2 text-sm"/><button onClick={() => removeSlot(index, slotIndex)} className="rounded-lg border border-red-300 px-2 text-danger dark:border-red-900"><X size={13}/></button></div>)}<button onClick={() => updateDraft(index, { courseSlots: [...draft.courseSlots, { weekday: 1, startTime: "08:00", endTime: "08:45", weekParity: "all" }] })} className="rounded-lg border border-dashed border-app px-3 py-1.5 text-xs font-bold">添加时间段</button>{mismatch(draft) && <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><p className="flex items-center gap-1 font-bold"><AlertTriangle size={13}/>识别时间与页面节次不一致</p><div className="mt-2 flex gap-2"><button onClick={() => void resolveMismatch(draft, "keep")} className="rounded-lg border border-amber-300 px-2 py-1 font-bold">沿用现有节次</button><button onClick={() => void resolveMismatch(draft, "update")} className="rounded-lg bg-amber-500 px-2 py-1 font-bold text-stone-950">更新页面节次</button></div></div>}</div> : <><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs muted">开始<input type="datetime-local" value={localDateTimeInput(draft.startAt)} onChange={(event) => updateDraft(index, { startAt: valueToIso(event.target.value) })} className="mt-1 w-full rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm"/></label><label className="text-xs muted">结束<input type="datetime-local" value={localDateTimeInput(draft.endAt)} onChange={(event) => updateDraft(index, { endAt: valueToIso(event.target.value) })} className="mt-1 w-full rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm"/></label><label className="text-xs muted">截止<input type="datetime-local" value={localDateTimeInput(draft.dueAt)} onChange={(event) => updateDraft(index, { dueAt: valueToIso(event.target.value) })} className="mt-1 w-full rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm"/></label><label className="text-xs muted">地点<input value={draft.location} onChange={(event) => updateDraft(index, { location: event.target.value })} className="mt-1 w-full rounded-xl border border-app bg-[var(--input-bg)] px-3 py-2 text-sm"/></label></div></>}
      {isPossibleDuplicate(draft, items) && <p className="flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-200"><AlertTriangle size={13}/>可能与现有数据重复</p>}{draft.warnings.map((warning) => <p key={warning} className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-200"><AlertTriangle className="mt-0.5 shrink-0" size={12}/>{warning}</p>)}</div><button onClick={() => removeDraft(index)} className="rounded-full p-2 text-danger hover-surface" title="移除此草稿"><X size={16}/></button></div></div>)}</div>}
    {error && <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-200"><AlertTriangle className="mt-0.5 shrink-0" size={15}/>{error}</p>}
    <div className="mt-5 flex flex-wrap items-center gap-2"><button disabled={busy || !configured || (!text.trim() && files.length === 0) || drafts.length > 0} onClick={() => void extract()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 font-bold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={17}/> : <Sparkles size={17}/>} {drafts.length > 0 ? "已完成提取" : "开始提取"}</button>{drafts.length > 0 && <button disabled={busy || drafts.some((draft) => !draft.title.trim())} onClick={() => void importDrafts(false)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white disabled:opacity-50"><Check size={17}/>导入 {drafts.length} 条</button>}{forceAvailable && <button disabled={busy} onClick={() => void importDrafts(true)} className="min-h-11 rounded-xl border border-red-300 px-4 font-bold text-danger disabled:opacity-50 dark:border-red-900">仍然导入</button>}{drafts.length > 0 && <button disabled={busy} onClick={() => { setDrafts([]); setText(""); setFiles([]); setError(""); }} className="min-h-11 rounded-xl border border-app px-4 text-sm font-bold">重新开始</button>}</div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}