import { z } from "zod";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间必须使用 HH:mm 格式");

export const schedulePeriodSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(20),
  startTime: timeSchema,
  endTime: timeSchema,
  sortOrder: z.number().int().min(0).max(99)
}).superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "结束时间必须晚于开始时间" });
});

export const schedulePeriodListSchema = z.object({ periods: z.array(schedulePeriodSchema).min(1).max(30) }).superRefine((value, ctx) => {
  const orders = new Set<number>();
  for (const period of value.periods) {
    if (orders.has(period.sortOrder)) ctx.addIssue({ code: "custom", path: ["periods"], message: "节次排序不能重复" });
    orders.add(period.sortOrder);
  }
});

export const DEFAULT_SCHEDULE_PERIODS = [
  { name: "1", startTime: "08:00", endTime: "08:45", sortOrder: 0 },
  { name: "2", startTime: "08:50", endTime: "09:35", sortOrder: 1 },
  { name: "3", startTime: "09:50", endTime: "10:35", sortOrder: 2 },
  { name: "4", startTime: "10:40", endTime: "11:25", sortOrder: 3 },
  { name: "5", startTime: "11:30", endTime: "12:15", sortOrder: 4 },
  { name: "6", startTime: "13:30", endTime: "14:15", sortOrder: 5 },
  { name: "7", startTime: "14:20", endTime: "15:05", sortOrder: 6 },
  { name: "8", startTime: "15:20", endTime: "16:05", sortOrder: 7 },
  { name: "9", startTime: "16:10", endTime: "16:55", sortOrder: 8 },
  { name: "10", startTime: "18:30", endTime: "19:15", sortOrder: 9 }
] as const;

export type SchedulePeriodInput = z.infer<typeof schedulePeriodSchema>;
export type SchedulePeriod = SchedulePeriodInput & { id: string };