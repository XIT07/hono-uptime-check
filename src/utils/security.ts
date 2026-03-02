import type { CheckTarget } from "../types/index.js";

// Private IP ranges that should be blocked
const PRIVATE_IP_PATTERNS = [
  // IPv4 private ranges
  /^127\./, // Loopback
  /^10\./, // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
  /^192\.168\./, // Private Class C
  /^169\.254\./, // Link-local
  /^0\./, // Current network
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 private
  /^fe80:/i, // IPv6 link-local
  /^::ffff:127\./, // IPv4-mapped IPv6 loopback
  /^::ffff:10\./, // IPv4-mapped IPv6 private
  /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./, // IPv4-mapped IPv6 private
  /^::ffff:192\.168\./, // IPv4-mapped IPv6 private
];

// Blocked hostnames/patterns
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^localhost\./i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.home$/i,
  /^ip6-localhost$/i,
  /^ip6-loopback$/i,
];

// Check if an IP address is private
export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

// Check if a hostname is blocked
export function isBlockedHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  return BLOCKED_HOSTS.some((pattern) => pattern.test(lowerHostname));
}

// Validate target for SSRF protection
export function validateTargetForSsrf(
  target: CheckTarget,
  allowPrivateIps: boolean = false
): { valid: boolean; reason?: string } {
  if (allowPrivateIps) {
    return { valid: true };
  }

  // Check for blocked hostnames
  if (isBlockedHostname(target.host)) {
    return {
      valid: false,
      reason: `Hostname '${target.host}' is not allowed`,
    };
  }

  // Check if the host looks like an IP address
  const ipv4Pattern =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Pattern = /^(?:[0-9a-fA-F:]{2,})$/;

  if (ipv4Pattern.test(target.host) || ipv6Pattern.test(target.host)) {
    if (isPrivateIp(target.host)) {
      return {
        valid: false,
        reason: `Private IP address '${target.host}' is not allowed`,
      };
    }
  }

  // Additional checks for common SSRF bypasses
  // Block URLs with credentials
  if (target.host.includes("@")) {
    return {
      valid: false,
      reason: "URLs with credentials are not allowed",
    };
  }

  // Block URLs with fragments
  if (target.host.includes("#")) {
    return {
      valid: false,
      reason: "URLs with fragments are not allowed",
    };
  }

  return { valid: true };
}

// Validate all targets
export function validateTargets(
  targets: CheckTarget[],
  allowPrivateIps: boolean = false
): { valid: boolean; invalidTarget?: CheckTarget; reason?: string } {
  for (const target of targets) {
    const result = validateTargetForSsrf(target, allowPrivateIps);
    if (!result.valid) {
      return { valid: false, invalidTarget: target, reason: result.reason };
    }
  }
  return { valid: true };
}

// Generate request ID
export function generateRequestId(): string {
  return crypto.randomUUID();
}

// Hash IP for rate limiting (privacy preserving)
export function hashIp(ip: string): string {
  // Simple hash for demonstration - in production use a proper hash
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `ip_${Math.abs(hash).toString(16)}`;
}
