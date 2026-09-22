import { spawn } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "./config";

const file = process.argv[2];
if (!file) { console.error("用法: pnpm --filter @calendar/worker restore -- <backup.pcal>"); process.exit(1); }
const payload = await readFile(file);
if (payload.subarray(0, 5).toString() !== "PCAL1") throw new Error("不是有效的个人日程备份");
const iv = payload.subarray(5, 17); const tag = payload.subarray(17, 33); const ciphertext = payload.subarray(33);
const key = createHash("sha256").update(config.ATTACHMENT_MASTER_KEY).digest();
const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
const dump = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const child = spawn("psql", [config.DATABASE_URL, "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(dump);
await new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`psql exited ${code}`))); });
console.info("restore complete");