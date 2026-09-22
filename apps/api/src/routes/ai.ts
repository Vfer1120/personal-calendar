import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config";
import { requireAuth, type AppEnv } from "../middleware";
import { AiError, aiConfigured, extractScheduleDrafts, getAiStatus, reserveAiUsage } from "../services/ai";

export const aiRoute = new Hono<AppEnv>();
aiRoute.use("*", requireAuth);

const s3 = new S3Client({ region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } });
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const directUploadSchema = z.object({ uploadToken: z.string().min(1), fileName: z.string().min(1).max(500), mimeType: z.string(), size: z.number().int().positive() });
const directExtractSchema = z.object({ text: z.string().max(20_000).default(""), timezone: z.string().min(1).max(100).default(config.DEFAULT_TIMEZONE), images: z.array(directUploadSchema).max(config.AI_MAX_IMAGES).default([]) });

function uploadToken(payload: { workspaceId: string; objectKey: string; mimeType: string; size: number }) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", config.BETTER_AUTH_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyUploadToken(token: string, workspaceId: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("图片上传凭证无效");
  const expected = createHmac("sha256", config.BETTER_AUTH_SECRET).update(encoded).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error("图片上传凭证无效");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { workspaceId: string; objectKey: string; mimeType: string; size: number };
  if (payload.workspaceId !== workspaceId) throw new Error("图片上传凭证无效");
  return payload;
}

aiRoute.get("/status", async (c) => c.json(await getAiStatus(c.get("auth").workspaceId)));

aiRoute.post("/uploads/init", async (c) => {
  const workspaceId = c.get("auth").workspaceId;
  const input = z.object({ fileName: z.string().min(1).max(500), mimeType: z.string(), size: z.number().int().positive() }).parse(await c.req.json());
  if (!allowedImageTypes.has(input.mimeType)) return c.json({ error: "UNSUPPORTED_IMAGE", message: "仅支持 JPEG、PNG、WebP 图片" }, 415);
  if (input.size > config.AI_MAX_IMAGE_MB * 1024 * 1024) return c.json({ error: "IMAGE_TOO_LARGE", message: `单张图片不能超过 ${config.AI_MAX_IMAGE_MB}MB` }, 413);
  const objectKey = `ai-temp/${workspaceId}/${randomUUID()}`;
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey, ContentType: input.mimeType }), { expiresIn: 900 });
  return c.json({ uploadUrl, uploadToken: uploadToken({ workspaceId, objectKey, mimeType: input.mimeType, size: input.size }), headers: { "Content-Type": input.mimeType } });
});

aiRoute.post("/extract", async (c) => {
  const workspaceId = c.get("auth").workspaceId;
  let text = ""; let timezone = config.DEFAULT_TIMEZONE; const images: Array<{ mimeType: string; fileName: string; data: Buffer }> = []; const cleanup: string[] = [];
  const contentType = c.req.header("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = directExtractSchema.parse(await c.req.json());
      text = body.text.trim(); timezone = body.timezone;
      for (const item of body.images) {
        const token = verifyUploadToken(item.uploadToken, workspaceId);
        if (token.size !== item.size || token.mimeType !== item.mimeType) throw new Error("图片元数据不匹配");
        cleanup.push(token.objectKey);
        const head = await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: token.objectKey }));
        if (Number(head.ContentLength ?? 0) !== item.size || token.size !== item.size) throw new Error("图片大小不匹配");
        const object = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: token.objectKey }));
        const data = await object.Body?.transformToByteArray();
        if (!data) throw new Error("图片读取失败");
        images.push({ mimeType: item.mimeType, fileName: item.fileName, data: Buffer.from(data) });
      }
    } else {
      const form = await c.req.formData();
      text = String(form.get("text") ?? "").trim();
      const rawTimezone = String(form.get("timezone") ?? config.DEFAULT_TIMEZONE); const timezoneCheck = z.string().min(1).max(100).safeParse(rawTimezone); timezone = timezoneCheck.success ? timezoneCheck.data : config.DEFAULT_TIMEZONE;
      const files = form.getAll("images").filter((value): value is File => value instanceof File);
      if (files.length > config.AI_MAX_IMAGES) return c.json({ error: "TOO_MANY_IMAGES", message: `最多上传 ${config.AI_MAX_IMAGES} 张图片` }, 413);
      for (const file of files) {
        if (!allowedImageTypes.has(file.type)) return c.json({ error: "UNSUPPORTED_IMAGE", message: "仅支持 JPEG、PNG、WebP 图片" }, 415);
        if (file.size > config.AI_MAX_IMAGE_MB * 1024 * 1024) return c.json({ error: "IMAGE_TOO_LARGE", message: `单张图片不能超过 ${config.AI_MAX_IMAGE_MB}MB` }, 413);
        images.push({ mimeType: file.type, fileName: file.name, data: Buffer.from(await file.arrayBuffer()) });
      }
    }
    if (text.length > 20_000) return c.json({ error: "TEXT_TOO_LONG", message: "文字最多 20000 字" }, 413);
    if (!text && images.length === 0) return c.json({ error: "EMPTY_INPUT", message: "请输入文字或选择图片" }, 400);
    if (!aiConfigured()) return c.json({ error: "AI_NOT_CONFIGURED", message: "AI 尚未配置，请先设置 AI_API_KEY 并启用 AI_ENABLED" }, 503);
    let reservedUsage: Awaited<ReturnType<typeof reserveAiUsage>> | undefined;
    try {
      reservedUsage = await reserveAiUsage(workspaceId);
      const result = await extractScheduleDrafts({ workspaceId, text, images, timezone });
      return c.json({ ...result, usage: reservedUsage });
    } catch (error) {
      if (error instanceof AiError) return c.json({ error: error.code, message: error.message, usage: error.usage ?? reservedUsage }, error.status as 400);
      return c.json({ error: "AI_FAILED", message: error instanceof Error ? error.message : "AI 提取失败" }, 500);
    }
  } catch (error) {
    return c.json({ error: "INVALID_INPUT", message: error instanceof Error ? error.message : "请提交文字或图片" }, 400);
  } finally {
    await Promise.all(cleanup.map((key) => s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key })).catch(() => undefined)));
  }
});