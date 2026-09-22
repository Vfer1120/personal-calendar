import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, copyFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

function runPgDump(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; const errors: Buffer[] = [];
    const child = spawn("pg_dump", ["--no-owner", "--no-acl", "--clean", "--if-exists", config.DATABASE_URL]);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errors).toString() || `pg_dump exited ${code}`)));
  });
}

function encryptBackup(buffer: Buffer) {
  const key = createHash("sha256").update(config.ATTACHMENT_MASTER_KEY).digest(); const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([Buffer.from("PCAL1"), iv, cipher.getAuthTag(), encrypted]);
}

async function prune(directory: string, prefix: string, keep: number) {
  const files = (await readdir(directory)).filter((name) => name.startsWith(prefix)).sort().reverse();
  await Promise.all(files.slice(keep).map((name) => rm(path.join(directory, name), { force: true })));
}

export async function createEncryptedBackup(): Promise<string> {
  await mkdir(config.BACKUP_DIR, { recursive: true });
  const date = new Date(); const stamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const daily = path.join(config.BACKUP_DIR, `daily-${stamp}.pcal`); const dump = await runPgDump();
  await writeFile(daily, encryptBackup(dump), { mode: 0o600 });
  if (date.getUTCDay() === 0) await copyFile(daily, path.join(config.BACKUP_DIR, `weekly-${stamp}.pcal`));
  if (date.getUTCDate() === 1) await copyFile(daily, path.join(config.BACKUP_DIR, `monthly-${stamp}.pcal`));
  await Promise.all([
    prune(config.BACKUP_DIR, "daily-", config.BACKUP_RETENTION_DAILY),
    prune(config.BACKUP_DIR, "weekly-", config.BACKUP_RETENTION_WEEKLY),
    prune(config.BACKUP_DIR, "monthly-", config.BACKUP_RETENTION_MONTHLY)
  ]);
  return daily;
}