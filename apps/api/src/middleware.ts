import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "./config";
import { db, getAuthContext, type AuthContextValue } from "./context";
import { DEMO_COOKIE, resolveDemoSession } from "./demo";

export type AppEnv = { Variables: { auth: AuthContextValue } };

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const context = config.DEMO_MODE ? (await resolveDemoSession(getCookie(c, DEMO_COOKIE)))?.auth ?? null : await getAuthContext(db, c.req.raw.headers);
  if (!context) return c.json({ error: config.DEMO_MODE ? "DEMO_ACCESS_REQUIRED" : "UNAUTHORIZED", message: config.DEMO_MODE ? "请输入体验邀请密码" : "请先登录" }, 401);
  c.set("auth", context);
  await next();
};

export const blockDemoFeature = (feature: string): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (config.DEMO_MODE) return c.json({ error: "DEMO_FEATURE_DISABLED", feature, message: "体验模式暂不支持此功能" }, 403);
  await next();
};
