import { eq } from "drizzle-orm";
import { appSettings, tags } from "@calendar/db/schema";
import {
  aiDraftSchema,
  courseSlotSchema,
  type AiDraft,
  type AiStatus,
} from "@calendar/domain";
import { config } from "../config";
import { db } from "../context";

export type AiImage = { mimeType: string; data: Buffer; fileName?: string };
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export interface AiTimetableContext {
  activeTimetableId: string | null;
  timetables: Array<{
    id: string;
    name: string;
    semesterStartDate: string | null;
    periods: Array<{ name: string; startTime: string; endTime: string }>;
  }>;
}

export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export function aiConfigured(): boolean {
  return config.AI_ENABLED && Boolean(config.AI_API_KEY);
}

function effectiveTextModel(): string {
  return config.AI_TEXT_MODEL === "glm-4-flash" ? "glm-4.5-flash" : config.AI_TEXT_MODEL;
}
export async function getAiStatus(): Promise<AiStatus> {
  return {
    enabled: config.AI_ENABLED,
    configured: aiConfigured(),
    provider: config.AI_PROVIDER,
    textModel: config.AI_TEXT_MODEL,
    visionModel: config.AI_VISION_MODEL,
  };
}

function systemPrompt(
  timezone: string,
  now: string,
  semesterStartDate: string | null,
  tagNames: string[],
  timetableContext?: AiTimetableContext,
): string {
  const format = {
    items: [
      {
        kind: "event|task|both",
        title: "",
        description: "",
        location: "",
        startAt: null,
        endAt: null,
        dueAt: null,
        isAllDay: false,
        timezone,
        priority: "none|low|medium|high|urgent",
        recurrence: null,
        reminderMinutes: [],
        suggestedTagNames: [],
        confidence: 0.5,
        evidence: "",
        warnings: [],
        importTarget: "calendar|timetable",
        timetableId: null,
        courseStartDate: null,
        courseEndDate: null,
        periodMatch: "exact|mapped|uncertain",
        courseSlots: [
          {
            weekday: 1,
            startTime: "08:00",
            endTime: "08:45",
            weekParity: "all",
          },
        ],
      },
    ],
    transcript: "",
  };
  return [
    "你是校园日程和课表提取器。只输出 JSON，不要 Markdown。",
    `格式：${JSON.stringify(format)}`,
    "规则：日期使用带时区的 ISO 8601；不确定的值填 null；没有开始时间用 task；有明确开始时间用 event；同时有日程和待办语义用 both；只建议已有标签；不要编造信息。",
    "课表图片或课表文字必须使用 importTarget=timetable，并按每一门课程分别生成草稿。不同课程绝不能合并，也不能把课程改成概括性名称。",
    "同一门课程在不同星期或多个节次出现时，才合并为一个草稿并返回多个 courseSlots。",
    "中文星期必须严格映射：周一=weekday 1，周二=2，周三=3，周四=4，周五=5，周六=6，周日或周天=0；不得改写成其他星期。",
    "出现“第N节”时必须在下方的节次表中查找名称为 N 的节次，并使用它的 startTime/endTime，periodMatch=mapped；图片中有明确 HH:mm 时间时优先使用图片时间。",
    "示例：输入“周一 第3节 高等数学 德业楼205；周三 第5节 公共外语 德业楼202”必须输出两门课程，分别保留标题、地点、weekday 1/3，并按节次表映射时间，periodMatch 均为 mapped。",
    "无法可靠确定的时间不得猜测；该课程应保留明确标题和警告，periodMatch=uncertain，不能伪造 courseSlots。",
    `当前时间：${now}；时区：${timezone}；默认学期第 1 周周一：${semesterStartDate ?? "未设置"}。`,
    `已有标签：${tagNames.length > 0 ? tagNames.join("、") : "无"}。`,
    `课表页与节次：${JSON.stringify(timetableContext ?? { activeTimetableId: null, timetables: [] })}。`,
  ].join("\n");
}

function userPrompt(
  text: string,
  images: AiImage[],
): string | Array<Record<string, unknown>> {
  const prompt = text.trim() || "请识别图片中的日程、任务或课表信息。";
  if (images.length === 0) return prompt;
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];
  for (const image of images)
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
      },
    });
  return content;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try the first JSON object below */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new AiError("AI_INVALID_RESPONSE", "AI 返回内容不是有效 JSON", 502);
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new AiError("AI_INVALID_RESPONSE", "AI 返回内容不是有效 JSON", 502);
  }
}

function kindFrom(value: unknown): AiDraft["kind"] {
  const text = String(value ?? "").toLowerCase();
  if (text === "both" || text.includes("+") || text.includes("both"))
    return "both";
  if (
    text.includes("task") ||
    text.includes("任务") ||
    text.includes("作业") ||
    text.includes("待办")
  )
    return "task";
  if (
    text.includes("event") ||
    text.includes("日程") ||
    text.includes("会议") ||
    text.includes("课程") ||
    text.includes("上课") ||
    text.includes("活动")
  )
    return "event";
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
  if (
    timezone === "Asia/Shanghai" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
  )
    text += "+08:00";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function weekdayNumber(value: unknown): number | null {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    const text = String(value ?? "").trim();
    if (
      ["周日", "星期日", "sunday", "sun"].some((name) =>
        text.toLowerCase().includes(name.toLowerCase()),
      )
    )
      return 0;
    const names = ["周一", "周二", "周三", "周四", "周五", "周六"];
    const index = names.findIndex((name) => text.includes(name));
    if (index >= 0) return index + 1;
    return null;
  }
  if (raw === 7) return 0;
  return raw >= 0 && raw <= 6 ? Math.trunc(raw) : null;
}

function normalizeSlot(
  raw: unknown,
  timetableContext: AiTimetableContext | undefined,
): { slot: AiDraft["courseSlots"][number] | null; mapped: boolean } {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const weekday = weekdayNumber(
    source.weekday ?? source.day ?? source.dayOfWeek,
  );
  if (weekday === null) return { slot: null, mapped: false };
  let startTime = String(source.startTime ?? source.start ?? "").slice(0, 5);
  let endTime = String(source.endTime ?? source.end ?? "").slice(0, 5);
  let mapped = false;
  if ((!startTime || !endTime) && (source.periodName || source.period)) {
    const requested = String(source.periodName ?? source.period)
      .trim()
      .toLowerCase()
      .replace(/^第/, "")
      .replace(/节$/, "");
    const periods =
      timetableContext?.timetables.find(
        (page) => page.id === timetableContext.activeTimetableId,
      )?.periods ?? [];
    const period = periods.find(
      (candidate) =>
        candidate.name
          .trim()
          .toLowerCase()
          .replace(/^第/, "")
          .replace(/节$/, "") === requested,
    );
    if (period) {
      startTime = period.startTime;
      endTime = period.endTime;
      mapped = true;
    }
  }
  const parsed = courseSlotSchema.safeParse({
    ...(typeof source.id === "string" ? { id: source.id } : {}),
    weekday,
    startTime,
    endTime,
    weekParity:
      source.weekParity === "odd" || source.weekParity === "even"
        ? source.weekParity
        : "all",
  });
  return { slot: parsed.success ? parsed.data : null, mapped };
}

function normalizeProviderResponse(
  value: unknown,
  timezone: string,
  timetableContext?: AiTimetableContext,
): { items: AiDraft[]; transcript: string } {
  const root =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawItems = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.drafts)
      ? root.drafts
      : [];
  const items: AiDraft[] = [];
  for (const raw of rawItems) {
    const source =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const title = String(source.title ?? source.summary ?? "").trim();
    if (!title) continue;
    const warnings = Array.isArray(source.warnings)
      ? source.warnings.map(String)
      : [];
    const rawRecurrence = source.recurrence;
    const recurrence =
      rawRecurrence &&
      typeof rawRecurrence === "object" &&
      !Array.isArray(rawRecurrence)
        ? rawRecurrence
        : null;
    const rawReminders = Array.isArray(source.reminderMinutes)
      ? source.reminderMinutes
      : Array.isArray(source.reminders)
        ? source.reminders
        : typeof source.reminderMinutes === "number"
          ? [source.reminderMinutes]
          : [];
    const reminderMinutes = rawReminders
      .map(Number)
      .filter((value): value is number =>
        [0, 5, 15, 30, 60, 1440].includes(value),
      );
    const confidenceValue = Number(source.confidence);
    const rawSlots = Array.isArray(source.courseSlots)
      ? source.courseSlots
      : Array.isArray(source.timetableSlots)
        ? source.timetableSlots
        : [];
    const normalizedSlots = rawSlots.map((slot) =>
      normalizeSlot(slot, timetableContext),
    );
    const courseSlots = normalizedSlots
      .map((entry) => entry.slot)
      .filter((slot): slot is AiDraft["courseSlots"][number] => Boolean(slot));
    const importTarget =
      source.importTarget === "timetable" || source.target === "timetable"
        ? "timetable"
        : "calendar";
    const timetableIdValue =
      typeof source.timetableId === "string" &&
      /^[0-9a-f-]{36}$/i.test(source.timetableId)
        ? source.timetableId
        : (timetableContext?.activeTimetableId ?? null);
    const periodMatch =
      source.periodMatch === "exact" ||
      source.periodMatch === "mapped" ||
      source.periodMatch === "uncertain"
        ? source.periodMatch
        : normalizedSlots.some((entry) => entry.mapped)
          ? "mapped"
          : importTarget === "timetable" && courseSlots.length === 0
            ? "uncertain"
            : "exact";
    const candidate = {
      kind: kindFrom(source.kind),
      title,
      description: String(source.description ?? ""),
      location: String(source.location ?? source.place ?? ""),
      startAt: isoFrom(source.startAt ?? source.start, timezone),
      endAt: isoFrom(source.endAt ?? source.end, timezone),
      dueAt: isoFrom(source.dueAt ?? source.due, timezone),
      isAllDay: Boolean(source.isAllDay ?? source.allDay),
      timezone:
        typeof source.timezone === "string" ? source.timezone : timezone,
      priority: priorityFrom(source.priority),
      recurrence,
      reminderMinutes,
      suggestedTagNames: Array.isArray(source.suggestedTagNames)
        ? source.suggestedTagNames.map(String)
        : Array.isArray(source.tags)
          ? source.tags.map(String)
          : [],
      confidence: Number.isFinite(confidenceValue)
        ? confidenceValue > 1
          ? Math.min(1, confidenceValue / 100)
          : confidenceValue
        : 0.5,
      evidence: String(source.evidence ?? source.sourceExcerpt ?? ""),
      warnings,
      importTarget,
      timetableId: timetableIdValue,
      courseStartDate:
        typeof source.courseStartDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(source.courseStartDate)
          ? source.courseStartDate
          : null,
      courseEndDate:
        typeof source.courseEndDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(source.courseEndDate)
          ? source.courseEndDate
          : null,
      courseSlots,
      periodMatch,
    };
    const parsed = aiDraftSchema.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
  }
  return { items, transcript: String(root.transcript ?? root.text ?? "") };
}

export async function extractScheduleDrafts(input: {
  workspaceId: string;
  text: string;
  images: AiImage[];
  timezone: string;
  timetableContext?: AiTimetableContext;
  fetcher?: FetchLike;
}): Promise<{
  drafts: AiDraft[];
  transcript: string;
  model: string;
  provider: string;
}> {
  if (!aiConfigured())
    throw new AiError(
      "AI_NOT_CONFIGURED",
      "AI 尚未配置，请先设置 AI_API_KEY 并启用 AI_ENABLED",
      503,
    );
  const [settings] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.workspaceId, input.workspaceId))
    .limit(1);
  const tagRows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(eq(tags.workspaceId, input.workspaceId));
  const model =
    input.images.length > 0 ? config.AI_VISION_MODEL : config.AI_TEXT_MODEL;
  const messages = [
    {
      role: "system",
      content: systemPrompt(
        input.timezone,
        new Date().toISOString(),
        settings?.semesterStartDate ?? null,
        tagRows.map((row) => row.name),
        input.timetableContext,
      ),
    },
    { role: "user", content: userPrompt(input.text, input.images) },
  ];
  const endpoint = `${config.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages,
    temperature: 0,
    max_tokens: 4096,
  });
  const fetcher = input.fetcher ?? fetch;
  let response: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.AI_REQUEST_TIMEOUT_MS,
    );
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.AI_API_KEY}`,
        },
        body,
        signal: controller.signal,
      });
      if (response.ok || response.status === 429 || response.status < 500)
        break;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!response)
    throw new AiError(
      "AI_NETWORK_ERROR",
      lastError instanceof Error ? lastError.message : "AI 网络请求失败",
      502,
    );
  if (response.status === 429)
    throw new AiError(
      "AI_PROVIDER_RATE_LIMIT",
      "AI 供应商额度或频率受限，请稍后重试",
      429,
    );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = detail.slice(0, 300) || `AI 请求失败（${response.status}）`;
    throw new AiError("AI_PROVIDER_ERROR", message, 502);
  }
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | Array<{ text?: string }> };
    }>;
  };
  const rawContent = payload.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => part.text ?? "").join("")
        : "";
  if (!content)
    throw new AiError("AI_INVALID_RESPONSE", "AI 没有返回内容", 502);
  const parsed = normalizeProviderResponse(
    parseJsonContent(content),
    input.timezone,
    input.timetableContext,
  );
  if (parsed.items.length === 0)
    throw new AiError(
      "AI_INVALID_RESPONSE",
      "AI 没有返回可导入的日程，请换一种描述重试",
      502,
    );
  return {
    drafts: parsed.items,
    transcript: parsed.transcript,
    model,
    provider: config.AI_PROVIDER,
  };
}
