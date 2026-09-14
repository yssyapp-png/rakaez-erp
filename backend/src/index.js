import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import partsRouter from "./routes/parts.js";
import salesRouter from "./routes/sales.js";
import adminRouter from "./routes/admin.js";
import billingRouter from "./routes/billing.js";
import devicesRouter from "./routes/devices.js";
import catalogRouter from "./routes/catalog.js";
import vehiclesRouter from "./routes/vehicles.js";
import procurementRouter from "./routes/procurement.js";
import transfersRouter from "./routes/transfers.js";
import complianceRouter from "./routes/compliance.js";
import { pool } from "./db/pool.js";
import authRouter, { authRequired, requireActiveSubscription, requireRole } from "./routes/auth.js";
import { securityHash } from "./utils/security.js";
import { crossSiteRequestGuard, parseAllowedOrigins } from "./utils/http-security.js";
import { validateZatcaRuntimeConfiguration } from "./utils/zatca-integration.js";
import { validateCatalogProviderConfiguration } from "./utils/catalog-providers.js";

dotenv.config();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
validateZatcaRuntimeConfiguration();
validateCatalogProviderConfiguration();
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
if (process.env.NODE_ENV === "production") {
  if (process.env.DB_SSL !== "true") throw new Error("Production DB_SSL must be true");
  if (process.env.ENFORCE_HTTPS !== "true") throw new Error("Production ENFORCE_HTTPS must be true");
  if (process.env.PAYMENTS_ENABLED === "true" && !process.env.MOYASAR_SECRET_KEY) {
    throw new Error("MOYASAR_SECRET_KEY is required when payments are enabled");
  }
  if (process.env.PAYMENTS_ENABLED === "true") {
    let callback;
    try {
      callback = new URL(process.env.MOYASAR_CALLBACK_URL);
    } catch {
      throw new Error("Production MOYASAR_CALLBACK_URL must be a valid URL");
    }
    if (callback.protocol !== "https:") throw new Error("Production MOYASAR_CALLBACK_URL must use HTTPS");
  }
}
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.use((req, res, next) => {
  const supplied = String(req.headers["x-request-id"] || "");
  req.requestId = /^[A-Za-z0-9_-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: "deny",
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.2.10/dist/"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.2.10/dist/"],
      connectSrc: ["'self'", "https://api.moyasar.com"],
      frameSrc: ["'self'", "https://moyasar.com", "https://*.moyasar.com"],
      formAction: ["'self'", "https://moyasar.com", "https://*.moyasar.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.2.10/dist/"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
    },
  },
}));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  exposedHeaders: ["X-Request-ID", "Retry-After"],
}));
app.use(crossSiteRequestGuard(allowedOrigins));
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENFORCE_HTTPS === "true" &&
    req.protocol !== "https"
  ) {
    return res.status(400).json({ error: "https_required" });
  }
  next();
});
app.use(express.json({ limit: "2mb" }));

// Request logging — helps diagnose issues once this is deployed and we
// can't just watch the terminal live.
morgan.token("request-id", (req) => req.requestId);
morgan.token("safe-path", (req) => req.path);
morgan.token("client-fingerprint", (req) => securityHash(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 16));
app.use(morgan(process.env.NODE_ENV === "production" ? ':client-fingerprint - :request-id ":method :safe-path HTTP/:http-version" :status :res[content-length] - :response-time ms' : "dev"));

// Rate limiting on /api — a shared limit is fine at this stage; per-tenant
// limits are a future refinement once real traffic patterns are known.
// Login/register get a tighter limit since they're the most abuse-prone.
app.use(
  "/api/",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
);
app.use(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "auth_rate_limited" },
  })
);
app.use(
  "/api/auth/register",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "registration_rate_limited" },
  })
);
app.use(
  "/api/auth/accept-invitation",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "invitation_rate_limited" },
  })
);
app.use(
  "/api/auth/password",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "password_change_rate_limited" },
  })
);
app.use(
  "/api/devices/pair",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "device_pairing_rate_limited" },
  })
);
app.use(
  "/api/parts/branch-availability",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "branch_inventory_rate_limited" },
  })
);
app.use(
  "/api/compliance/zatca",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "zatca_rate_limited" },
  })
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "rakaez-api" }));
app.get("/api/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "ready" });
  } catch (error) {
    console.error("Readiness check failed:", error.message);
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});
app.use("/api/auth", authRouter);
app.use("/api/parts", authRequired, requireActiveSubscription, partsRouter);
app.use("/api/sales", authRequired, requireActiveSubscription, salesRouter);
app.use("/api/admin", authRequired, requireRole("admin"), adminRouter);
app.use("/api/billing", authRequired, billingRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/catalog", authRequired, requireRole("admin"), catalogRouter);
app.use(
  "/api/vehicles",
  authRequired,
  requireActiveSubscription,
  requireRole("customer", "seller", "admin"),
  vehiclesRouter
);
app.use("/api/procurement", authRequired, requireActiveSubscription, procurementRouter);
app.use("/api/transfers", authRequired, requireActiveSubscription, transfersRouter);
app.use("/api/compliance", authRequired, requireRole("admin"), complianceRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "api_route_not_found" }));

const publicDirectory = path.join(__dirname, "../public");
app.use(express.static(publicDirectory, {
  dotfiles: "deny",
  index: false,
  redirect: false,
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(path.join(publicDirectory, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled request error:", { requestId: req.requestId, message: err?.message });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "internal_server_error", requestId: req.requestId });
});

const port = process.env.PORT || 4000;
const server = app.listen(port, () => console.log(`Auto-Parts API listening on port ${port}`));

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
