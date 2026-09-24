import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import nodemailer from "nodemailer";
import webpush from "web-push";
import { appSettings, deliveries, itemTags, items, pushSubscriptions, recurrenceExceptions, reminderRules } from "@calendar/db/schema";
import { expandItems, sendBrevoEmail, sendSmtp2goEmail, type ExpandedItem, type ExpandedOccurrence } from "@calendar/domain";
import { db } from "./db";
import { config } from "./config";

let mailer: nodemailer.Transporter | null = null;
function getMailer() { if (!config.SMTP_URL) return null; mailer ??= nodemailer.createTransport(config.SMTP_URL); return mailer; }
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

async function loadExpandedItems(): Promise<ExpandedItem[]> {
  const rows = await db.select().from(items).where(inArray(items.status, ["active", "partial"]));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [links, rules, exceptions] = await Promise.all([
    db.select().from(itemTags).where(inArray(itemTags.itemId, ids)),
    db.select().from(reminderRules).where(inArray(reminderRules.itemId, ids)),
    db.select().from(recurrenceExceptions).where(inArray(recurrenceExceptions.itemId, ids))
  ]);
  const tagMap = new Map<string, string[]>(); for (const link of links) tagMap.set(link.itemId, [...(tagMap.get(link.itemId) ?? []), link.tagId]);
  const ruleMap = new Map<string, typeof rules>(); for (const rule of rules) ruleMap.set(rule.itemId, [...(ruleMap.get(rule.itemId) ?? []), rule]);
  const exceptionMap = new Map<string, typeof exceptions>(); for (const exception of exceptions) exceptionMap.set(exception.itemId, [...(exceptionMap.get(exception.itemId) ?? []), exception]);
  return rows.map((row) => ({
    id: row.id, workspaceId: row.workspaceId, calendarId: row.calendarId, parentId: row.parentId, kind: row.kind as ExpandedItem["kind"],
    title: row.title, description: row.description, location: row.location, startAt: row.startAt?.toISOString() ?? null, endAt: row.endAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null, isAllDay: row.isAllDay, timezone: row.timezone, priority: row.priority as ExpandedItem["priority"],
    status: row.status as ExpandedItem["status"], completedAt: row.completedAt?.toISOString() ?? null, autoRollover: row.autoRollover, showInTimetable: row.showInTimetable, courseStartDate: row.courseStartDate, courseEndDate: row.courseEndDate, recurrence: row.recurrence ?? null,
    courseSlots: row.courseSlots,
    timetableColor: row.timetableColor,
    tagIds: tagMap.get(row.id) ?? [], reminders: (ruleMap.get(row.id) ?? []).map((rule) => ({ id: rule.id, trigger: rule.trigger as ExpandedItem["reminders"][number]["trigger"], offsetMinutes: rule.offsetMinutes as ExpandedItem["reminders"][number]["offsetMinutes"], channels: rule.channels as ExpandedItem["reminders"][number]["channels"], repeatEveryMinutes: rule.repeatEveryMinutes, enabled: rule.enabled })), version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null,
    recurrenceExceptions: (exceptionMap.get(row.id) ?? []).map((exception) => ({ id: exception.id, itemId: exception.itemId, occurrenceKey: exception.occurrenceKey, action: exception.action as "override" | "cancelled", override: exception.override ?? null }))
  }));
}

function messageFor(title: string, start: Date, location: string) {
  const time = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(start);
  return { title: `日程提醒：${title}`, body: `${time}${location ? ` · ${location}` : ""}` };
}
async function sendChannels(workspaceId: string, itemId: string, deliveryId: string, channels: string[], title: string, start: Date, location: string): Promise<{ delivered: boolean; error?: string }> {
  const message = messageFor(title, start, location); let delivered = false; const errors: string[] = [];
  if (channels.includes("in_app")) delivered = true;
  if (channels.includes("browser_push") && config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.workspaceId, workspaceId));
    for (const subscription of subscriptions) {
      try { await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: message.title, body: message.body, url: `/?item=${itemId}`, tag: itemId, deliveryId })); delivered = true; }
      catch (error) { errors.push(error instanceof Error ? error.message : "push failed"); const statusCode = (error as { statusCode?: number }).statusCode; if (statusCode === 404 || statusCode === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id)); }
    }
  }
  if (channels.includes("email") && process.env.OWNER_EMAIL) {
    try {
      if (config.SMTP2GO_API_KEY) {
        await sendSmtp2goEmail({ apiKey: config.SMTP2GO_API_KEY, sender: `个人日程 <${process.env.OWNER_EMAIL}>`, to: process.env.OWNER_EMAIL, subject: message.title, text: message.body });
        delivered = true;
      } else if (config.BREVO_API_KEY) {
        await sendBrevoEmail({ apiKey: config.BREVO_API_KEY, sender: { name: "个人日程", email: process.env.OWNER_EMAIL }, to: process.env.OWNER_EMAIL, subject: message.title, text: message.body });
        delivered = true;
      } else {
        const mailerInstance = getMailer();
        if (mailerInstance) { await mailerInstance.sendMail({ from: config.SMTP_FROM, to: process.env.OWNER_EMAIL, subject: message.title, text: message.body }); delivered = true; }
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : "mail failed"); }
  }
  return errors.length > 0 && !delivered ? { delivered: false, error: errors.join("; ") } : { delivered, error: errors.length ? errors.join("; ") : undefined };
}

export async function runReminderTick(): Promise<{ generated: number; delivered: number; missed: number }> {
  const now = new Date(); const values = await loadExpandedItems(); const workspaceIds = [...new Set(values.map((item) => item.workspaceId))]; const semesterRows = workspaceIds.length > 0 ? await db.select().from(appSettings).where(inArray(appSettings.workspaceId, workspaceIds)) : []; const semesterByWorkspace = new Map(semesterRows.map((row) => [row.workspaceId, row.semesterStartDate ? new Date(`${row.semesterStartDate}T12:00:00`) : null])); let generated = 0;
  for (const item of values) {
    const rules = item.reminders.filter((rule) => rule.enabled);
    if (rules.length === 0) continue;
    const occurrences: ExpandedOccurrence[] = expandItems([item], new Date(now.getTime() - 86400000), new Date(now.getTime() + 172800000), semesterByWorkspace.get(item.workspaceId) ?? null);
    if (occurrences.length === 0 && item.dueAt) occurrences.push({ id: item.id, occurrenceKey: item.id, itemId: item.id, item, start: new Date(item.dueAt), end: new Date(item.dueAt), allDay: item.isAllDay, recurring: false, overridden: false });
    for (const occurrence of occurrences) for (const rule of rules) {
      const scheduledAt = rule.trigger === "before_start"
        ? new Date(occurrence.start.getTime() - rule.offsetMinutes * 60000)
        : rule.trigger === "at_start"
          ? occurrence.start
          : occurrence.end;
      if (scheduledAt < new Date(now.getTime() - 86400000) || scheduledAt > new Date(now.getTime() + 86400000)) continue;
      const inserted = await db.insert(deliveries).values({ workspaceId: item.workspaceId, itemId: item.id, ruleId: rule.id ?? null, occurrenceKey: occurrence.occurrenceKey, scheduledAt, channel: rule.channels.join(","), status: "pending" }).onConflictDoNothing().returning({ id: deliveries.id });
      generated += inserted.length;
    }
  }
  const due = await db.select().from(deliveries).where(and(or(eq(deliveries.status, "pending"), eq(deliveries.status, "failed")), or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, now)), lte(deliveries.scheduledAt, now))).limit(100);
  let delivered = 0; let missed = 0;
  for (const delivery of due) {
    const [item] = await db.select().from(items).where(eq(items.id, delivery.itemId)).limit(1); if (!item) continue;
    const result = await sendChannels(delivery.workspaceId, item.id, delivery.id, delivery.channel.split(","), item.title, item.startAt ?? now, item.location);
    const wentMissed = now.getTime() - delivery.scheduledAt.getTime() > 600000;
    await db.update(deliveries).set({ status: result.delivered ? (wentMissed ? "missed" : "delivered") : "failed", deliveredAt: result.delivered ? now : null, attempt: delivery.attempt + 1, lastError: result.error ?? null, nextAttemptAt: result.delivered ? null : new Date(now.getTime() + Math.min(60, 2 ** delivery.attempt) * 60000), updatedAt: now }).where(eq(deliveries.id, delivery.id));
    if (result.delivered) { delivered += 1; if (wentMissed) missed += 1; }
  }
  const repeated = await db.select().from(deliveries).where(and(eq(deliveries.status, "delivered"), isNull(deliveries.acknowledgedAt), lte(deliveries.deliveredAt, new Date(now.getTime() - 300000)))).limit(100);
  for (const delivery of repeated) {
    const [item] = await db.select().from(items).where(eq(items.id, delivery.itemId)).limit(1); if (!item) continue;
    const [rule] = delivery.ruleId ? await db.select().from(reminderRules).where(eq(reminderRules.id, delivery.ruleId)).limit(1) : [];
    const repeat = rule?.repeatEveryMinutes ?? 5; if (repeat <= 0) continue; const eventEnd = item.endAt ?? item.startAt; const eventTime = eventEnd ? new Date(eventEnd).getTime() : now.getTime();
    const hardStop = item.startAt ? Math.min(new Date(item.startAt).getTime() + 86400000, eventTime) : now.getTime();
    if (!delivery.deliveredAt || delivery.deliveredAt.getTime() + repeat * 60000 > now.getTime() || now.getTime() > hardStop) continue;
    await db.update(deliveries).set({ status: "pending", scheduledAt: now, deliveredAt: null, updatedAt: now }).where(eq(deliveries.id, delivery.id));
  }
  return { generated, delivered, missed };
}
