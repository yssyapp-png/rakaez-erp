const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function authCookieName(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production" ? "__Host-rakaez_session" : "rakaez_session";
}

export function deviceCookieName(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production" ? "__Host-rakaez_device" : "rakaez_device";
}

export function parseCookies(header) {
  const cookies = {};
  for (const pair of String(header || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key || Object.hasOwn(cookies, key)) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Malformed cookies are ignored instead of reaching authentication.
    }
  }
  return cookies;
}

export function readAuthCookie(req) {
  return parseCookies(req?.headers?.cookie)[authCookieName()] || null;
}

export function readDeviceCookie(req) {
  return parseCookies(req?.headers?.cookie)[deviceCookieName()] || null;
}

function cookieOptions(ttlHours) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ttlHours * 60 * 60 * 1000,
    priority: "high",
  };
}

export function setAuthCookie(res, token, ttlHours) {
  res.cookie(authCookieName(), token, cookieOptions(ttlHours));
}

export function clearAuthCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions(1);
  res.clearCookie(authCookieName(), options);
}

export function setDeviceCookie(res, token, ttlDays) {
  res.cookie(deviceCookieName(), token, {
    ...cookieOptions(ttlDays * 24),
    maxAge: ttlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearDeviceCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions(1);
  res.clearCookie(deviceCookieName(), options);
}

export function parseAllowedOrigins(raw, nodeEnv = process.env.NODE_ENV) {
  const origins = String(raw || (nodeEnv === "production" ? "" : "http://localhost:5173"))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (nodeEnv === "production" && origins.length === 0) {
    throw new Error("Production CORS_ALLOWED_ORIGINS must contain at least one HTTPS web origin");
  }

  const normalized = origins.map((origin) => {
    if (origin.includes("*")) throw new Error("CORS_ALLOWED_ORIGINS must not contain wildcards");
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`CORS origin must contain only scheme, host, and optional port: ${origin}`);
    }
    if (nodeEnv === "production" && url.protocol !== "https:") {
      throw new Error(`Production CORS origin must use HTTPS: ${origin}`);
    }
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw new Error(`Unsupported CORS origin protocol: ${origin}`);
    }
    return url.origin;
  });

  return [...new Set(normalized)];
}

/**
 * Blocks cross-site state-changing browser requests before they reach auth.
 * SameSite=Strict remains the primary cookie control; Fetch Metadata and
 * Origin validation provide defense in depth and cover login CSRF.
 */
export function crossSiteRequestGuard(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(String(req.method || "").toUpperCase())) return next();

    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite === "cross-site") return res.status(403).json({ error: "cross_site_request_blocked" });

    const origin = String(req.headers.origin || "");
    if (origin && !allowed.has(origin)) return res.status(403).json({ error: "origin_not_allowed" });

    // Cookie-authenticated browser mutations must carry either a validated
    // Origin or trustworthy same-site Fetch Metadata. Bearer/mobile clients
    // without cookies remain supported.
    const hasSessionCookie = Boolean(parseCookies(req.headers.cookie)[authCookieName()]);
    if (hasSessionCookie && !origin && !new Set(["same-origin", "same-site"]).has(fetchSite)) {
      return res.status(403).json({ error: "request_origin_required" });
    }
    next();
  };
}
