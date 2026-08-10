import { Router } from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";

const router = Router();

router.post("/invitations", async (req, res) => {
  const orgId = req.user.organizationId;
  const email = String(req.body.email || "").trim().toLowerCase();
  const role = req.body.role;
  const branchId = req.body.branchId || null;
  if (!email || !email.includes("@") || !["customer", "seller", "warehouse_keeper"].includes(role)) {
    return res.status(400).json({ error: "invalid_invitation" });
  }
  if (["seller", "warehouse_keeper"].includes(role) && !branchId) {
    return res.status(400).json({ error: "employee_branch_required" });
  }

  const client = await pool.connect();
  try {
    if (branchId) {
      const branch = await client.query(
        "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
        [branchId, orgId]
      );
      if (!branch.rows[0]) return res.status(404).json({ error: "branch_not_found" });
    }
    const existing = await client.query(
      "SELECT id FROM users WHERE organization_id = $1 AND lower(email) = $2",
      [orgId, email]
    );
    if (existing.rows[0]) return res.status(409).json({ error: "email_taken" });

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invitation = await client.query(
      `INSERT INTO organization_invites
       (organization_id, email, role, branch_id, token_hash, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,now() + interval '48 hours',$6)
       RETURNING id, email, role, branch_id, expires_at`,
      [orgId, email, role, branchId, tokenHash, req.user.id]
    );
    res.status(201).json({ invitation: invitation.rows[0], token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "invitation_failed" });
  } finally {
    client.release();
  }
});

router.get("/stats", async (req, res) => {
  const orgId = req.user.organizationId;
  const inventoryValue = await pool.query(
    `SELECT COALESCE(SUM(i.quantity * p.cost),0) AS value
     FROM inventory i
     JOIN parts p ON p.id = i.part_id
     JOIN branches b ON b.id = i.branch_id
     WHERE p.organization_id = $1 AND b.organization_id = $1`,
    [orgId]
  );
  const lowStock = await pool.query(
    `SELECT p.id, p.part_number, p.name, i.quantity, i.min_quantity, b.name AS branch_name
     FROM inventory i
     JOIN parts p ON p.id = i.part_id
     JOIN branches b ON b.id = i.branch_id
     WHERE p.organization_id = $1 AND b.organization_id = $1 AND i.quantity < i.min_quantity`,
    [orgId]
  );
  const salesTotal = await pool.query(`SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE organization_id = $1`, [
    orgId,
  ]);

  res.json({
    inventoryValue: Number(inventoryValue.rows[0].value),
    lowStock: lowStock.rows,
    totalSales: Number(salesTotal.rows[0].total),
  });
});

router.get("/branches-summary", async (req, res) => {
  const orgId = req.user.organizationId;
  const r = await pool.query(
    `SELECT b.id, b.name,
       COUNT(i.id) AS part_count,
       COALESCE(SUM(i.quantity * p.cost),0) AS inventory_value,
       COUNT(*) FILTER (WHERE i.quantity < i.min_quantity) AS low_stock_count
     FROM branches b
     LEFT JOIN inventory i ON i.branch_id = b.id
     LEFT JOIN parts p ON p.id = i.part_id
     WHERE b.organization_id = $1
     GROUP BY b.id, b.name
     ORDER BY b.id`,
    [orgId]
  );
  res.json(r.rows);
});

router.get("/inventory-movements", async (req, res) => {
  const result = await pool.query(
    `SELECT m.id, m.movement_type, m.quantity_change, m.note, m.reference_type,
            m.reference_id, m.created_at, p.part_number, p.name AS part_name,
            b.name AS branch_name, u.name AS employee_name, d.name AS device_name
     FROM inventory_movements m
     JOIN parts p ON p.id = m.part_id
     JOIN branches b ON b.id = m.branch_id
     JOIN users u ON u.id = m.performed_by
     LEFT JOIN organization_devices d ON d.id = m.device_id
     WHERE m.organization_id = $1
     ORDER BY m.created_at DESC LIMIT 200`,
    [req.user.organizationId]
  );
  res.json(result.rows);
});

/** GET /api/admin/organization — the tenant's own profile + subscription status */
router.get("/organization", async (req, res) => {
  const r = await pool.query(
    `SELECT id, name, login_code, vat_number, plan, plan_price_sar, trial_ends_at,
            subscription_status, next_billing_at, billing_interval, created_at,
            (moyasar_card_token IS NOT NULL) AS has_payment_method
     FROM organizations WHERE id = $1`,
    [req.user.organizationId]
  );
  res.json(r.rows[0] || null);
});

export default router;
