import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "../config";
import { createDemoSession, deleteDemoWorkspace, DEMO_COOKIE, resetDemoWorkspace, resolveDemoSession } from "../demo";
import { requireAuth, type AppEnv } from "../middleware";

export const demoRoute = new Hono<AppEnv>();
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || "local";
}

function passwordMatches(value: string): boolean {
  const expected = Buffer.from(config.DEMO_ACCESS_PASSWORD ?? "");
  const actual = Buffer.from(value);
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > 10;
}

function setDemoCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, DEMO_COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: config.DEMO_SESSION_TTL_HOURS * 60 * 60
  });
}

demoRoute.get("/status", async (c) => {
  if (!config.DEMO_MODE) return c.json({ demoMode: false, active: false, expiresAt: null });
  const session = await resolveDemoSession(getCookie(c, DEMO_COOKIE));
  return c.json({ demoMode: true, active: Boolean(session), expiresAt: session?.expiresAt.toISOString() ?? null });
});

demoRoute.post("/enter", async (c) => {
  if (!config.DEMO_MODE) return c.json({ error: "NOT_FOUND" }, 404);
  const key = clientKey(c);
  if (rateLimited(key)) return c.json({ error: "DEMO_RATE_LIMITED", message: "尝试次数过多，请稍后再试" }, 429);
  const input = z.object({ password: z.string().min(1).max(256) }).parse(await c.req.json());
  if (!passwordMatches(input.password)) return c.json({ error: "INVALID_DEMO_PASSWORD", message: "邀请密码不正确" }, 401);
  attempts.delete(key);
  const session = await createDemoSession();
  setDemoCookie(c, session.token);
  return c.json({ active: true, expiresAt: session.expiresAt.toISOString() });
});

demoRoute.post("/reset", requireAuth, async (c) => {
  if (!config.DEMO_MODE) return c.json({ error: "NOT_FOUND" }, 404);
  await resetDemoWorkspace(c.get("auth").workspaceId);
  return c.json({ reset: true });
});

demoRoute.post("/leave", requireAuth, async (c) => {
  if (!config.DEMO_MODE) return c.json({ error: "NOT_FOUND" }, 404);
  await deleteDemoWorkspace(c.get("auth").workspaceId);
  deleteCookie(c, DEMO_COOKIE, { path: "/" });
  return c.json({ left: true });
});
