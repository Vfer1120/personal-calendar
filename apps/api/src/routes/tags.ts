import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { tags } from "@calendar/db/schema";
import { db } from "../context";
import { requireAuth, type AppEnv } from "../middleware";
import { loadTags, writeChange } from "../services/items";

export const tagsRoute = new Hono<AppEnv>();
tagsRoute.use("*", requireAuth);
const inputSchema = z.object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });

tagsRoute.get("/", async (c) => c.json({ tags: await loadTags(db, c.get("auth").workspaceId) }));
tagsRoute.post("/", async (c) => {
  const input = inputSchema.parse(await c.req.json());
  const [created] = await db.insert(tags).values({ ...input, workspaceId: c.get("auth").workspaceId }).returning();
  if (!created) return c.json({ error: "CREATE_FAILED" }, 500);
  await writeChange(db, c.get("auth").workspaceId, "tag", created.id, "create", created.version, { id: created.id });
  return c.json({ tag: created }, 201);
});
tagsRoute.patch("/:id", async (c) => {
  const input = inputSchema.partial().parse(await c.req.json());
  const [updated] = await db.update(tags).set({ ...input, updatedAt: new Date() }).where(and(eq(tags.id, c.req.param("id")), eq(tags.workspaceId, c.get("auth").workspaceId))).returning();
  if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ tag: updated });
});
tagsRoute.delete("/:id", async (c) => {
  const [deleted] = await db.delete(tags).where(and(eq(tags.id, c.req.param("id")), eq(tags.workspaceId, c.get("auth").workspaceId))).returning();
  if (!deleted) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ deleted: true });
});