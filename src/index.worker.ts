/**
 * Cloudflare Worker Entry Point
 *
 * This file is the entry point for running the Hono Health API on Cloudflare Workers.
 * It uses D1 for the database.
 */

import { createApp } from "./app.js";
import { initDb } from "./db/index.js";
import type { Config } from "./types/index.js";

// Cloudflare Worker environment interface
export interface Env {
  DB: D1Database;
  API_TOKEN?: string;
  MAX_TARGETS_PER_REQUEST?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  TCP_TIMEOUT_MS?: string;
  HTTP_TIMEOUT_MS?: string;
  HTTP_MAX_REDIRECTS?: string;
  ALLOW_PRIVATE_IPS?: string;
}

// Load configuration from environment
function loadConfig(env: Env): Config {
  if (!env.API_TOKEN) {
    throw new Error("API_TOKEN is required. Set it in wrangler.toml [vars] or using wrangler secret put API_TOKEN");
  }

  return {
    mode: "worker",
    apiToken: env.API_TOKEN,
    maxTargetsPerRequest: parseInt(env.MAX_TARGETS_PER_REQUEST ?? "10", 10),
    rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
    rateLimitMaxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS ?? "100", 10),
    tcpTimeoutMs: parseInt(env.TCP_TIMEOUT_MS ?? "5000", 10),
    httpTimeoutMs: parseInt(env.HTTP_TIMEOUT_MS ?? "10000", 10),
    httpMaxRedirects: parseInt(env.HTTP_MAX_REDIRECTS ?? "3", 10),
    allowPrivateIps: env.ALLOW_PRIVATE_IPS === "true",
  };
}

// Default export for Cloudflare Workers
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize configuration
    const config = loadConfig(env);

    // Initialize database with D1 binding
    const db = await initDb({ DB: env.DB });

    // Create Hono app
    const app = createApp({ db, config });

    // Handle request
    return app.fetch(request, env, ctx);
  },
};

// Also export for ES modules compatibility
export { createApp, initDb, loadConfig };
