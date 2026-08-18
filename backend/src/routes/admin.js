import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "./auth.js";

const router = Router();

// Security fix: NONE of the routes in this file had any role restriction —
// any authenticated user, including a "customer" account, could read the
// shop's inventory value, sales totals, and (most seriously) the full
// organizations row via /organization, which includes the saved Moyasar
// card token used for automatic billing. Restrict all of these to staff.
router.get("/stats", requireRole("seller", "admin"), async (req, res) => {
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

router.get("/branches-summary", requireRole("seller", "admin"), async (req, res) => {
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

/**
 * GET /api/admin/organization — the tenant's own profile + subscription status.
 * Security fix: this had no role restriction (any customer could call it)
 * AND used SELECT * on organizations, which returns the raw moyasar_card_token
 * used for unattended subscription billing. Restrict to admin, and never
 * return the raw token — expose only a boolean, same pattern already used
 * in billing.js's /status route.
 */
router.get("/organization", requireRole("admin"), async (req, res) => {
  const r = await pool.query(
    `SELECT id, name, vat_number, plan, plan_price_sar, trial_ends_at, subscription_status,
            (moyasar_card_token IS NOT NULL) AS has_payment_method, next_billing_at, billing_interval
     FROM organizations WHERE id = $1`,
    [req.user.organizationId]
  );
  res.json(r.rows[0] || null);
});

export default router;
