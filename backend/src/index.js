import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
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
import { pool } from "./db/pool.js";
import authRouter, { authRequired, requireActiveSubscription, requireRole } from "./routes/auth.js";

dotenv.config();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production") {
  if (!process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS.includes("localhost")) {
    throw new Error("Production CORS_ALLOWED_ORIGINS must contain the deployed web origin");
  }
  if (process.env.PAYMENTS_ENABLED === "true" && (!process.env.MOYASAR_SECRET_KEY || !process.env.MOYASAR_PUBLISHABLE_KEY)) {
    throw new Error("Moyasar keys are required when payments are enabled");
  }
}
const app = express();
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

// Security headers — cheap to add, no downside, worth having before this
// goes anywhere near the public internet.
app.use(helmet());
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: false }));
app.use(express.json());

// Request logging — helps diagnose issues once this is deployed and we
// can't just watch the terminal live.
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Rate limiting on /api — a shared limit is fine at this stage; per-tenant
// limits are a future refinement once real traffic patterns are known.
// Login/register get a tighter limit since they're the most abuse-prone.
app.use(
  "/api/",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
);
app.use(
  "/api/auth",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })
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
app.use("/api/vehicles", authRequired, requireActiveSubscription, vehiclesRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "api_route_not_found" }));

app.get("/pay", (req, res) => {
  const publishableKey = process.env.MOYASAR_PUBLISHABLE_KEY || "";
  const amount = encodeURIComponent(req.query.amount || "0");
  const description = encodeURIComponent(req.query.description || "طلب ركائز");
  const saveCard = req.query.save_card === "1" ? "1" : "0";
  res.redirect(
    `/pay.html?amount=${amount}&description=${description}&key=${encodeURIComponent(publishableKey)}&save_card=${saveCard}`
  );
});
app.use(express.static(path.join(__dirname, "../public")));

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
