import "dotenv/config";
import { z } from "zod";

export const config = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEMO_MODE: z.string().default("false").transform((value) => value === "true" || value === "1"),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
  APP_URL: z.string().url().default("http://localhost:5173"),
  SMTP_URL: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  SMTP2GO_API_KEY: z.string().optional(),
  MAILJET_API_KEY: z.string().optional(),
  MAILJET_SECRET_KEY: z.string().optional(),
  SMTP_FROM: z.string().default("Calendar <calendar@example.com>"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  ATTACHMENT_MASTER_KEY: z.string().default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  BACKUP_DIR: z.string().default("./backups"),
  BACKUP_RETENTION_DAILY: z.coerce.number().int().positive().default(7),
  BACKUP_RETENTION_WEEKLY: z.coerce.number().int().positive().default(4),
  BACKUP_RETENTION_MONTHLY: z.coerce.number().int().positive().default(12)
}).parse(process.env);