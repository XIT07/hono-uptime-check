// Target definition for health checks
export interface CheckTarget {
  host: string;
  port?: number;
  protocol?: "http" | "https";
  subdomain?: string;
  path?: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
  timeout?: number;
  checkTcp?: boolean;
}

// HTTP check result
export interface HttpCheckResult {
  statusCode?: number;
  statusText?: string;
  responseTimeMs: number;
  headers?: Record<string, string>;
  bodyPreview?: string;
  error?: string;
  redirectCount?: number;
  finalUrl?: string;
}

// TCP check result
export interface TcpCheckResult {
  connected: boolean;
  responseTimeMs?: number;
  error?: string;
  reason?: string; // For workers: "tcp_not_supported_in_workers"
}

// Combined check result for a single target
export interface TargetCheckResult {
  target: CheckTarget;
  isAlive: boolean;
  portAlive?: boolean;
  http?: HttpCheckResult;
  tcp?: TcpCheckResult;
  totalMs: number;
  checkedAt: string;
  error?: string;
}

// API Response for synchronous check
export interface SyncCheckResponse {
  results: TargetCheckResult[];
}

// API Response for stored check
export interface StoredCheckResponse {
  id: string;
  status: "completed" | "partial" | "failed";
  targetsCount: number;
  createdAt: string;
}

// Full check with results (for GET /v1/checks/:id)
export interface FullCheckResponse extends StoredCheckResponse {
  results: TargetCheckResult[];
}

// Runtime mode
export type RuntimeMode = "node" | "worker";

// Environment configuration
export interface Config {
  mode: RuntimeMode;
  apiToken: string;
  maxTargetsPerRequest: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  tcpTimeoutMs: number;
  httpTimeoutMs: number;
  httpMaxRedirects: number;
  allowPrivateIps: boolean;
}
