import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AppEnv } from "../middleware";
import { listReviews, resolveItemOutcome } from "../services/resolution";

export const reviewsRoute = new Hono<AppEnv>();
reviewsRoute.use("*", requireAuth);

reviewsRoute.get("/", async (c) => c.json({ reviews: await listReviews(c.get("auth").workspaceId) }));

reviewsRoute.post("/batch", async (c) => {
  const input = z.object({ entries: z.array(z.object({ itemId: z.string().uuid(), occurrenceKey: z.string().nullable().optional(), outcome: z.enum(["completed", "partial", "postponed", "cancelled"]), startAt: z.string().datetime({ offset: true }).nullable().optional(), endAt: z.string().datetime({ offset: true }).nullable().optional(), dueAt: z.string().datetime({ offset: true }).nullable().optional() })).min(1).max(200) }).parse(await c.req.json());
  const results = [];
  for (const entry of input.entries) results.push(await resolveItemOutcome(c.get("auth").workspaceId, entry));
  return c.json({ resolved: results.filter(Boolean).length });
});
