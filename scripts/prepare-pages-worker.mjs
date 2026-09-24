import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "worker", "index.mjs");
const target = path.join(root, "apps", "web", "dist", "_worker.js");
await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
console.log("Copied Cloudflare Pages worker to apps/web/dist/_worker.js");