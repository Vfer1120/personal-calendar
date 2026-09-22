import PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import { config } from "./config";
import { db, pool } from "./db";
import { createEncryptedBackup } from "./backup";
import { runReminderTick } from "./reminders";
import { refreshDueSubscriptions } from "./subscriptions";

const boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss", retryLimit: 8, retryBackoff: true, deleteAfterDays: 14 });
boss.on("error", (error) => console.error("[worker] pg-boss", error));
await boss.start();

if (config.DEMO_MODE) {
  await boss.createQueue("demo-cleanup", { name: "demo-cleanup", policy: "singleton" });
  await boss.schedule("demo-cleanup", "0 * * * *");
  await boss.work("demo-cleanup", async () => {
    const result = await db.execute(sql`delete from workspaces where id in (select workspace_id from demo_sessions where expires_at <= now())`);
    const deleted = Array.isArray(result) ? result.length : 0;
    if (deleted) console.info("[worker] expired demo workspaces cleaned", deleted);
  });
  console.info("[worker] demo mode ready");
} else {
  for (const name of ["reminder-tick", "subscription-refresh", "backup-daily"]) {
    await boss.createQueue(name, { name, policy: "singleton" });
  }
  await boss.schedule("reminder-tick", "* * * * *");
  await boss.schedule("subscription-refresh", "*/5 * * * *");
  await boss.schedule("backup-daily", "15 3 * * *");

  await boss.work("reminder-tick", async () => {
    const result = await runReminderTick();
    if (result.generated || result.delivered || result.missed) console.info("[worker] reminder tick", result);
  });
  await boss.work("subscription-refresh", async () => {
    const refreshed = await refreshDueSubscriptions();
    if (refreshed) console.info("[worker] subscriptions refreshed", refreshed);
  });
  await boss.work("backup-daily", async () => {
    const file = await createEncryptedBackup();
    console.info("[worker] backup created", file);
  });

  await runReminderTick().catch((error) => console.error("[worker] initial reminder tick", error));
  await refreshDueSubscriptions().catch((error) => console.error("[worker] initial subscription refresh", error));
  console.info("[worker] ready");
}

async function shutdown(signal: string) {
  console.info(`[worker] ${signal}, shutting down`);
  await boss.stop({ graceful: true, timeout: 15000 });
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
