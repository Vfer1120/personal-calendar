import Dexie, { type EntityTable } from "dexie";
import type { Item, SchedulePeriod, Tag } from "@calendar/domain";
import { api, apiJson } from "./api";
import type { SyncMutation } from "@calendar/domain";

export interface OutboxEntry extends SyncMutation { localId: number; createdAt: string; }
export interface AppMeta { key: string; value: unknown; }
export interface LastSession { userId: string; email: string; name: string; savedAt: string; }

type CalendarDatabase = Dexie & {
  items: EntityTable<Item, "id">;
  tags: EntityTable<Tag, "id">;
  outbox: EntityTable<OutboxEntry, "localId">;
  meta: EntityTable<AppMeta, "key">;
};

let activeScope = "";
let database: CalendarDatabase | null = null;
let scopeReady: Promise<void> = Promise.resolve();
const LAST_SESSION_KEY = "personal-calendar:last-session";
const LEGACY_MIGRATION_KEY = "personal-calendar:legacy-cache-migrated";

function scopedName(scopeId: string) { return `personal-calendar:${scopeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`; }

function createScopedDatabase(scopeId: string): CalendarDatabase {
  const value = new Dexie(scopedName(scopeId)) as CalendarDatabase;
  value.version(1).stores({ items: "id,startAt,updatedAt,status,kind", tags: "id", outbox: "++localId,entityId,clientMutationId", meta: "key" });
  return value;
}

async function migrateLegacyCache(scopeId: string) {
  if (localStorage.getItem(LEGACY_MIGRATION_KEY) === "true") return;
  try {
    const legacy = new Dexie("personal-calendar") as CalendarDatabase;
    legacy.version(1).stores({ items: "id,startAt,updatedAt,status,kind", tags: "id", outbox: "++localId,entityId,clientMutationId", meta: "key" });
    await legacy.open();
    const [items, tags, outbox, meta] = await Promise.all([legacy.items.toArray(), legacy.tags.toArray(), legacy.outbox.toArray(), legacy.meta.toArray()]);
    const current = database ?? createScopedDatabase(scopeId);
    if (items.length || tags.length || outbox.length || meta.length) {
      await current.transaction("rw", current.items, current.tags, current.outbox, current.meta, async () => {
        if (items.length) await current.items.bulkPut(items);
        if (tags.length) await current.tags.bulkPut(tags);
        if (outbox.length) await current.outbox.bulkPut(outbox);
        if (meta.length) await current.meta.bulkPut(meta);
      });
    }
    await legacy.delete();
    localStorage.setItem(LEGACY_MIGRATION_KEY, "true");
  } catch {
    localStorage.setItem(LEGACY_MIGRATION_KEY, "true");
    // A missing or already-removed legacy database is harmless.
  }
}

export function configureOfflineScope(scopeId: string) {
  if (!scopeId) throw new Error("离线缓存需要账号 ID");
  if (activeScope === scopeId && database) return;
  activeScope = scopeId;
  database = createScopedDatabase(scopeId);
  scopeReady = migrateLegacyCache(scopeId);
}

async function getDatabase(): Promise<CalendarDatabase> {
  await scopeReady;
  if (!database) throw new Error("离线缓存尚未初始化");
  return database;
}

export async function cacheItems(items: Item[]) { const db = await getDatabase(); await db.items.bulkPut(items.filter((item) => item.status !== "deleted")); }
export async function cacheTags(tags: Tag[]) { const db = await getDatabase(); await db.tags.bulkPut(tags); }
export async function getCachedItems() { const db = await getDatabase(); return db.items.filter((item) => item.status !== "deleted").toArray(); }
export async function getCachedTags() { const db = await getDatabase(); return db.tags.toArray(); }
export async function upsertCachedItem(item: Item) { const db = await getDatabase(); await db.items.put(item); }
export async function removeCachedItem(id: string) { const db = await getDatabase(); await db.items.delete(id); }
export async function cacheSettings(value: unknown) { const db = await getDatabase(); await db.meta.put({ key: "settings", value }); }
export async function getCachedSettings<T>() { const db = await getDatabase(); return (await db.meta.get("settings"))?.value as T | undefined; }
export async function cacheSchedulePeriods(value: SchedulePeriod[]) { const db = await getDatabase(); await db.meta.put({ key: "schedule-periods", value }); }
export async function getCachedSchedulePeriods() { const db = await getDatabase(); return ((await db.meta.get("schedule-periods"))?.value as SchedulePeriod[] | undefined) ?? []; }
export async function clearOfflineData() { const db = await getDatabase(); await db.delete(); database = createScopedDatabase(activeScope); await database.open(); }

export function saveLastSession(session: LastSession) { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(session)); }
export function getLastSession(): LastSession | null { try { const value = localStorage.getItem(LAST_SESSION_KEY); return value ? JSON.parse(value) as LastSession : null; } catch { return null; } }
export function clearLastSession() { localStorage.removeItem(LAST_SESSION_KEY); }

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function queueMutation(mutation: Omit<SyncMutation, "clientMutationId">) {
  const db = await getDatabase();
  const clientMutationId = crypto.randomUUID();
  await db.outbox.add({ ...mutation, clientMutationId, createdAt: new Date().toISOString() } as OutboxEntry);
  return clientMutationId;
}

export async function flushOutbox(): Promise<{ applied: number; conflicts: number }> {
  if (!navigator.onLine) return { applied: 0, conflicts: 0 };
  const db = await getDatabase();
  const entries = await db.outbox.orderBy("localId").limit(200).toArray();
  if (entries.length === 0) return { applied: 0, conflicts: 0 };
  const response = await apiJson<{ applied: Array<{ clientMutationId: string }>; conflicts: unknown[] }>("/api/v1/sync/push", "POST", { mutations: entries.map(({ localId, createdAt, ...mutation }) => mutation) });
  const appliedIds = new Set(response.applied.map((value) => value.clientMutationId));
  await db.outbox.bulkDelete(entries.filter((entry) => appliedIds.has(entry.clientMutationId)).map((entry) => entry.localId));
  if (response.conflicts.length > 0) await db.meta.put({ key: "sync-conflicts", value: response.conflicts });
  return { applied: appliedIds.size, conflicts: response.conflicts.length };
}

export async function pullChanges() {
  const db = await getDatabase();
  const cursorRow = await db.meta.get("sync-cursor"); const cursor = typeof cursorRow?.value === "string" ? cursorRow.value : "0";
  const response = await api<{ changes: Array<{ entity: string; payload: Item | Tag | null }>; cursor: string }>(`/api/v1/sync/pull?cursor=${encodeURIComponent(cursor)}`);
  const itemChanges = response.changes.filter((change) => change.entity === "item" && change.payload).map((change) => change.payload as Item); const deletedItemIds = itemChanges.filter((item) => item.status === "deleted").map((item) => item.id); const items = itemChanges.filter((item) => item.status !== "deleted"); if (deletedItemIds.length) await db.items.bulkDelete(deletedItemIds);
  const tags = response.changes.filter((change) => change.entity === "tag" && change.payload).map((change) => change.payload as Tag);
  if (items.length) await db.items.bulkPut(items); if (tags.length) await db.tags.bulkPut(tags);
  await db.meta.put({ key: "sync-cursor", value: response.cursor });
  return response.changes.length;
}

export async function bootstrapOfflineData() {
  try {
    const db = await getDatabase();
    const [itemsResponse, tagsResponse] = await Promise.all([api<{ items: Item[] }>("/api/v1/items"), api<{ tags: Tag[] }>("/api/v1/tags")]);
    await Promise.all([cacheItems(itemsResponse.items), cacheTags(tagsResponse.tags)]); await flushOutbox().catch(() => undefined); await pullChanges().catch(() => undefined);
    return itemsResponse.items;
  } catch { return getCachedItems(); }
}