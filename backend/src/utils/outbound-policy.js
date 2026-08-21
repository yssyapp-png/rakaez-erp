const HTTPS_PROTOCOL = "https:";
const DEFAULT_TIMEOUT_MS = 15000;

function boundedTimeout(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) ? Math.min(30000, Math.max(3000, parsed)) : DEFAULT_TIMEOUT_MS;
}
/**
 * Validates every server-side outbound destination against a small, explicit
 * allowlist. Callers cannot override the hostname with request data or an
 * environment variable, which prevents SSRF and accidental data exfiltration.
 */
export function validateOutboundUrl(rawUrl, allowedOrigins) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid_outbound_url");
  }
  const allowlist = new Set((allowedOrigins || []).map((origin) => new URL(origin).origin));
  if (
    url.protocol !== HTTPS_PROTOCOL ||
    url.username ||
    url.password ||
    !allowlist.has(url.origin)
  ) {
    throw new Error("outbound_target_not_allowed");
  }
  return url;
}

export async function secureOutboundFetch(rawUrl, {
  allowedOrigins,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ...options
} = {}) {
  const url = validateOutboundUrl(rawUrl, allowedOrigins);
  return globalThis.fetch(url, {
    ...options,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(boundedTimeout(timeoutMs)),
  });
}
