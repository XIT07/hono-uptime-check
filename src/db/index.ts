import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema.js";

// Database interface that both implementations must satisfy
export interface DatabaseAdapter {
  db: BetterSQLite3Database<typeof schema> | DrizzleD1Database<typeof schema>;
  mode: "node" | "worker";
}

// Node.js environment with better-sqlite3
export interface NodeEnv {
  DB_URL: string;
}

// Cloudflare Worker environment with D1 binding
export interface WorkerEnv {
  DB: D1Database;
}

// Combined environment type
export type AppEnv = NodeEnv | WorkerEnv;

// Check if we're in Node.js environment
function isNodeEnv(env: AppEnv): env is NodeEnv {
  return "DB_URL" in env && typeof env.DB_URL === "string";
}

// Check if we're in Worker environment
function isWorkerEnv(env: AppEnv): env is WorkerEnv {
  return "DB" in env && env.DB !== undefined;
}

// Initialize database for Node.js (lazy loaded)
async function initNodeDb(dbUrl: string): Promise<DatabaseAdapter> {
  // Dynamic imports - only loaded when called in Node.js
  const { drizzle: drizzleBetterSQLite3 } = await import("drizzle-orm/better-sqlite3");
  const { createRequire } = await import("node:module");
  const { resolve } = await import("node:path");

  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");

  // Strip 'file:' prefix if present and resolve to absolute path
  let dbPath = dbUrl;
  if (dbPath.startsWith("file:")) {
    dbPath = dbPath.slice(5);
  }
  dbPath = resolve(process.cwd(), dbPath);

  const sqlite = new Database(dbPath);
  const db = drizzleBetterSQLite3(sqlite, { schema });
  return { db, mode: "node" };
}

// Initialize database based on environment
export async function initDb(env: AppEnv): Promise<DatabaseAdapter> {
  if (isNodeEnv(env)) {
    return initNodeDb(env.DB_URL);
  }

  if (isWorkerEnv(env)) {
    const db = drizzleD1(env.DB, { schema });
    return { db, mode: "worker" };
  }

  throw new Error("Unable to initialize database: unknown environment");
}

// Re-export schema
export { schema };
export * from "./schema.js";
