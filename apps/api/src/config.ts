import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BOOTSTRAP_TOKEN: z.string().min(8),
  ALLOW_MULTI_USER: z.string().default("false").transform((value) => value === "true" || value === "1"),
  REGISTRATION_INVITE_CODE: z.string().min(8).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
  SERVE_WEB: z.string().default("false").transform((value) => value === "true" || value === "1"),
  WEB_DIST: z.string().default("./apps/web/dist"),
  OWNER_EMAIL: z.string().email().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("calendar-attachments"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  ATTACHMENT_MASTER_KEY: z.string().default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  MAX_ATTACHMENT_MB: z.coerce.number().int().positive().default(25),
  SMTP_URL: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  SMTP_FROM: z.string().default("Calendar <calendar@example.com>"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Shanghai"),
  BACKUP_RETENTION_DAILY: z.coerce.number().int().positive().default(7),
  BACKUP_RETENTION_WEEKLY: z.coerce.number().int().positive().default(4),
  BACKUP_RETENTION_MONTHLY: z.coerce.number().int().positive().default(12),
  DEMO_MODE: z.string().default("false").transform((value) => value === "true" || value === "1"),
  DEMO_ACCESS_PASSWORD: z.string().min(8).optional(),
  DEMO_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  AI_ENABLED: z.string().default("false").transform((value) => value === "true" || value === "1"),
  AI_PROVIDER: z.string().default("zhipu"),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default("https://open.bigmodel.cn/api/paas/v4"),
  AI_TEXT_MODEL: z.string().default("glm-4-flash"),
  AI_VISION_MODEL: z.string().default("glm-4v-flash"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  AI_MAX_IMAGE_MB: z.coerce.number().int().positive().default(10),
  AI_MAX_IMAGES: z.coerce.number().int().positive().max(3).default(3),
  AI_PRIVATE_DAILY_LIMIT: z.coerce.number().int().positive().default(30),
  AI_DEMO_DAILY_LIMIT: z.coerce.number().int().positive().default(3)
});

export const config = envSchema.parse(process.env);
if (config.DEMO_MODE && !config.DEMO_ACCESS_PASSWORD) throw new Error("DEMO_ACCESS_PASSWORD is required when DEMO_MODE=true");
if (config.ALLOW_MULTI_USER && !config.REGISTRATION_INVITE_CODE) throw new Error("REGISTRATION_INVITE_CODE is required when ALLOW_MULTI_USER=true");
export const corsOrigins = [...new Set(config.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean))];
export type AppConfig = typeof config;