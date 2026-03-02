import { z } from "zod";
import type { CheckTarget } from "../types/index.js";

// Target schema for individual health checks
export const checkTargetSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .transform((h) => h.toLowerCase().trim()),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .default(443),
  protocol: z
    .enum(["http", "https"])
    .optional()
    .default("https"),
  subdomain: z
    .string()
    .max(63)
    .optional()
    .transform((s) => s?.toLowerCase().trim()),
  path: z
    .string()
    .optional()
    .default("/")
    .transform((p) => (p.startsWith("/") ? p : `/${p}`)),
  method: z
    .enum(["GET", "HEAD", "POST", "PUT", "DELETE"])
    .optional()
    .default("HEAD"),
  timeout: z.number().int().min(1000).max(30000).optional().default(10000),
  checkTcp: z.boolean().optional().default(true),
});

// Single target request
export const singleTargetRequestSchema = z.object({
  host: checkTargetSchema.shape.host,
  port: checkTargetSchema.shape.port,
  protocol: checkTargetSchema.shape.protocol,
  subdomain: checkTargetSchema.shape.subdomain,
  path: checkTargetSchema.shape.path,
  method: checkTargetSchema.shape.method,
  timeout: checkTargetSchema.shape.timeout,
  checkTcp: checkTargetSchema.shape.checkTcp,
});

// Multiple targets request
export const multiTargetRequestSchema = z.object({
  targets: z
    .array(checkTargetSchema)
    .min(1)
    .max(50) // Will be further validated against MAX_TARGETS_PER_REQUEST
    .refine(
      (targets) => {
        // Check for duplicate hosts
        const hosts = targets.map((t) => `${t.host}:${t.port}`);
        return new Set(hosts).size === hosts.length;
      },
      {
        message: "Duplicate targets are not allowed",
      }
    ),
});

// Union schema that accepts either single target or targets array
export const checkRequestSchema = z.union([
  singleTargetRequestSchema.transform((data): { targets: CheckTarget[] } => ({
    targets: [
      {
        host: data.host,
        port: data.port ?? 443,
        protocol: data.protocol ?? "https",
        subdomain: data.subdomain,
        path: data.path ?? "/",
        method: data.method ?? "HEAD",
        timeout: data.timeout ?? 10000,
        checkTcp: data.checkTcp ?? true,
      },
    ],
  })),
  multiTargetRequestSchema,
]);

// Validate and normalize targets
export function validateAndNormalizeTargets(
  data: unknown,
  maxTargets: number
): { targets: CheckTarget[] } {
  const parsed = checkRequestSchema.parse(data);

  if (parsed.targets.length > maxTargets) {
    throw new z.ZodError([
      {
        code: "too_big",
        maximum: maxTargets,
        type: "array",
        inclusive: true,
        message: `Maximum ${maxTargets} targets allowed per request`,
        path: ["targets"],
      },
    ]);
  }

  // Normalize each target
  const normalizedTargets = parsed.targets.map((t) => ({
    host: t.host.toLowerCase().trim(),
    port: t.port ?? (t.protocol === "http" ? 80 : 443),
    protocol: t.protocol ?? "https",
    subdomain: t.subdomain?.toLowerCase().trim(),
    path: t.path?.startsWith("/") ? t.path : `/${t.path ?? "/"}`,
    method: t.method ?? "HEAD",
    timeout: t.timeout ?? 10000,
    checkTcp: t.checkTcp ?? true,
  }));

  return { targets: normalizedTargets };
}

// UUID validation
export const uuidSchema = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());

// Error response helper
export function createValidationError(message: string, field?: string) {
  return {
    success: false,
    error: {
      message,
      field,
    },
  };
}
