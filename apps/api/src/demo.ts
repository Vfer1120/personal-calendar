import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { appSettings, calendars, demoSessions, itemTags, items, tags, user, workspaces } from "@calendar/db/schema";
import { itemInputSchema } from "@calendar/domain";
import { config } from "./config";
import { db, type AuthContextValue } from "./context";
import { replaceItemTags, replaceReminderRules, searchableText } from "./services/items";

export const DEMO_COOKIE = "calendar_demo_session";
export const DEMO_OWNER_ID = "demo-owner";
export const DEMO_OWNER_EMAIL = "demo-owner@example.invalid";

export interface DemoSessionValue {
  auth: AuthContextValue;
  expiresAt: Date;
}

export function hashDemoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function ensureDemoOwner(): Promise<string> {
  const [existing] = await db.select().from(user).where(eq(user.email, DEMO_OWNER_EMAIL)).limit(1);
  if (existing) return existing.id;
  await db.insert(user).values({ id: DEMO_OWNER_ID, name: "体验用户", email: DEMO_OWNER_EMAIL, emailVerified: true }).onConflictDoNothing();
  const [owner] = await db.select().from(user).where(eq(user.email, DEMO_OWNER_EMAIL)).limit(1);
  if (!owner) throw new Error("无法创建体验用户");
  return owner.id;
}

function chinaDate(dayOffset: number, hour: number, minute = 0): Date {
  const wallClock = new Date(Date.now() + 8 * 60 * 60_000);
  wallClock.setUTCDate(wallClock.getUTCDate() + dayOffset);
  wallClock.setUTCHours(hour, minute, 0, 0);
  return new Date(wallClock.getTime() - 8 * 60 * 60_000);
}

async function seedDemoWorkspace(workspaceId: string): Promise<void> {
  const [calendar] = await db.insert(calendars).values({ workspaceId, name: "体验日历", color: "#f97316" }).returning();
  if (!calendar) throw new Error("无法创建体验日历");
  const tagRows = await db.insert(tags).values([
    { workspaceId, name: "工作", color: "#3b82f6" },
    { workspaceId, name: "生活", color: "#22c55e" },
    { workspaceId, name: "重要", color: "#ef4444" }
  ]).returning();
  const tagIdByName = new Map(tagRows.map((tag) => [tag.name, tag.id]));

  const allDayStart = chinaDate(1, 0, 0);
  const allDayEnd = new Date(allDayStart.getTime() + 86_400_000 - 1);
  const definitions = [
    {
      key: "weekly",
      tagNames: ["工作", "重要"],
      input: { kind: "event", title: "产品周会", startAt: chinaDate(1, 9, 30).toISOString(), endAt: chinaDate(1, 10, 30).toISOString(), timezone: "Asia/Shanghai", priority: "high", showInTimetable: true, recurrence: { frequency: "weekly", interval: 1, byWeekday: [1], byMonthDay: [], count: null, until: null }, reminders: [{ offsetMinutes: 15, channels: ["in_app"], repeatEveryMinutes: 5, enabled: true }] }
    },
    {
      key: "milestone",
      tagNames: ["工作", "重要"],
      input: { kind: "event", title: "项目里程碑", startAt: allDayStart.toISOString(), endAt: allDayEnd.toISOString(), isAllDay: true, timezone: "Asia/Shanghai", priority: "urgent" }
    },
    {
      key: "focus",
      tagNames: ["工作"],
      input: { kind: "both", title: "整理会议纪要", startAt: chinaDate(1, 14, 0).toISOString(), endAt: chinaDate(1, 15, 30).toISOString(), dueAt: chinaDate(1, 18, 0).toISOString(), timezone: "Asia/Shanghai", priority: "medium", showInTimetable: true, reminders: [{ offsetMinutes: 30, channels: ["in_app"], repeatEveryMinutes: 5, enabled: true }] }
    },
    {
      key: "subtask",
      parentKey: "focus",
      tagNames: ["工作"],
      input: { kind: "task", title: "整理关键结论", dueAt: chinaDate(1, 17, 0).toISOString(), timezone: "Asia/Shanghai", priority: "medium" }
    },
    {
      key: "fitness",
      tagNames: ["生活"],
      input: { kind: "task", title: "预约周末运动", dueAt: chinaDate(2, 20, 0).toISOString(), timezone: "Asia/Shanghai", priority: "low" }
    },
    {
      key: "shopping",
      tagNames: ["生活"],
      input: { kind: "task", title: "补充办公用品", timezone: "Asia/Shanghai", priority: "none" }
    }
  ];

  const createdIds = new Map<string, string>();
  for (const definition of definitions) {
    const parsed = itemInputSchema.parse({ ...definition.input, calendarId: calendar.id, parentId: definition.parentKey ? createdIds.get(definition.parentKey) ?? null : null, tagIds: [], reminders: "reminders" in definition.input ? definition.input.reminders : [] });
    const [created] = await db.insert(items).values({
      workspaceId,
      calendarId: calendar.id,
      parentId: parsed.parentId ?? null,
      kind: parsed.kind,
      title: parsed.title,
      description: parsed.description,
      location: parsed.location,
      startAt: parsed.startAt ? new Date(parsed.startAt) : null,
      endAt: parsed.endAt ? new Date(parsed.endAt) : null,
      dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
      isAllDay: parsed.isAllDay,
      timezone: parsed.timezone,
      priority: parsed.priority,
      status: parsed.status,
      completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null,
      recurrence: parsed.recurrence ?? null,
      searchText: searchableText(parsed)
    }).returning();
    if (!created) continue;
    createdIds.set(definition.key, created.id);
    const tagIds = definition.tagNames.map((name) => tagIdByName.get(name)).filter((id): id is string => Boolean(id));
    await replaceItemTags(db, created.id, tagIds);
    await replaceReminderRules(db, created.id, parsed.reminders ?? []);
  }

  await db.insert(appSettings).values({ workspaceId, icsToken: randomBytes(32).toString("base64url") }).onConflictDoNothing();
}

async function createDemoWorkspace(): Promise<{ id: string }> {
  const ownerId = await ensureDemoOwner();
  const [workspace] = await db.insert(workspaces).values({ ownerId, name: "体验空间" }).returning();
  if (!workspace) throw new Error("无法创建体验空间");
  await seedDemoWorkspace(workspace.id);
  return workspace;
}

export async function createDemoSession(): Promise<{ token: string; expiresAt: Date; workspaceId: string }> {
  const workspace = await createDemoWorkspace();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.DEMO_SESSION_TTL_HOURS * 60 * 60_000);
  await db.insert(demoSessions).values({ tokenHash: hashDemoToken(token), workspaceId: workspace.id, expiresAt });
  return { token, expiresAt, workspaceId: workspace.id };
}

export async function resolveDemoSession(token?: string | null): Promise<DemoSessionValue | null> {
  if (!config.DEMO_MODE || !token) return null;
  const [session] = await db.select().from(demoSessions).where(and(eq(demoSessions.tokenHash, hashDemoToken(token)), gt(demoSessions.expiresAt, new Date()))).limit(1);
  if (!session) return null;
  await db.update(demoSessions).set({ lastSeenAt: new Date() }).where(eq(demoSessions.id, session.id));
  return {
    auth: { userId: DEMO_OWNER_ID, email: DEMO_OWNER_EMAIL, name: "体验用户", workspaceId: session.workspaceId },
    expiresAt: session.expiresAt
  };
}

export async function resetDemoWorkspace(workspaceId: string): Promise<string> {
  const replacement = await createDemoWorkspace();
  await db.transaction(async (tx) => {
    await tx.update(demoSessions).set({ workspaceId: replacement.id, lastSeenAt: new Date() }).where(eq(demoSessions.workspaceId, workspaceId));
  });
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  return replacement.id;
}

export async function deleteDemoWorkspace(workspaceId: string): Promise<void> {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}
