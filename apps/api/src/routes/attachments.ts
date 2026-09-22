import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { attachments, items } from "@calendar/db/schema";
import { config } from "../config";
import { db } from "../context";
import { blockDemoFeature, requireAuth, type AppEnv } from "../middleware";

const s3 = new S3Client({ region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } });
const masterKey = Buffer.from(config.ATTACHMENT_MASTER_KEY, "base64");
if (masterKey.length !== 32) throw new Error("ATTACHMENT_MASTER_KEY 必须是 32 字节 Base64");

function encrypt(buffer: Buffer) {
  const dataKey = randomBytes(32); const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]); const authTag = cipher.getAuthTag();
  const wrapIv = randomBytes(12); const wrap = createCipheriv("aes-256-gcm", masterKey, wrapIv);
  const wrapped = Buffer.concat([wrap.update(dataKey), wrap.final()]); const wrapTag = wrap.getAuthTag();
  return { ciphertext, iv: iv.toString("base64"), authTag: authTag.toString("base64"), wrappedKey: JSON.stringify({ iv: wrapIv.toString("base64"), tag: wrapTag.toString("base64"), key: wrapped.toString("base64") }) };
}

function unwrapDataKey(wrappedKey: string): Buffer {
  const wrapper = JSON.parse(wrappedKey) as { iv: string; tag: string; key: string };
  const unwrap = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(wrapper.iv, "base64")); unwrap.setAuthTag(Buffer.from(wrapper.tag, "base64"));
  return Buffer.concat([unwrap.update(Buffer.from(wrapper.key, "base64")), unwrap.final()]);
}

function wrapDataKey(dataKey: Buffer): string {
  const wrapIv = randomBytes(12); const wrap = createCipheriv("aes-256-gcm", masterKey, wrapIv);
  const wrapped = Buffer.concat([wrap.update(dataKey), wrap.final()]); const wrapTag = wrap.getAuthTag();
  return JSON.stringify({ iv: wrapIv.toString("base64"), tag: wrapTag.toString("base64"), key: wrapped.toString("base64") });
}

function signUploadToken(payload: { id: string; itemId: string; workspaceId: string; objectKey: string }): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", masterKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyUploadToken(token: string): { id: string; itemId: string; workspaceId: string; objectKey: string } {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("上传凭证无效");
  const expected = createHmac("sha256", masterKey).update(encoded).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error("上传凭证无效");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { id: string; itemId: string; workspaceId: string; objectKey: string };
}
function decrypt(ciphertext: Buffer, iv: string, authTag: string, wrappedKey: string) {
  const wrapper = JSON.parse(wrappedKey) as { iv: string; tag: string; key: string };
  const unwrap = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(wrapper.iv, "base64")); unwrap.setAuthTag(Buffer.from(wrapper.tag, "base64"));
  const dataKey = Buffer.concat([unwrap.update(Buffer.from(wrapper.key, "base64")), unwrap.final()]);
  const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(iv, "base64")); decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export const attachmentsRoute = new Hono<AppEnv>();
attachmentsRoute.use("*", requireAuth, blockDemoFeature("attachments"));

attachmentsRoute.get("/items/:itemId/attachments", async (c) => {
  const auth = c.get("auth");
  const rows = await db.select().from(attachments).where(and(eq(attachments.workspaceId, auth.workspaceId), eq(attachments.itemId, c.req.param("itemId"))));
  return c.json({ attachments: rows.filter((row) => !row.deletedAt).map(({ iv, authTag, wrappedKey, ...safe }) => safe) });
});

attachmentsRoute.post("/items/:itemId/attachments/init", async (c) => {
  const auth = c.get("auth"); const itemId = c.req.param("itemId");
  const [item] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.workspaceId, auth.workspaceId))).limit(1);
  if (!item) return c.json({ error: "NOT_FOUND" }, 404);
  const body = z.object({ fileName: z.string().min(1).max(500), mimeType: z.string().max(200).default("application/octet-stream"), size: z.number().int().positive() }).parse(await c.req.json());
  if (body.size > config.MAX_ATTACHMENT_MB * 1024 * 1024) return c.json({ error: "FILE_TOO_LARGE" }, 413);
  const id = randomUUID(); const objectKey = `attachments/${auth.workspaceId}/${itemId}/${id}`; const dataKey = randomBytes(32);
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey, ContentType: "application/octet-stream" }), { expiresIn: 900 });
  return c.json({ attachmentId: id, uploadUrl, uploadToken: signUploadToken({ id, itemId, workspaceId: auth.workspaceId, objectKey }), dataKey: dataKey.toString("base64"), headers: { "Content-Type": "application/octet-stream" } });
});
attachmentsRoute.post("/items/:itemId/attachments", async (c) => {
  const auth = c.get("auth"); const itemId = c.req.param("itemId");
  const [item] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.workspaceId, auth.workspaceId))).limit(1);
  if (!item) return c.json({ error: "NOT_FOUND" }, 404);
  const form = await c.req.formData(); const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "FILE_REQUIRED" }, 400);
  if (file.size > config.MAX_ATTACHMENT_MB * 1024 * 1024) return c.json({ error: "FILE_TOO_LARGE" }, 413);
  const bytes = Buffer.from(await file.arrayBuffer()); const encrypted = encrypt(bytes); const id = randomUUID();
  const objectKey = `attachments/${auth.workspaceId}/${itemId}/${id}`;
  await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey, Body: encrypted.ciphertext, ContentType: "application/octet-stream" }));
  const [created] = await db.insert(attachments).values({ workspaceId: auth.workspaceId, itemId, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, objectKey, iv: encrypted.iv, authTag: encrypted.authTag, wrappedKey: encrypted.wrappedKey, sha256: createHash("sha256").update(bytes).digest("hex") }).returning();
  return c.json({ attachment: created }, 201);
});

attachmentsRoute.post("/attachments/:id/finalize", async (c) => {
  const auth = c.get("auth"); const body = z.object({ uploadToken: z.string().min(1), fileName: z.string().min(1).max(500), mimeType: z.string().max(200).default("application/octet-stream"), size: z.number().int().positive(), dataKey: z.string(), iv: z.string(), authTag: z.string(), sha256: z.string().length(64) }).parse(await c.req.json());
  const token = verifyUploadToken(body.uploadToken);
  if (token.workspaceId !== auth.workspaceId || token.id !== c.req.param("id")) return c.json({ error: "INVALID_UPLOAD_TOKEN" }, 400);
  const dataKey = Buffer.from(body.dataKey, "base64"); if (dataKey.length !== 32) return c.json({ error: "INVALID_DATA_KEY" }, 400);
  const head = await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: token.objectKey }));
  if (Number(head.ContentLength ?? 0) !== body.size) return c.json({ error: "UPLOAD_SIZE_MISMATCH" }, 400);
  const [created] = await db.insert(attachments).values({ id: token.id, workspaceId: auth.workspaceId, itemId: token.itemId, fileName: body.fileName, mimeType: body.mimeType, size: body.size, objectKey: token.objectKey, iv: body.iv, authTag: body.authTag, wrappedKey: wrapDataKey(dataKey), sha256: body.sha256 }).returning();
  return c.json({ attachment: created }, 201);
});

attachmentsRoute.get("/attachments/:id/access", async (c) => {
  const auth = c.get("auth");
  const [attachment] = await db.select().from(attachments).where(and(eq(attachments.id, c.req.param("id")), eq(attachments.workspaceId, auth.workspaceId))).limit(1);
  if (!attachment || attachment.deletedAt) return c.json({ error: "NOT_FOUND" }, 404);
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: attachment.objectKey }), { expiresIn: 600 });
  return c.json({ attachment: { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, iv: attachment.iv, authTag: attachment.authTag, dataKey: unwrapDataKey(attachment.wrappedKey).toString("base64"), downloadUrl: url } });
});
attachmentsRoute.get("/attachments/:id/content", async (c) => {
  const auth = c.get("auth");
  const [attachment] = await db.select().from(attachments).where(and(eq(attachments.id, c.req.param("id")), eq(attachments.workspaceId, auth.workspaceId))).limit(1);
  if (!attachment || attachment.deletedAt) return c.json({ error: "NOT_FOUND" }, 404);
  const object = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: attachment.objectKey }));
  const body = await object.Body?.transformToByteArray(); if (!body) return c.json({ error: "EMPTY_FILE" }, 500);
  const bytes = decrypt(Buffer.from(body), attachment.iv, attachment.authTag, attachment.wrappedKey);
  const inline = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "application/pdf", "text/plain", "text/markdown"].includes(attachment.mimeType);
  return new Response(bytes, { headers: { "Content-Type": attachment.mimeType, "Content-Length": String(bytes.length), "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`, "Cache-Control": "private, max-age=3600" } });
});

attachmentsRoute.delete("/attachments/:id", async (c) => {
  const auth = c.get("auth");
  const [attachment] = await db.update(attachments).set({ deletedAt: new Date() }).where(and(eq(attachments.id, c.req.param("id")), eq(attachments.workspaceId, auth.workspaceId))).returning();
  if (!attachment) return c.json({ error: "NOT_FOUND" }, 404);
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: attachment.objectKey })).catch(() => undefined);
  return c.json({ deleted: true });
});