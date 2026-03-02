import { Hono } from "hono";
import { logger } from "hono/logger";
import { poweredBy } from "hono/powered-by";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { rateLimiter } from "hono-rate-limiter";
import type { DatabaseAdapter } from "./db/index.js";
import { checks, checkResults } from "./db/schema.js";
import { eq } from "drizzle-orm";
import type {
  Config,
  CheckTarget,
  TargetCheckResult,
  SyncCheckResponse,
  StoredCheckResponse,
  FullCheckResponse,
} from "./types/index.js";
import { validateAndNormalizeTargets, uuidSchema } from "./utils/validation.js";
import { validateTargets, generateRequestId } from "./utils/security.js";
import {
  performHealthChecks,
  type HealthCheckConfig,
} from "./utils/healthCheck.js";
import { errorHandler, timingMiddleware } from "./middleware/errorHandler.js";

// App context with database
export interface AppContext {
  db: DatabaseAdapter;
  config: Config;
}

// Create the Hono app with context
export function createApp(context: AppContext): Hono {
  const app = new Hono();
  const { db, config } = context;

  // Health check configuration
  const healthCheckConfig: HealthCheckConfig = {
    mode: config.mode,
    tcpTimeoutMs: config.tcpTimeoutMs,
    httpTimeoutMs: config.httpTimeoutMs,
    httpMaxRedirects: config.httpMaxRedirects,
  };

  // Middleware
  app.use(logger());
  app.use(poweredBy());
  app.use(timingMiddleware);

  // CORS - allow all origins (configure as needed)
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ],
    })
  );

  // Bearer Auth - skip for root, ping, and favicon
  app.use(
    "*",
    except(
      ["/", "/v1/ping", "/favicon.ico"],
      bearerAuth({
        token: config.apiToken,
        noAuthenticationHeader: {
          message: {
            success: false,
            error: {
              message: "Missing Authorization header",
              code: "UNAUTHORIZED",
            },
          },
        },
        invalidAuthenticationHeader: {
          message: {
            success: false,
            error: {
              message: "Invalid Authorization format. Use: Bearer <token>",
              code: "UNAUTHORIZED",
            },
          },
        },
        invalidToken: {
          message: {
            success: false,
            error: {
              message: "Invalid API token",
              code: "UNAUTHORIZED",
            },
          },
        },
      })
    )
  );

  // Rate limiting
  app.use(
    rateLimiter({
      windowMs: config.rateLimitWindowMs,
      limit: config.rateLimitMaxRequests,
      standardHeaders: "draft-6",
      keyGenerator: (c) =>
        c.req.header("cf-connecting-ip") ||
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        c.req.header("x-real-ip") ||
        "unknown",
    })
  );

  // Error handling
  app.onError(errorHandler);

  // GET / - API info
  app.get("/", (c) => {
    return c.json({
      success: true,
      data: {
        name: "Hono Uptime Check API",
        version: "1.0.0",
        mode: config.mode,
        endpoints: {
          ping: "GET /v1/ping",
          check: "POST /v1/check",
          checks: "POST /v1/checks",
          getCheck: "GET /v1/checks/:id",
          deleteCheck: "DELETE /v1/checks/:id",
        },
        docs: "https://github.com/XIT07/hono‑uptime‑check",
      },
    });
  });

  // GET /v1/ping - Health check endpoint
  app.get("/v1/ping", (c) => {
    return c.json({
      success: true,
      data: {
        message: "pong",
        timestamp: new Date().toISOString(),
        yourIp: c.req.header("cf-connecting-ip") ||
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
          c.req.header("x-real-ip") ||
          "unknown",
      },
    });
  });

  // POST /v1/check - Synchronous check (no DB storage)
  app.post("/v1/check", async (c) => {
    const body = await c.req.json();

    // Validate and normalize targets
    const { targets } = validateAndNormalizeTargets(
      body,
      config.maxTargetsPerRequest
    );

    // SSRF validation
    const ssrfResult = validateTargets(targets, config.allowPrivateIps);
    if (!ssrfResult.valid) {
      return c.json(
        {
          success: false,
          error: {
            message: ssrfResult.reason,
            code: "SSRF_VIOLATION",
          },
        },
        400
      );
    }

    // Perform health checks
    const results = await performHealthChecks(targets, healthCheckConfig);

    const response: SyncCheckResponse = { results };

    return c.json({
      success: true,
      data: response,
    });
  });

  // POST /v1/checks - Check and store results
  app.post("/v1/checks", async (c) => {
    const body = await c.req.json();

    // Validate and normalize targets
    const { targets } = validateAndNormalizeTargets(
      body,
      config.maxTargetsPerRequest
    );

    // SSRF validation
    const ssrfResult = validateTargets(targets, config.allowPrivateIps);
    if (!ssrfResult.valid) {
      return c.json(
        {
          success: false,
          error: {
            message: ssrfResult.reason,
            code: "SSRF_VIOLATION",
          },
        },
        400
      );
    }

    // Perform health checks
    const results = await performHealthChecks(targets, healthCheckConfig);

    // Determine overall status
    const aliveCount = results.filter((r) => r.isAlive).length;
    let status: "completed" | "partial" | "failed";
    if (aliveCount === results.length) {
      status = "completed";
    } else if (aliveCount > 0) {
      status = "partial";
    } else {
      status = "failed";
    }

    // Get request metadata
    const requestId = generateRequestId();
    const createdAt = new Date();
    const requesterIp =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";
    const userAgent = c.req.header("user-agent");

    // Store in database
    if (config.mode === "node") {
      // Node.js with better-sqlite3
      const nodeDb = db.db as import("drizzle-orm/better-sqlite3").BetterSQLite3Database<
        typeof import("./db/schema.js")
      >;

      nodeDb.insert(checks).values({
        id: requestId,
        createdAt,
        status,
        requesterIp,
        userAgent,
        targetsCount: targets.length,
      }).run();

      // Insert results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        nodeDb.insert(checkResults).values({
          id: generateRequestId(),
          checkId: requestId,
          idx: i,
          inputJson: JSON.stringify(result.target),
          isAlive: result.isAlive,
          portAlive: result.portAlive ?? null,
          httpJson: result.http ? JSON.stringify(result.http) : null,
          tcpJson: result.tcp ? JSON.stringify(result.tcp) : null,
          totalMs: result.totalMs,
          checkedAt: new Date(result.checkedAt),
          error: result.error ?? null,
        }).run();
      }
    } else {
      // Worker with D1
      const workerDb = db.db as import("drizzle-orm/d1").DrizzleD1Database<
        typeof import("./db/schema.js")
      >;

      await workerDb.insert(checks).values({
        id: requestId,
        createdAt,
        status,
        requesterIp,
        userAgent,
        targetsCount: targets.length,
      });

      // Insert results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        await workerDb.insert(checkResults).values({
          id: generateRequestId(),
          checkId: requestId,
          idx: i,
          inputJson: JSON.stringify(result.target),
          isAlive: result.isAlive,
          portAlive: result.portAlive ?? null,
          httpJson: result.http ? JSON.stringify(result.http) : null,
          tcpJson: result.tcp ? JSON.stringify(result.tcp) : null,
          totalMs: result.totalMs,
          checkedAt: new Date(result.checkedAt),
          error: result.error ?? null,
        });
      }
    }

    const response: StoredCheckResponse = {
      id: requestId,
      status,
      targetsCount: targets.length,
      createdAt: createdAt.toISOString(),
    };

    return c.json(
      {
        success: true,
        data: response,
      },
      201
    );
  });

  // GET /v1/checks/:id - Get stored check results
  app.get("/v1/checks/:id", async (c) => {
    const idParam = c.req.param("id");

    // Validate UUID
    const parseResult = uuidSchema.safeParse(idParam);
    if (!parseResult.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Invalid check ID format",
            code: "INVALID_ID",
          },
        },
        400
      );
    }

    const checkId = parseResult.data;

    // Fetch check and results
    let checkRow: typeof checks.$inferSelect | undefined;
    let resultRows: (typeof checkResults.$inferSelect)[] = [];

    if (config.mode === "node") {
      const nodeDb = db.db as import("drizzle-orm/better-sqlite3").BetterSQLite3Database<
        typeof import("./db/schema.js")
      >;

      checkRow = nodeDb
        .select()
        .from(checks)
        .where(eq(checks.id, checkId))
        .get();

      if (checkRow) {
        resultRows = nodeDb
          .select()
          .from(checkResults)
          .where(eq(checkResults.checkId, checkId))
          .orderBy(checkResults.idx)
          .all();
      }
    } else {
      const workerDb = db.db as import("drizzle-orm/d1").DrizzleD1Database<
        typeof import("./db/schema.js")
      >;

      const checkRows = await workerDb
        .select()
        .from(checks)
        .where(eq(checks.id, checkId))
        .limit(1);
      checkRow = checkRows[0];

      if (checkRow) {
        resultRows = await workerDb
          .select()
          .from(checkResults)
          .where(eq(checkResults.checkId, checkId))
          .orderBy(checkResults.idx);
      }
    }

    if (!checkRow) {
      return c.json(
        {
          success: false,
          error: {
            message: "Check not found",
            code: "NOT_FOUND",
          },
        },
        404
      );
    }

    // Parse results
    const parsedResults: TargetCheckResult[] = resultRows.map((row) => ({
      target: JSON.parse(row.inputJson),
      isAlive: row.isAlive,
      portAlive: row.portAlive ?? undefined,
      http: row.httpJson ? JSON.parse(row.httpJson) : undefined,
      tcp: row.tcpJson ? JSON.parse(row.tcpJson) : undefined,
      totalMs: row.totalMs,
      checkedAt: new Date(row.checkedAt).toISOString(),
      error: row.error ?? undefined,
    }));

    const response: FullCheckResponse = {
      id: checkRow.id,
      status: checkRow.status as "completed" | "partial" | "failed",
      targetsCount: checkRow.targetsCount,
      createdAt: new Date(checkRow.createdAt).toISOString(),
      results: parsedResults,
    };

    return c.json({
      success: true,
      data: response,
    });
  });

  // DELETE /v1/checks/:id - Delete stored check results
  app.delete("/v1/checks/:id", async (c) => {
    const idParam = c.req.param("id");

    // Validate UUID
    const parseResult = uuidSchema.safeParse(idParam);
    if (!parseResult.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Invalid check ID format",
            code: "INVALID_ID",
          },
        },
        400
      );
    }

    const checkId = parseResult.data;

    // Delete check and results
    let deleted = false;

    if (config.mode === "node") {
      const nodeDb = db.db as import("drizzle-orm/better-sqlite3").BetterSQLite3Database<
        typeof import("./db/schema.js")
      >;

      // Check if exists
      const checkRow = nodeDb
        .select()
        .from(checks)
        .where(eq(checks.id, checkId))
        .get();

      if (checkRow) {
        // Delete results first (foreign key constraint)
        nodeDb.delete(checkResults).where(eq(checkResults.checkId, checkId)).run();
        // Delete check
        nodeDb.delete(checks).where(eq(checks.id, checkId)).run();
        deleted = true;
      }
    } else {
      const workerDb = db.db as import("drizzle-orm/d1").DrizzleD1Database<
        typeof import("./db/schema.js")
      >;

      // Check if exists
      const checkRows = await workerDb
        .select()
        .from(checks)
        .where(eq(checks.id, checkId))
        .limit(1);

      if (checkRows.length > 0) {
        // Delete results first (foreign key constraint)
        await workerDb.delete(checkResults).where(eq(checkResults.checkId, checkId));
        // Delete check
        await workerDb.delete(checks).where(eq(checks.id, checkId));
        deleted = true;
      }
    }

    if (!deleted) {
      return c.json(
        {
          success: false,
          error: {
            message: "Check not found",
            code: "NOT_FOUND",
          },
        },
        404
      );
    }

    return c.json({
      success: true,
      data: {
        message: "Check deleted successfully",
        id: checkId,
      },
    });
  });

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        success: false,
        error: {
          message: "Endpoint not found",
          code: "NOT_FOUND",
        },
      },
      404
    );
  });

  return app;
}

export default createApp;
