import { z } from "zod";
import { itemKindSchema, prioritySchema, recurrenceSchema, reminderOffsetSchema } from "./schemas";

export const aiDraftSchema = z.object({
  kind: itemKindSchema.default("task"),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).default(""),
  location: z.string().max(1000).default(""),
  startAt: z.string().datetime({ offset: true }).nullable().default(null),
  endAt: z.string().datetime({ offset: true }).nullable().default(null),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  isAllDay: z.boolean().default(false),
  timezone: z.string().min(1).max(100).default("Asia/Shanghai"),
  priority: prioritySchema.default("none"),
  recurrence: recurrenceSchema.nullable().default(null),
  reminderMinutes: z.array(reminderOffsetSchema).max(6).default([]),
  suggestedTagNames: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.string().max(2000).default(""),
  warnings: z.array(z.string().max(300)).max(20).default([])
});

export const aiProviderResponseSchema = z.object({
  items: z.array(aiDraftSchema).max(20).default([]),
  transcript: z.string().max(50_000).default("")
});

export const aiUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  remaining: z.number().int().nonnegative()
});

export const aiStatusSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  provider: z.string(),
  textModel: z.string(),
  visionModel: z.string(),
  usage: aiUsageSchema
});

export const aiExtractResponseSchema = z.object({
  drafts: z.array(aiDraftSchema),
  transcript: z.string().default(""),
  usage: aiUsageSchema,
  provider: z.string(),
  model: z.string()
});

export type AiDraft = z.infer<typeof aiDraftSchema>;
export type AiProviderResponse = z.infer<typeof aiProviderResponseSchema>;
export type AiUsage = z.infer<typeof aiUsageSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
export type AiExtractResponse = z.infer<typeof aiExtractResponseSchema>;