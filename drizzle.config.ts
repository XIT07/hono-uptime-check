import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  driver: "better-sqlite",
  dbCredentials: {
    url: process.env.DB_URL || "file:./data/app.db",
  },
  verbose: true,
  strict: true,
} satisfies Config;
