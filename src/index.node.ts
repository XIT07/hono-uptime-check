#!/usr/bin/env node
/**
 * Node.js Entry Point
 *
 * This file is the entry point for running the Hono Health API on Node.js.
 * It uses better-sqlite3 for the database and supports full TCP port checking.
 */

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { initDb } from "./db/index.js";
import type { Config } from "./types/index.js";
import { mkdirSync } from "fs";
import { dirname } from "path";

// Load environment variables
function loadConfig(): Config {
  const dbUrl = process.env.DB_URL ?? "file:./data/app.db";

  // Ensure data directory exists for SQLite
  if (dbUrl.startsWith("file:")) {
    const dbPath = dbUrl.slice(5);
    const dir = dirname(dbPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  if (!process.env.API_TOKEN) {
    throw new Error("API_TOKEN is required. Set it in .env file or as environment variable");
  }

  return {
    mode: "node",
    apiToken: process.env.API_TOKEN,
    maxTargetsPerRequest: parseInt(process.env.MAX_TARGETS_PER_REQUEST ?? "10", 10),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? "100", 10),
    tcpTimeoutMs: parseInt(process.env.TCP_TIMEOUT_MS ?? "5000", 10),
    httpTimeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS ?? "10000", 10),
    httpMaxRedirects: parseInt(process.env.HTTP_MAX_REDIRECTS ?? "3", 10),
    allowPrivateIps: process.env.ALLOW_PRIVATE_IPS === "true",
  };
}

// Main function
async function main() {
  const config = loadConfig();
  const port = parseInt(process.env.PORT ?? "3012", 10);
  const dbUrl = process.env.DB_URL ?? "file:./data/app.db";

  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Hono Health API - Node.js Runtime                ║
╠════════════════════════════════════════════════════════════╣
║  Mode:              ${config.mode.padEnd(38)}║
║  Port:              ${port.toString().padEnd(38)}║
║  Database:          ${dbUrl.padEnd(38)}║
║  Max Targets:       ${config.maxTargetsPerRequest.toString().padEnd(38)}║
║  Rate Limit:        ${config.rateLimitMaxRequests.toString().padEnd(38)}║
╚════════════════════════════════════════════════════════════╝
  `);

  // Initialize database
  const db = await initDb({ DB_URL: dbUrl });

  // Create Hono app
  const app = createApp({ db, config });

  // Start server
  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`🚀 Server running at http://localhost:${info.port}`);
      console.log(`📊 Health check: http://localhost:${info.port}/v1/ping`);
    }
  );
}

// Run main
main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
