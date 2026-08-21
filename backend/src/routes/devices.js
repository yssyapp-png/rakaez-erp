import crypto from "crypto";
import { pool } from "../db/pool.js";
import { authRequired, requireRole } from "./auth.js";
import { createSafeRouter } from "../utils/safe-router.js";
import { recordSecurityEvent, securityHash } from "../utils/security.js";
import { clearDeviceCookie, readDeviceCookie, setDeviceCookie } from "../utils/http-security.js";

const router = createSafeRouter();
const PAIRING_FAILURE_LIMIT = 10;
const PAIRING_WINDOW_MINUTES = 15;
const PAIRING_LOCK_MINUTES = 15;
const DEVICE_TTL_DAYS = 90;

function pairingCodeHash(value) {
  return securityHash(`device-pairing-code\n${value}`);
}

function deviceTokenHash(value) {
  return securityHash(`device-token\n${value}`);
}

async function activePairingBlock(db, sourceHash) {
  const result = await db.query(
    "SELECT blocked_until FROM device_pairing_guards WHERE source_hash = $1 AND blocked_until > now()",
    [sourceHash]
  );
  return result.rows[0]?.blocked_until || null;
}

async function recordPairingFailure(db, sourceHash) {
  const result = await db.query(
    `INSERT INTO device_pairing_guards
       (source_hash, failure_count, window_started_at, last_failed_at, updated_at)
     VALUES ($1,1,now(),now(),now())
     ON CONFLICT (source_hash) DO UPDATE SET
       failure_count = CASE
         WHEN device_pairing_guards.window_started_at < now() - ($2::text || ' minutes')::interval THEN 1
         ELSE device_pairing_guards.failure_count + 1
       END,
       window_started_at = CASE
         WHEN device_pairing_guards.window_started_at < now() - ($2::text || ' minutes')::interval THEN now()
         ELSE device_pairing_guards.window_started_at
       END,
       last_failed_at = now(),
       blocked_until = CASE
         WHEN (CASE
           WHEN device_pairing_guards.window_started_at < now() - ($2::text || ' minutes')::interval THEN 1
           ELSE device_pairing_guards.failure_count + 1
         END) >= $3 THEN now() + ($4::text || ' minutes')::interval
         ELSE device_pairing_guards.blocked_until
       END,
       updated_at = now()
     RETURNING failure_count, blocked_until`,
    [sourceHash, PAIRING_WINDOW_MINUTES, PAIRING_FAILURE_LIMIT, PAIRING_LOCK_MINUTES]
  );
  return result.rows[0];
}

router.post("/pairing-code", authRequired, requireRole("admin"), async (req, res) => {
  const body = req.body || {};
  const branchId = Number(body.branchId);
  const deviceName = String(body.deviceName || "").trim();
  if (!Number.isInteger(branchId) || !deviceName || deviceName.length > 120) {
    return res.status(400).json({ error: "invalid_device_details" });
  }
  const branch = await pool.query(
    "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
    [branchId, req.user.organizationId]
  );
  if (!branch.rows[0]) return res.status(404).json({ error: "branch_not_found" });

  const code = String(crypto.randomInt(100000, 1000000));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE device_pairing_codes SET used_at = now()
       WHERE organization_id = $1 AND branch_id = $2 AND device_name = $3
         AND used_at IS NULL`,
      [req.user.organizationId, branchId, deviceName]
    );
    await client.query(
      `INSERT INTO device_pairing_codes
       (organization_id, branch_id, device_name, code_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + interval '10 minutes')`,
      [req.user.organizationId, branchId, deviceName, pairingCodeHash(code), req.user.id]
    );
    await recordSecurityEvent(client, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId: req.user.sid,
      eventType: "device_pairing_code_created",
      outcome: "success",
      metadata: { branch_id: branchId },
    });
    await client.query("COMMIT");
    res.status(201).json({ code, expiresInSeconds: 600 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.post("/pair", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid_pairing_code" });
  const sourceHash = securityHash(`device-pairing-source\n${req.ip || req.socket?.remoteAddress || "unknown"}`);
  const blockedUntil = await activePairingBlock(pool, sourceHash);
  if (blockedUntil) {
    await recordSecurityEvent(pool, {
      req,
      subjectHash: sourceHash,
      eventType: "device_pairing_blocked",
      outcome: "blocked",
      severity: "high",
    });
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((new Date(blockedUntil) - new Date()) / 1000))));
    return res.status(429).json({ error: "device_pairing_temporarily_blocked" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM device_pairing_codes
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [pairingCodeHash(code)]
    );
    const pairing = result.rows[0];
    if (!pairing) {
      const guard = await recordPairingFailure(client, sourceHash);
      await recordSecurityEvent(client, {
        req,
        subjectHash: sourceHash,
        eventType: guard.blocked_until ? "device_pairing_blocked" : "device_pairing_failed",
        outcome: guard.blocked_until ? "blocked" : "failure",
        severity: guard.blocked_until ? "high" : "warning",
        metadata: { failure_count: guard.failure_count },
      });
      await client.query("COMMIT");
      if (guard.blocked_until) res.setHeader("Retry-After", String(PAIRING_LOCK_MINUTES * 60));
      return res.status(guard.blocked_until ? 429 : 400).json({
        error: guard.blocked_until ? "device_pairing_temporarily_blocked" : "pairing_code_invalid_or_expired",
      });
    }
    const deviceToken = crypto.randomBytes(32).toString("base64url");
    const deviceResult = await client.query(
      `INSERT INTO organization_devices
       (organization_id, branch_id, name, token_hash, paired_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,now() + ($6::text || ' days')::interval)
       RETURNING id, organization_id, branch_id, name, status, paired_at, expires_at`,
      [pairing.organization_id, pairing.branch_id, pairing.device_name, deviceTokenHash(deviceToken), pairing.created_by, DEVICE_TTL_DAYS]
    );
    await client.query("UPDATE device_pairing_codes SET used_at = now() WHERE id = $1", [pairing.id]);
    await client.query("DELETE FROM device_pairing_guards WHERE source_hash = $1", [sourceHash]);
    await recordSecurityEvent(client, {
      req,
      organizationId: pairing.organization_id,
      userId: pairing.created_by,
      subjectHash: sourceHash,
      eventType: "device_pairing_succeeded",
      outcome: "success",
      metadata: { branch_id: pairing.branch_id, device_id: deviceResult.rows[0].id },
    });
    await client.query("COMMIT");
    setDeviceCookie(res, deviceToken, DEVICE_TTL_DAYS);
    res.status(201).json({ device: deviceResult.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "device_pairing_failed" });
  } finally {
    client.release();
  }
});

router.get("/", authRequired, requireRole("admin"), async (req, res) => {
  const result = await pool.query(
    `SELECT d.id, d.name, d.branch_id, b.name AS branch_name, d.status, d.paired_at, d.last_seen_at, d.expires_at
     FROM organization_devices d JOIN branches b ON b.id = d.branch_id
     WHERE d.organization_id = $1 ORDER BY d.paired_at DESC`,
    [req.user.organizationId]
  );
  res.json(result.rows);
});

router.get("/status", authRequired, deviceRequired, async (req, res) => {
  res.json({ paired: true, device: req.device });
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  const deviceId = Number(req.params.id);
  if (!Number.isInteger(deviceId) || deviceId < 1) return res.status(400).json({ error: "invalid_device_id" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE organization_devices SET status = 'revoked', expires_at = LEAST(expires_at, now())
       WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [deviceId, req.user.organizationId]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "device_not_found" });
    }
    await recordSecurityEvent(client, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId: req.user.sid,
      eventType: "device_revoked",
      outcome: "success",
      severity: "warning",
      metadata: { device_id: deviceId },
    });
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

export async function deviceRequired(req, res, next) {
  const token = readDeviceCookie(req) || req.headers["x-device-token"];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    clearDeviceCookie(res);
    return res.status(401).json({ error: "device_not_paired" });
  }
  try {
    const result = await pool.query(
      `UPDATE organization_devices SET last_seen_at = now()
       WHERE token_hash = $1 AND status = 'active' AND expires_at > now() AND organization_id = $2
       RETURNING id, organization_id, branch_id, name, expires_at`,
      [deviceTokenHash(token), req.user.organizationId]
    );
    if (!result.rows[0]) {
      clearDeviceCookie(res);
      return res.status(401).json({ error: "device_invalid_or_revoked" });
    }
    if (["seller", "warehouse_keeper", "branch_manager"].includes(req.user.role) && Number(req.user.branchId) !== Number(result.rows[0].branch_id)) {
      clearDeviceCookie(res);
      return res.status(403).json({ error: "employee_device_branch_mismatch" });
    }
    req.device = result.rows[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "device_check_failed" });
  }
}

export default router;
