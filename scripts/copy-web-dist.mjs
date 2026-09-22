import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("apps/web/dist", "dist", { recursive: true });
console.log("Copied apps/web/dist to dist");