import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

// Error handler middleware
export async function errorHandler(err: Error, c: Context) {
  console.error("Error:", err);

  // Handle Hono HTTP exceptions (from bearer auth, etc.)
  if (err instanceof HTTPException) {
    const status = err.status;

    // Try to get the response body if it exists
    const res = err.getResponse();
    if (res) {
      // Clone and try to read body
      try {
        const body = await res.clone().json();
        if (body) {
          return c.json(body, status);
        }
      } catch {
        // No JSON body, continue to default handling
      }
    }

    // Default HTTPException response
    return c.json(
      {
        success: false,
        error: {
          message: err.message || getDefaultMessage(status),
          code: getCodeFromStatus(status),
        },
      },
      status
    );
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));

    return c.json(
      {
        success: false,
        error: {
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          details: formattedErrors,
        },
      },
      400
    );
  }

  // Handle other errors
  const isDevelopment = typeof process !== "undefined" && process.env?.NODE_ENV === "development";

  return c.json(
    {
      success: false,
      error: {
        message: isDevelopment ? err.message : "Internal server error",
        code: "INTERNAL_ERROR",
        ...(isDevelopment && { stack: err.stack }),
      },
    },
    500
  );
}

// Helper to get error code from HTTP status
function getCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RATE_LIMIT_EXCEEDED";
    default:
      return "INTERNAL_ERROR";
  }
}

// Helper to get default message from HTTP status
function getDefaultMessage(status: number): string {
  switch (status) {
    case 400:
      return "Bad request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not found";
    case 429:
      return "Too many requests";
    default:
      return "Internal server error";
  }
}

// Request timing middleware
export async function timingMiddleware(c: Context, next: Next) {
  const start = Date.now();
  c.set("requestStartTime", start);

  await next();

  const duration = Date.now() - start;
  c.header("X-Response-Time", `${duration}ms`);
}
