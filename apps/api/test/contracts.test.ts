import { describe, expect, it } from "vitest";
import { itemInputSchema, syncPushSchema } from "@calendar/domain";

describe("API contracts", () => {
  it("requires a start time for events", () => {
    expect(itemInputSchema.safeParse({ kind: "event", title: "会议" }).success).toBe(false);
  });
  it("allows unscheduled tasks", () => {
    expect(itemInputSchema.safeParse({ kind: "task", title: "整理资料" }).success).toBe(true);
  });
  it("allows a combined schedule and task without a start time", () => {
    expect(itemInputSchema.safeParse({ kind: "both", title: "整理并安排会议" }).success).toBe(true);
  });
  it("accepts partial task status and rollover settings", () => {
    const parsed = itemInputSchema.parse({ kind: "task", title: "期中复习", status: "partial", autoRollover: true });
    expect(parsed.status).toBe("partial");
    expect(parsed.autoRollover).toBe(true);
    expect(parsed.showInTimetable).toBe(false);
  });
  it("defaults old reminder payloads to before_start", () => {
    const parsed = itemInputSchema.parse({ kind: "task", title: "旧提醒", reminders: [{ offsetMinutes: 15 }] });
    expect(parsed.reminders[0]?.trigger).toBe("before_start");
  });
  it("limits mutation batches", () => {
    const mutation = { clientMutationId: "1", entity: "item", action: "delete", entityId: crypto.randomUUID(), fields: {} };
    expect(syncPushSchema.safeParse({ mutations: Array.from({ length: 501 }, (_, index) => ({ ...mutation, clientMutationId: String(index) })) }).success).toBe(false);
  });
});