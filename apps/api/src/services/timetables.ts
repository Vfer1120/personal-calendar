import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { appSettings, items, schedulePeriods, timetables } from "@calendar/db/schema";
import { DEFAULT_SCHEDULE_PERIODS, schedulePeriodListSchema, type SchedulePeriod, type Timetable } from "@calendar/domain";
import { db } from "../context";

const MAX_TIMETABLES = 20;

function toTimetable(row: typeof timetables.$inferSelect): Timetable {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    semesterStartDate: row.semesterStartDate ?? null
  };
}

async function seedPeriods(timetableId: string, workspaceId: string) {
  const existing = await db.select({ id: schedulePeriods.id }).from(schedulePeriods).where(eq(schedulePeriods.timetableId, timetableId)).limit(1);
  if (existing.length > 0) return;
  await db.insert(schedulePeriods).values(DEFAULT_SCHEDULE_PERIODS.map((period) => ({
    workspaceId,
    timetableId,
    name: period.name,
    startTime: period.startTime,
    endTime: period.endTime,
    sortOrder: period.sortOrder
  })));
}

export async function ensureDefaultTimetable(workspaceId: string): Promise<Timetable> {
  let [existing] = await db.select().from(timetables).where(eq(timetables.workspaceId, workspaceId)).orderBy(asc(timetables.sortOrder)).limit(1);
  if (!existing) {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.workspaceId, workspaceId)).limit(1);
    const [created] = await db.insert(timetables).values({
      workspaceId,
      name: "课表1",
      sortOrder: 0,
      semesterStartDate: settings?.semesterStartDate ?? null
    }).onConflictDoNothing().returning();
    existing = created ?? (await db.select().from(timetables).where(eq(timetables.workspaceId, workspaceId)).orderBy(asc(timetables.sortOrder)).limit(1))[0];
  }
  if (!existing) throw new Error("无法创建默认课表");
  await Promise.all([
    db.update(schedulePeriods).set({ timetableId: existing.id }).where(and(eq(schedulePeriods.workspaceId, workspaceId), isNull(schedulePeriods.timetableId))),
    db.update(items).set({ timetableId: existing.id }).where(and(eq(items.workspaceId, workspaceId), eq(items.showInTimetable, true), isNull(items.timetableId)))
  ]);
  await seedPeriods(existing.id, workspaceId);
  return toTimetable(existing);
}

export async function listTimetables(workspaceId: string): Promise<Timetable[]> {
  await ensureDefaultTimetable(workspaceId);
  const rows = await db.select().from(timetables).where(eq(timetables.workspaceId, workspaceId)).orderBy(asc(timetables.sortOrder), asc(timetables.createdAt));
  return rows.map(toTimetable);
}

async function ownedTimetable(workspaceId: string, timetableId: string) {
  const [row] = await db.select().from(timetables).where(and(eq(timetables.id, timetableId), eq(timetables.workspaceId, workspaceId))).limit(1);
  return row ?? null;
}

export async function createTimetable(workspaceId: string, input: { name: string; semesterStartDate: string | null }): Promise<Timetable> {
  const existing = await db.select({ sortOrder: timetables.sortOrder }).from(timetables).where(eq(timetables.workspaceId, workspaceId));
  if (existing.length >= MAX_TIMETABLES) throw new Error(`最多只能创建 ${MAX_TIMETABLES} 个课表`);
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const [created] = await db.insert(timetables).values({ workspaceId, name: input.name.trim(), sortOrder, semesterStartDate: input.semesterStartDate }).returning();
  if (!created) throw new Error("创建课表失败");
  await seedPeriods(created.id, workspaceId);
  return toTimetable(created);
}

export async function updateTimetable(workspaceId: string, timetableId: string, input: { name?: string; semesterStartDate?: string | null; sortOrder?: number }): Promise<Timetable | null> {
  const existing = await ownedTimetable(workspaceId, timetableId);
  if (!existing) return null;
  const [updated] = await db.update(timetables).set({
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.semesterStartDate !== undefined ? { semesterStartDate: input.semesterStartDate } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    updatedAt: new Date()
  }).where(and(eq(timetables.id, timetableId), eq(timetables.workspaceId, workspaceId))).returning();
  return updated ? toTimetable(updated) : null;
}

export async function deleteTimetable(workspaceId: string, timetableId: string): Promise<{ deleted: boolean; courseCount: number }> {
  const existing = await ownedTimetable(workspaceId, timetableId);
  if (!existing) return { deleted: false, courseCount: 0 };
  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(items).where(and(eq(items.workspaceId, workspaceId), eq(items.timetableId, timetableId), ne(items.status, "deleted"), isNull(items.deletedAt)));
  const courseCount = countRow?.count ?? 0;
  if (courseCount > 0) return { deleted: false, courseCount };
  await db.delete(timetables).where(and(eq(timetables.id, timetableId), eq(timetables.workspaceId, workspaceId)));
  return { deleted: true, courseCount: 0 };
}

export async function listTimetablePeriods(workspaceId: string, timetableId: string): Promise<SchedulePeriod[] | null> {
  const existing = await ownedTimetable(workspaceId, timetableId);
  if (!existing) return null;
  await seedPeriods(timetableId, workspaceId);
  const rows = await db.select().from(schedulePeriods).where(eq(schedulePeriods.timetableId, timetableId)).orderBy(asc(schedulePeriods.sortOrder));
  return rows.map((row) => ({ id: row.id, name: row.name, startTime: row.startTime, endTime: row.endTime, sortOrder: row.sortOrder }));
}

export async function replaceTimetablePeriods(workspaceId: string, timetableId: string, body: unknown): Promise<SchedulePeriod[] | null> {
  const existing = await ownedTimetable(workspaceId, timetableId);
  if (!existing) return null;
  const input = schedulePeriodListSchema.parse(body);
  const rows = await db.transaction(async (tx) => {
    await tx.delete(schedulePeriods).where(and(eq(schedulePeriods.workspaceId, workspaceId), eq(schedulePeriods.timetableId, timetableId)));
    return tx.insert(schedulePeriods).values(input.periods.map((period) => ({
      workspaceId,
      timetableId,
      name: period.name,
      startTime: period.startTime,
      endTime: period.endTime,
      sortOrder: period.sortOrder
    }))).returning();
  });
  return rows.sort((left, right) => left.sortOrder - right.sortOrder).map((row) => ({ id: row.id, name: row.name, startTime: row.startTime, endTime: row.endTime, sortOrder: row.sortOrder }));
}

export async function timetableSemesterStarts(workspaceId: string): Promise<Map<string, Date | null>> {
  await ensureDefaultTimetable(workspaceId);
  const rows = await db.select().from(timetables).where(eq(timetables.workspaceId, workspaceId));
  return new Map(rows.map((row) => [row.id, row.semesterStartDate ? new Date(`${row.semesterStartDate}T12:00:00`) : null]));
}