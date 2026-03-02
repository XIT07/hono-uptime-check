#!/usr/bin/env node
/**
 * Database Migration Script for Node.js
 *
 * Run this script to create/update the database schema.
 * Usage: npm run db:migrate:node
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

const dbUrl = process.env.DB_URL || "file:./data/app.db";

// Ensure data directory exists
const dbPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
const dir = dirname(dbPath);
try {
  mkdirSync(dir, { recursive: true });
} catch {
  // Directory might already exist
}

console.log(`Connecting to database: ${dbUrl}`);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

// Create tables
console.log("Running migrations...");

// Checks table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS checks (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    requester_ip TEXT NOT NULL,
    user_agent TEXT,
    targets_count INTEGER NOT NULL
  );
`);

// Check results table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS check_results (
    id TEXT PRIMARY KEY,
    check_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    input_json TEXT NOT NULL,
    is_alive INTEGER NOT NULL,
    port_alive INTEGER,
    http_json TEXT,
    tcp_json TEXT,
    total_ms INTEGER NOT NULL,
    checked_at INTEGER NOT NULL,
    error TEXT,
    FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
  );
`);

// Create index on check_id for faster lookups
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_check_results_check_id ON check_results(check_id);
`);

// Create index on created_at for sorting
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_checks_created_at ON checks(created_at);
`);

console.log("✅ Migrations completed successfully!");

sqlite.close();
