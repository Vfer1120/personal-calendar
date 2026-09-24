import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { sql } from "drizzle-orm";
import { user } from "@calendar/db/schema";
import { auth, db } from "./context";
import { DEMO_COOKIE, resolveDemoSession } from "./demo";
import { config, corsOrigins } from "./config";
import { subscribe } from "./events";
import { requireAuth, type AppEnv } from "./middleware";
import { aiRoute } from "./routes/ai";
import { accountRoute } from "./routes/account";
import { cronRoute } from "./routes/cron";
import { demoRoute } from "./routes/demo";
import { reviewsRoute } from "./routes/reviews";
import { itemsRoute } from "./routes/items";
import { tagsRoute } from "./routes/tags";
import { syncRoute } from "./routes/sync";
import { remindersRoute } from "./routes/reminders";
import { schedulePeriodsRoute } from "./routes/schedule-periods";
import { settingsRoute } from "./routes/settings";
import { attachmentsRoute } from "./routes/attachments";
import { interchangeRoute } from "./routes/interchange";
import { publicIcsRoute, subscriptionsRoute } from "./routes/subscriptions";

export const app = new Hono<AppEnv>();
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors({ origin: corsOrigins, credentials: true, allowHeaders: ["Content-Type", "Authorization", "x-bootstrap-token"], allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] }));
app.get("/health", async (c) => { await db.execute(sql`select 1`); return c.json({ status: "ok", time: new Date().toISOString() }); });
if (!config.DEMO_MODE) {
  app.use("/api/auth/email-otp/send-verification-otp", async (c, next) => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(user);
    if ((row?.count ?? 0) === 0 && c.req.header("x-bootstrap-token") !== config.BOOTSTRAP_TOKEN) return c.json({ error: "INVALID_BOOTSTRAP_TOKEN" }, 401);
    await next();
  });
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
}
app.get("/api/v1/bootstrap", async (c) => {
  if (config.DEMO_MODE) {
    const session = await resolveDemoSession(getCookie(c, DEMO_COOKIE));
    return c.json({ requiresSetup: false, ownerEmailConfigured: false, appName: "个人日程 · 体验站", demoMode: true, demoAuthenticated: Boolean(session), demoExpiresAt: session?.expiresAt.toISOString() ?? null, multiUser: false, registrationInviteRequired: false });
  }
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(user);
  return c.json({ requiresSetup: (row?.count ?? 0) === 0, ownerEmailConfigured: Boolean(config.OWNER_EMAIL), appName: "个人日程", demoMode: false, demoAuthenticated: false, demoExpiresAt: null, multiUser: config.ALLOW_MULTI_USER, registrationInviteRequired: config.ALLOW_MULTI_USER });
});
app.route("/api/v1/demo", demoRoute);
app.get("/api/v1/me", requireAuth, (c) => c.json({ user: c.get("auth") }));
app.get("/api/v1/events", requireAuth, async (c) => {
  const authContext = c.get("auth");
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribe(authContext.workspaceId, (event) => { void stream.writeSSE({ data: JSON.stringify(event) }); });
    stream.onAbort(unsubscribe);
    await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) });
    await new Promise<void>((resolve) => { c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true }); });
  });
});
app.route("/api/v1/account", accountRoute);
app.route("/api/v1/ai", aiRoute);
app.route("/api/v1/internal/cron", cronRoute);
app.route("/api/v1/items", itemsRoute);
app.route("/api/v1/reviews", reviewsRoute);
app.route("/api/v1/tags", tagsRoute);
app.route("/api/v1/sync", syncRoute);
app.route("/api/v1/reminders", remindersRoute);
app.route("/api/v1/settings", settingsRoute);
app.route("/api/v1/schedule-periods", schedulePeriodsRoute);
app.route("/api/v1", attachmentsRoute);
app.route("/api/v1/exchange", interchangeRoute);
app.route("/api/v1/subscriptions", subscriptionsRoute);
app.route("/api/v1/ics", publicIcsRoute);
if (config.SERVE_WEB) {
  app.use("*", serveStatic({ root: config.WEB_DIST }));
  app.get("*", serveStatic({ path: "index.html" }));
}
app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));
app.onError((error, c) => { console.error(error); return c.json({ error: "INTERNAL_ERROR", message: config.NODE_ENV === "production" ? "服务暂时不可用" : error.message }, 500); });