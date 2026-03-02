import type {
  CheckTarget,
  HttpCheckResult,
  TcpCheckResult,
  TargetCheckResult,
  RuntimeMode,
} from "../types/index.js";

// Configuration for health checks
export interface HealthCheckConfig {
  mode: RuntimeMode;
  tcpTimeoutMs: number;
  httpTimeoutMs: number;
  httpMaxRedirects: number;
}

// Perform TCP check (Node.js only)
async function performTcpCheckNode(
  target: CheckTarget,
  config: HealthCheckConfig
): Promise<TcpCheckResult> {
  // Dynamic import to avoid bundling in workers
  const { Socket } = await import("node:net");

  return new Promise((resolve) => {
    const socket = new Socket();
    const startTime = Date.now();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({
          connected: false,
          error: "TCP connection timeout",
        });
      }
    }, config.tcpTimeoutMs);

    socket.on("connect", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        socket.end();
        resolve({
          connected: true,
          responseTimeMs: Date.now() - startTime,
        });
      }
    });

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          connected: false,
          error: err.message,
        });
      }
    });

    // Build hostname with optional subdomain
    const hostname = target.subdomain
      ? `${target.subdomain}.${target.host}`
      : target.host;
    socket.connect(target.port ?? 443, hostname);
  });
}

// Perform TCP check for Workers using cloudflare:sockets API
async function performTcpCheckWorker(
  target: CheckTarget,
  config: HealthCheckConfig
): Promise<TcpCheckResult> {
  const startTime = Date.now();

  // Build hostname with optional subdomain
  const hostname = target.subdomain
    ? `${target.subdomain}.${target.host}`
    : target.host;
  const port = target.port ?? 443;
  const timeoutMs = target.timeout ?? config.tcpTimeoutMs;

  try {
    // Dynamic import to avoid bundling issues in Node.js
    const { connect } = await import("cloudflare:sockets");

    const socket = connect({ hostname, port });

    // Race between connection established and timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TCP connection timeout")), timeoutMs)
    );

    // Wait for socket to open (connection established)
    await Promise.race([socket.opened, timeoutPromise]);

    // Connected successfully - close immediately (we just want to verify port is open)
    await socket.close();

    return {
      connected: true,
      responseTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      connected: false,
      responseTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Perform TCP check based on runtime
async function performTcpCheck(
  target: CheckTarget,
  config: HealthCheckConfig
): Promise<TcpCheckResult> {
  if (config.mode === "worker") {
    return performTcpCheckWorker(target, config);
  }
  return performTcpCheckNode(target, config);
}

// Perform HTTP check
async function performHttpCheck(
  target: CheckTarget,
  config: HealthCheckConfig
): Promise<HttpCheckResult> {
  const startTime = Date.now();

  // Build hostname with optional subdomain
  const hostname = target.subdomain
    ? `${target.subdomain}.${target.host}`
    : target.host;
  const url = `${target.protocol}://${hostname}:${target.port}${target.path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), target.timeout ?? config.httpTimeoutMs);

  try {
    let currentUrl = url;
    let redirectCount = 0;
    let lastResponse: Response | null = null;

    while (redirectCount <= config.httpMaxRedirects) {
      const response = await fetch(currentUrl, {
        method: target.method,
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "uptime-monitor/1.0",
          Accept: "*/*",
          Connection: "close",
        },
      });

      lastResponse = response;

      // Handle redirects
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        if (redirectCount >= config.httpMaxRedirects) {
          clearTimeout(timeout);
          return {
            statusCode: response.status,
            statusText: response.statusText,
            responseTimeMs: Date.now() - startTime,
            headers: Object.fromEntries(response.headers.entries()),
            error: "Maximum redirects exceeded",
            redirectCount,
          };
        }

        const location = response.headers.get("location")!;
        currentUrl = new URL(location, currentUrl).toString();
        redirectCount++;
        continue;
      }

      // Handle 405 Method Not Allowed - retry with GET
      if (response.status === 405 && target.method === "HEAD") {
        const getResponse = await fetch(currentUrl, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "User-Agent": "uptime-monitor/1.0",
            Accept: "*/*",
            Connection: "close",
          },
        });

        clearTimeout(timeout);
        const bodyPreview = await getResponse
          .text()
          .then((t) => t.slice(0, 500))
          .catch(() => undefined);

        return {
          statusCode: getResponse.status,
          statusText: getResponse.statusText,
          responseTimeMs: Date.now() - startTime,
          headers: Object.fromEntries(getResponse.headers.entries()),
          bodyPreview,
          redirectCount,
          finalUrl: currentUrl,
        };
      }

      clearTimeout(timeout);

      // Get body preview for non-HEAD requests
      let bodyPreview: string | undefined;
      if (target.method !== "HEAD") {
        bodyPreview = await response
          .clone()
          .text()
          .then((t) => t.slice(0, 500))
          .catch(() => undefined);
      }

      return {
        statusCode: response.status,
        statusText: response.statusText,
        responseTimeMs: Date.now() - startTime,
        headers: Object.fromEntries(response.headers.entries()),
        bodyPreview,
        redirectCount,
        finalUrl: currentUrl,
      };
    }

    clearTimeout(timeout);
    return {
      responseTimeMs: Date.now() - startTime,
      error: "Maximum redirects exceeded",
      redirectCount,
    };
  } catch (err) {
    clearTimeout(timeout);
    const error = err instanceof Error ? err.message : "Unknown error";

    if (error.includes("abort") || error.includes("AbortError")) {
      return {
        responseTimeMs: Date.now() - startTime,
        error: "HTTP request timeout",
      };
    }

    return {
      responseTimeMs: Date.now() - startTime,
      error,
    };
  }
}

// Perform health check for a single target
export async function performHealthCheck(
  target: CheckTarget,
  config: HealthCheckConfig
): Promise<TargetCheckResult> {
  const checkStartTime = Date.now();
  const checkedAt = new Date().toISOString();

  // Perform TCP check if requested
  let tcpResult: TcpCheckResult | undefined;
  if (target.checkTcp) {
    tcpResult = await performTcpCheck(target, config);
  }

  // Perform HTTP check
  const httpResult = await performHttpCheck(target, config);

  const totalMs = Date.now() - checkStartTime;

  // Determine if target is alive
  // HTTP 2xx/3xx = alive, TCP connected = alive (if HTTP fails)
  const httpAlive =
    httpResult.statusCode !== undefined &&
    httpResult.statusCode >= 200 &&
    httpResult.statusCode < 400;

  const tcpAlive = tcpResult?.connected ?? false;

  const isAlive = httpAlive || tcpAlive;

  return {
    target,
    isAlive,
    portAlive: tcpResult?.connected,
    http: httpResult,
    tcp: tcpResult,
    totalMs,
    checkedAt,
    error: httpResult.error,
  };
}

// Perform health checks for multiple targets
export async function performHealthChecks(
  targets: CheckTarget[],
  config: HealthCheckConfig
): Promise<TargetCheckResult[]> {
  // Run checks in parallel with concurrency limit
  const concurrencyLimit = 5;
  const results: TargetCheckResult[] = [];

  for (let i = 0; i < targets.length; i += concurrencyLimit) {
    const batch = targets.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map((target) => performHealthCheck(target, config))
    );
    results.push(...batchResults);
  }

  return results;
}
