import { createDatabase } from "@calendar/db";
import { config } from "./config";

export const { db, pool } = createDatabase(config.DATABASE_URL, config.DB_POOL_MAX);