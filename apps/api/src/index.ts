import { serve } from "@hono/node-server";
import { app } from "./app";
import { config } from "./config";
import { pool } from "./context";

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  console.info(`[api] listening on http://0.0.0.0:${info.port}`);
});

async function shutdown(signal: string) {
  console.info(`[api] ${signal}, shutting down`);
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));