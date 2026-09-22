import { and, eq, sql } from "drizzle-orm";
import { aiUsage, appSettings, tags } from "@calendar/db/schema";
import { aiDraftSchema, type AiDraft, type AiStatus, type AiUsage } from "@calendar/domain";
import { config } from "../config";
import { db } from "../context";

export type AiImage = { mimeType: string; data: Buffer; fileName?: string };
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class AiError extends Error {
  constructor(public code: string, message: string, public status = 500, public usage?: AiUsage) { super(message); this.name = "AiError"; }
}

export function shanghaiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function aiDailyLimit(): number {
  return config.DEMO_MODE ? config.AI_DEMO_DAILY_LIMIT : config.AI_PRIVATE_DAILY_LIMIT;
}

export function aiConfigured(): boolean {
  return config.AI_ENABLED && Boolean(config.AI_API_KEY);
}

function usageValue(used: number, limit = aiDailyLimit()): AiUsage {
  return { date: shanghaiDate(), used, limit, remaining: Math.max(0, limit - used) };
}

async function readUsage(workspaceId: string): Promise<AiUsage> {
  const [row] = await db.select().from(aiUsage).where(and(eq(aiUsage.workspaceId, workspaceId), eq(aiUsage.usageDate, shanghaiDate()))).limit(1);
  return usageValue(row?.requestCount ?? 0);
}

export async function getAiStatus(workspaceId: string): Promise<AiStatus> {
  return { enabled: config.AI_ENABLED, configured: aiConfigured(), provider: config.AI_PROVIDER, textModel: config.AI_TEXT_MODEL, visionModel: config.AI_VISION_MODEL, usage: await readUsage(workspaceId) };
}

export async function reserveAiUsage(workspaceId: string): Promise<AiUsage> {
  const limit = aiDailyLimit();
  const date = shanghaiDate();
  const result = await db.execute(sql`
    insert into ai_usage (workspace_id, usage_date, request_count, updated_at)
    values (${workspaceId}, ${date}, 1, now())
    on conflict (workspace_id, usage_date)
    do update set request_count = ai_usage.request_count + 1, updated_at = now()
    where ai_usage.request_count < ${limit}
    returning request_count
  `);
  const rows = (result as unknown as { rows?: Array<{ request_count: number }> }).rows ?? [];
  const row = rows[0];
  if (!row) {
    const usage = await readUsage(workspaceId);
    throw new AiError("AI_DAILY_LIMIT", `今日 AI 额度已用完（${usage.used}/${usage.limit}）`, 429, usage);
  }
  return usageValue(Number(row.request_count), limit);
}

function systemPrompt(timezone: string, now: string, semesterStartDate: string | null, tagNames: string[]): string {
  return [
    "你是校园日程提取器。只输出 JSON，不要 Markdown。",
    "格式：{\"items\":[{\"kind\":\"event|task|both\",\"title\":\"\",\"description\":\"\",\"location\":\"\",\"startAt\":null,\"endAt\":null,\"dueAt\":null,\"isAllDay\":false,\"timezone\":\"Asia/Shanghai\",\"priority\":\"none|low|medium|high|urgent\",\"recurrence\":null,\"reminderMinutes\":[],\"suggestedTagNames\":[],\"confidence\":0.5,\"evidence\":\"\",\"warnings\":[]}],\"transcript\":\"\"}",
    "规则：日期使用带时区的 ISO 8601；不确定的值填 null；没有开始时间用 task；有明确开始时间用 event；同时有日程和待办语义用 both；只建议已有标签；不要编造信息。",
    `当前时间：${now}；时区：${timezone}；学期第 1 周周一：${semesterStartDate ?? "未设置"}。`, 
    `已有标签：${tagNames.length > 0 ? tagNames.join("、") : "无"}。`
  ].join("\n");
}

function userPrompt(text: string, images: AiImage[]): string | Array<Record<string, unknown>> {
  const prompt = text.trim() || "请识别图片中的日程和任务信息。";
  if (images.length === 0) return prompt;
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const image of images) content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data.toString("base64")}` } });
  return content;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { /* try the first JSON object below */ }
  const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI_INVALID_RESPONSE", "AI 返回内容不是有效 JSON", 502);
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { throw new AiError("AI_INVALID_RESPONSE", "AI 返回内容不是有效 JSON", 502); }
}

function kindFrom(value: unknown): AiDraft["kind"] {
  const text = String(value ?? "").toLowerCase();
  if (text === "both" || text.includes("+") || text.includes("both")) return "both";
  if (text.includes("task") || text.includes("任务") || text.includes("作业") || text.includes("待办")) return "task";
  if (text.includes("event") || text.includes("日程") || text.includes("会议") || text.includes("课程") || text.includes("上课") || text.includes("活动")) return "event";
  return "task";
}

function priorityFrom(value: unknown): AiDraft["priority"] {
  const text = String(value ?? "").toLowerCase();
  if (text === "urgent" || text.includes("紧急")) return "urgent";
  if (text === "high" || text.includes("高")) return "high";
  if (text === "medium" || text.includes("中")) return "medium";
  if (text === "low" || text.includes("低")) return "low";
  return "none";
}

function isoFrom(value: unknown, timezone: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  let text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += "T00:00:00";
  if (timezone === "Asia/Shanghai" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)) text += "+08:00";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeProviderResponse(value: unknown, timezone: string): { items: AiDraft[]; transcript: string } {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawItems = Array.isArray(root.items) ? root.items : Array.isArray(root.drafts) ? root.drafts : [];
  const items: AiDraft[] = [];
  for (const raw of rawItems) {
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const title = String(source.title ?? source.summary ?? "").trim();
    if (!title) continue;
    const warnings = Array.isArray(source.warnings) ? source.warnings.map(String) : [];
    const rawRecurrence = source.recurrence;
    const recurrence = rawRecurrence && typeof rawRecurrence === "object" && !Array.isArray(rawRecurrence) ? rawRecurrence : null;
    const rawReminders = Array.isArray(source.reminderMinutes) ? source.reminderMinutes : Array.isArray(source.reminders) ? source.reminders : typeof source.reminderMinutes === "number" ? [source.reminderMinutes] : [];
    const reminderMinutes = rawReminders.map(Number).filter((value): value is number => [0, 5, 15, 30, 60, 1440].includes(value));
    const confidenceValue = Number(source.confidence);
    const candidate = {
      kind: kindFrom(source.kind), title,
      description: String(source.description ?? ""), location: String(source.location ?? source.place ?? ""),
      startAt: isoFrom(source.startAt ?? source.start, timezone), endAt: isoFrom(source.endAt ?? source.end, timezone), dueAt: isoFrom(source.dueAt ?? source.due, timezone),
      isAllDay: Boolean(source.isAllDay ?? source.allDay), timezone: typeof source.timezone === "string" ? source.timezone : timezone,
      priority: priorityFrom(source.priority), recurrence,
      reminderMinutes, suggestedTagNames: Array.isArray(source.suggestedTagNames) ? source.suggestedTagNames.map(String) : Array.isArray(source.tags) ? source.tags.map(String) : [],
      confidence: Number.isFinite(confidenceValue) ? (confidenceValue > 1 ? Math.min(1, confidenceValue / 100) : confidenceValue) : 0.5,
      evidence: String(source.evidence ?? source.sourceExcerpt ?? ""), warnings
    };
    const parsed = aiDraftSchema.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
  }
  return { items, transcript: String(root.transcript ?? root.text ?? "") };
}export async function extractScheduleDrafts(input: { workspaceId: string; text: string; images: AiImage[]; timezone: string; fetcher?: FetchLike }): Promise<{ drafts: AiDraft[]; transcript: string; model: string; provider: string }> {
  if (!aiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "AI 尚未配置，请先设置 AI_API_KEY 并启用 AI_ENABLED", 503);
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.workspaceId, input.workspaceId)).limit(1);
  const tagRows = await db.select({ name: tags.name }).from(tags).where(eq(tags.workspaceId, input.workspaceId));
  const model = input.images.length > 0 ? config.AI_VISION_MODEL : config.AI_TEXT_MODEL;
  const messages = [
    { role: "system", content: systemPrompt(input.timezone, new Date().toISOString(), settings?.semesterStartDate ?? null, tagRows.map((row) => row.name)) },
    { role: "user", content: userPrompt(input.text, input.images) }
  ];
  const endpoint = `${config.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1024 });
  const fetcher = input.fetcher ?? fetch;
  let response: Response | null = null; let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.AI_REQUEST_TIMEOUT_MS);
    try {
      response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.AI_API_KEY}` }, body, signal: controller.signal });
      if (response.ok || response.status === 429 || response.status < 500) break;
    } catch (error) { lastError = error; }
    finally { clearTimeout(timer); }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!response) throw new AiError("AI_NETWORK_ERROR", lastError instanceof Error ? lastError.message : "AI 网络请求失败", 502);
  if (response.status === 429) throw new AiError("AI_PROVIDER_RATE_LIMIT", "AI 供应商额度或频率受限，请稍后重试", 429);
  if (!response.ok) {
    const detail = await response.text().catch(() => ""); const message = detail.slice(0, 300) || `AI 请求失败（${response.status}）`;
    throw new AiError("AI_PROVIDER_ERROR", message, 502);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const rawContent = payload.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.map((part) => part.text ?? "").join("") : "";
  if (!content) throw new AiError("AI_INVALID_RESPONSE", "AI 没有返回内容", 502);
  const parsed = normalizeProviderResponse(parseJsonContent(content), input.timezone);
  if (parsed.items.length === 0) throw new AiError("AI_INVALID_RESPONSE", "AI 没有返回可导入的日程，请换一种描述重试", 502);
  return { drafts: parsed.items, transcript: parsed.transcript, model, provider: config.AI_PROVIDER };
}
