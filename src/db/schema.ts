import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// Main checks table - stores the check request metadata
export const checks = sqliteTable("checks", {
  id: text("id").primaryKey(), // UUID
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull(), // "completed", "partial", "failed"
  requesterIp: text("requester_ip").notNull(),
  userAgent: text("user_agent"),
  targetsCount: integer("targets_count").notNull(),
});

// Individual check results for each target
export const checkResults = sqliteTable("check_results", {
  id: text("id").primaryKey(), // UUID
  checkId: text("check_id")
    .notNull()
    .references(() => checks.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(), // Order index in the request
  inputJson: text("input_json").notNull(), // Serialized target input
  isAlive: integer("is_alive", { mode: "boolean" }).notNull(),
  portAlive: integer("port_alive", { mode: "boolean" }),
  httpJson: text("http_json"), // Serialized HTTP check result
  tcpJson: text("tcp_json"), // Serialized TCP check result
  totalMs: integer("total_ms").notNull(),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
  error: text("error"),
});

// Relations
export const checksRelations = relations(checks, ({ many }) => ({
  results: many(checkResults),
}));

export const checkResultsRelations = relations(checkResults, ({ one }) => ({
  check: one(checks, {
    fields: [checkResults.checkId],
    references: [checks.id],
  }),
}));

// Types for TypeScript
export type Check = typeof checks.$inferSelect;
export type NewCheck = typeof checks.$inferInsert;

export type CheckResult = typeof checkResults.$inferSelect;
export type NewCheckResult = typeof checkResults.$inferInsert;
