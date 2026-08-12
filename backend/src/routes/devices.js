import crypto from "crypto";
import { pool } from "../db/pool.js";
import { authRequired, requireRole } from "./auth.js";
import { createSafeRouter } from "../utils/safe-router.js";

const router = createSafeRouter();

function hashSecret(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  await pool.query(
    `INSERT INTO device_pairing_codes
     (organization_id, branch_id, device_name, code_hash, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,now() + interval '10 minutes')`,
    [req.user.organizationId, branchId, deviceName, hashSecret(code), req.user.id]
  );
  res.status(201).json({ code, expiresInSeconds: 600 });
});

router.post("/pair", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid_pairing_code" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM device_pairing_codes
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashSecret(code)]
    );
    const pairing = result.rows[0];
    if (!pairing) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "pairing_code_invalid_or_expired" });
    }
    const deviceToken = crypto.randomBytes(32).toString("base64url");
    const deviceResult = await client.query(
      `INSERT INTO organization_devices
       (organization_id, branch_id, name, token_hash, paired_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, organization_id, branch_id, name, status, paired_at`,
      [pairing.organization_id, pairing.branch_id, pairing.device_name, hashSecret(deviceToken), pairing.created_by]
    );
    await client.query("UPDATE device_pairing_codes SET used_at = now() WHERE id = $1", [pairing.id]);
    await client.query("COMMIT");
    res.status(201).json({ device: deviceResult.rows[0], deviceToken });
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
    `SELECT d.id, d.name, d.branch_id, b.name AS branch_name, d.status, d.paired_at, d.last_seen_at
     FROM organization_devices d JOIN branches b ON b.id = d.branch_id
     WHERE d.organization_id = $1 ORDER BY d.paired_at DESC`,
    [req.user.organizationId]
  );
  res.json(result.rows);
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  const result = await pool.query(
    `UPDATE organization_devices SET status = 'revoked'
     WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [req.params.id, req.user.organizationId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "device_not_found" });
  res.json({ ok: true });
});

export async function deviceRequired(req, res, next) {
  const token = req.headers["x-device-token"];
  if (typeof token !== "string" || !token) return res.status(401).json({ error: "device_not_paired" });
  try {
    const result = await pool.query(
      `UPDATE organization_devices SET last_seen_at = now()
       WHERE token_hash = $1 AND status = 'active' AND organization_id = $2
       RETURNING id, organization_id, branch_id, name`,
      [hashSecret(token), req.user.organizationId]
    );
    if (!result.rows[0]) return res.status(401).json({ error: "device_invalid_or_revoked" });
    if (["seller", "warehouse_keeper"].includes(req.user.role) && Number(req.user.branchId) !== Number(result.rows[0].branch_id)) {
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
