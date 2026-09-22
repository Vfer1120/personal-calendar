import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../config";
import { pool } from "../context";
import { runReminderTick } from "../../../worker/src/reminders";
import { refreshDueSubscriptions } from "../../../worker/src/subscriptions";
import type { AppEnv } from "../middleware";

export const cronRoute = new Hono<AppEnv>();
const LOCKS: Record<string, number> = { reminders: 902001, subscriptions: 902002, cleanup: 902003 };

cronRoute.post("/:task", async (c) => {
  if (!config.CRON_SECRET || c.req.header("x-cron-secret") !== config.CRON_SECRET) return c.json({ error: "UNAUTHORIZED" }, 401);
  const task = c.req.param("task");
  const lockId = LOCKS[task];
  if (!lockId) return c.json({ error: "UNKNOWN_TASK" }, 404);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ locked: boolean }>("select pg_try_advisory_xact_lock($1) as locked", [lockId]);
    if (!result.rows[0]?.locked) { await client.query("rollback"); return c.json({ skipped: true, reason: "already_running" }, 202); }
    try {
      let payload: unknown;
      if (task === "reminders") payload = await runReminderTick();
      else if (task === "subscriptions") payload = await refreshDueSubscriptions();
      else { await client.query('delete from workspaces where id in (select workspace_id from demo_sessions where expires_at <= now())'); payload = "cleaned"; }
      await client.query("commit");
      return c.json({ ok: true, result: payload });
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
});