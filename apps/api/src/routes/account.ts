import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { user } from "@calendar/db/schema";
import { auth, db } from "../context";
import { config } from "../config";
import type { AppEnv } from "../middleware";

export const accountRoute = new Hono<AppEnv>();

function accountEmail(username: string) {
  return `${username.toLowerCase()}@calendar.local`;
}

accountRoute.post("/register", async (c) => {
  const input = z.object({
    username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
    password: z.string().min(8).max(128),
    inviteCode: z.string().min(1)
  }).parse(await c.req.json());
  if (!config.ALLOW_MULTI_USER && config.NODE_ENV === "production") return c.json({ error: "REGISTRATION_DISABLED", message: "当前实例未开放注册" }, 403);
  if (!config.REGISTRATION_INVITE_CODE || input.inviteCode !== config.REGISTRATION_INVITE_CODE) return c.json({ error: "INVALID_INVITE_CODE", message: "邀请码不正确" }, 403);
  const email = accountEmail(input.username);
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing) return c.json({ error: "USERNAME_EXISTS", message: "该用户名已被使用" }, 409);
  const origin = new URL(config.BETTER_AUTH_URL).origin;
  const response = await auth.handler(new Request(new URL("/api/auth/sign-up/email", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: config.APP_URL },
    body: JSON.stringify({ email, password: input.password, name: input.username })
  }));
  const body = await response.text();
  return new Response(body, { status: response.status, headers: response.headers });
});

accountRoute.post("/username-available", async (c) => {
  const input = z.object({ username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/) }).parse(await c.req.json());
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, accountEmail(input.username))).limit(1);
  return c.json({ available: !existing });
});