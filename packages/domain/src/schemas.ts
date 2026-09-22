import { z } from "zod";

export const itemKindSchema = z.enum(["event", "task", "both"]);
export const prioritySchema = z.enum(["none", "low", "medium", "high", "urgent"]);
export const itemStatusSchema = z.enum(["active", "partial", "completed", "cancelled", "deleted"]);
export const recurrenceFrequencySchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export const reminderChannelSchema = z.enum(["in_app", "browser_push", "email"]);
export const reminderTriggerSchema = z.enum(["before_start", "at_start", "at_end"]);
export const reminderOffsetSchema = z.union([
  z.literal(0),
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(1440)
]);

export const recurrenceSchema = z.object({
  frequency: recurrenceFrequencySchema,
  interval: z.number().int().min(1).max(365).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).default([]),
  byMonthDay: z.array(z.number().int().min(1).max(31)).default([]),
  weekParity: z.enum(["all", "odd", "even"]).default("all"),
  count: z.number().int().min(1).max(10000).nullable().optional(),
  until: z.string().datetime({ offset: true }).nullable().optional()
});

export const reminderInputSchema = z.object({
  id: z.string().uuid().optional(),
  trigger: reminderTriggerSchema.default("before_start"),
  offsetMinutes: reminderOffsetSchema,
  channels: z.array(reminderChannelSchema).min(1).default(["in_app"]),
  repeatEveryMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  enabled: z.boolean().default(true)
});

export const courseSlotSchema = z.object({
  id: z.string().uuid().optional(),
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekParity: z.enum(["all", "odd", "even"]).default("all")
}).superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "结束时间必须晚于开始时间" });
});

export const itemFieldsSchema = z.object({
  calendarId: z.string().uuid().nullable().optional(),
  kind: itemKindSchema.default("event"),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).default(""),
  location: z.string().max(1000).default(""),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  isAllDay: z.boolean().default(false),
  timezone: z.string().min(1).max(100).default("Asia/Shanghai"),
  priority: prioritySchema.default("none"),
  status: itemStatusSchema.default("active"),
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
  autoRollover: z.boolean().default(false),
  showInTimetable: z.boolean().default(false),
  timetableColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  courseStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  courseEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  courseSlots: z.array(courseSlotSchema).max(20).default([]),
  parentId: z.string().uuid().nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  tagIds: z.array(z.string().uuid()).default([]),
  reminders: z.array(reminderInputSchema).default([]),
  version: z.number().int().nonnegative().optional()
});

export const itemInputSchema = itemFieldsSchema.superRefine((value, ctx) => {
  if (value.kind === "event" && !value.startAt) {
    ctx.addIssue({ code: "custom", path: ["startAt"], message: "事件必须有开始时间" });
  }
  if (value.startAt && value.endAt && new Date(value.endAt) <= new Date(value.startAt)) {
    ctx.addIssue({ code: "custom", path: ["endAt"], message: "结束时间必须晚于开始时间" });
  }
  if (value.courseStartDate && value.courseEndDate && value.courseEndDate < value.courseStartDate) {
    ctx.addIssue({ code: "custom", path: ["courseEndDate"], message: "课程结束日期不能早于开始日期" });
  }
  if (value.endAt && !value.startAt) {
    ctx.addIssue({ code: "custom", path: ["endAt"], message: "设置结束时间前必须设置开始时间" });
  }
});

export const itemSchema = itemInputSchema.and(z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable().optional()
}));

export const recurrenceExceptionSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  occurrenceKey: z.string(),
  action: z.enum(["override", "cancelled"]),
  override: itemFieldsSchema.partial().nullable().optional()
});

export const calendarSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  kind: z.enum(["local", "subscription"]),
  timezone: z.string().default("Asia/Shanghai"),
  isVisible: z.boolean().default(true)
});

export const tagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export const syncMutationSchema = z.object({
  clientMutationId: z.string().min(1).max(100),
  entity: z.enum(["item", "tag", "attachment", "reminder"]),
  action: z.enum(["create", "update", "delete", "restore"]),
  entityId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative().optional(),
  fields: z.record(z.string(), z.unknown()).default({})
});

export const syncPushSchema = z.object({
  cursor: z.string().optional(),
  mutations: z.array(syncMutationSchema).max(500)
});

export const searchFiltersSchema = z.object({
  q: z.string().max(200).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  kind: itemKindSchema.optional(),
  status: itemStatusSchema.optional(),
  priority: prioritySchema.optional(),
  tagIds: z.array(z.string().uuid()).optional()
});

export type ItemKind = z.infer<typeof itemKindSchema>;
export const isCalendarKind = (kind: ItemKind) => kind === "event" || kind === "both";
export const isTaskKind = (kind: ItemKind) => kind === "task" || kind === "both";
export type Priority = z.infer<typeof prioritySchema>;
export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type CourseSlot = z.infer<typeof courseSlotSchema>;
export type ReminderInput = z.infer<typeof reminderInputSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;
export type Item = z.infer<typeof itemSchema>;
export type RecurrenceException = z.infer<typeof recurrenceExceptionSchema>;
export type CalendarModel = z.infer<typeof calendarSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
