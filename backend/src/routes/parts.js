import { Router } from "express";
import { pool } from "../db/pool.js";
import { deviceRequired } from "./devices.js";
import { normalizeVin } from "./vehicles.js";

const router = Router();

export function isNonNegativeMoney(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function isNonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

async function branchBelongsToOrganization(client, branchId, organizationId) {
  const result = await client.query(
    "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
    [branchId, organizationId]
  );
  return Boolean(result.rows[0]);
}

/**
 * GET /api/parts/search?q=...&type=name|pn|vin
 * Unified search used by the customer app and the seller/POS screen.
 * Every query is scoped to req.user.organizationId (set by the authRequired
 * middleware mounted on /api/parts in index.js) — this is THE critical line
 * standing between "each shop only sees its own catalog" and a serious data
 * leak across tenants, so it appears in every query below, not just once.
 */
router.get("/search", async (req, res) => {
  const { q = "", type = "name" } = req.query;
  const orgId = req.user.organizationId;
  try {
    let rows;
    if (type === "pn") {
      const r = await pool.query(
        `SELECT * FROM parts WHERE organization_id = $1 AND catalog_status = 'active' AND part_number ILIKE $2`,
        [orgId, `%${q}%`]
      );
      rows = r.rows;
    } else if (type === "vin") {
      const vin = normalizeVin(q);
      if (!vin) return res.status(400).json({ error: "invalid_vin" });
      const ownerFilter = req.user.role === "customer" ? "AND cv.user_id = $3" : "";
      const params = req.user.role === "customer" ? [orgId, vin, req.user.id] : [orgId, vin];
      const savedVehicle = await pool.query(
        `SELECT id FROM customer_vehicles cv WHERE cv.organization_id = $1 AND cv.vin = $2 ${ownerFilter} LIMIT 1`,
        params
      );
      if (!savedVehicle.rows[0]) return res.status(404).json({ error: "vehicle_not_saved" });
      const r = await pool.query(
        `SELECT DISTINCT p.* FROM customer_vehicles cv
         JOIN vehicle_applications va
           ON va.organization_id = cv.organization_id
          AND lower(va.make) = lower(cv.make)
          AND lower(va.model) = lower(cv.model)
          AND (va.year_from IS NULL OR cv.model_year >= va.year_from)
          AND (va.year_to IS NULL OR cv.model_year <= va.year_to)
          AND (va.engine IS NULL OR lower(va.engine) = lower(cv.engine))
          AND va.verification_status = 'verified'
         JOIN parts p ON p.id = va.part_id
         WHERE cv.organization_id = $1 AND cv.vin = $2 ${ownerFilter}
           AND p.organization_id = $1 AND p.catalog_status = 'active'`,
        params
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT * FROM parts
         WHERE organization_id = $1 AND catalog_status = 'active' AND (name ILIKE $2 OR brand ILIKE $2 OR category ILIKE $2)`,
        [orgId, `%${q}%`]
      );
      rows = r.rows;
    }

    // attach inventory + shelf location per branch for each part found
    const withInventory = await Promise.all(
      rows.map(async (part) => {
        const inv = await pool.query(
          `SELECT i.*, b.name AS branch_name
           FROM inventory i JOIN branches b ON b.id = i.branch_id
           WHERE i.part_id = $1 AND b.organization_id = $2`,
          [part.id, orgId]
        );
        // the app-facing "id" stays the shop-friendly part_number (e.g. P-1001);
        // the numeric primary key is an internal detail callers don't need
        return { ...part, id: part.part_number, inventory: inv.rows };
      })
    );

    res.json(withInventory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "search_failed" });
  }
});

router.get("/", async (req, res) => {
  const r = await pool.query("SELECT * FROM parts WHERE organization_id = $1 ORDER BY name", [
    req.user.organizationId,
  ]);
  res.json(r.rows);
});

/**
 * POST /api/parts
 * Lets a shop owner add a new part to THEIR OWN catalog from the dashboard —
 * no developer involvement needed. Restricted to seller/admin (checked in
 * index.js's requireRole for /api/admin, but parts is mounted for both
 * seller and admin so we check the role inline here instead).
 */
router.post("/", async (req, res) => {
  if (!["admin", "seller"].includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
  const orgId = req.user.organizationId;
  const { partNumber, name, brand, category, price, cost, branchId, quantity, minQuantity } = req.body;
  if (!partNumber || !name || price == null) {
    return res.status(400).json({ error: "missing_fields" });
  }
  if (!isNonNegativeMoney(price) || !isNonNegativeMoney(cost ?? 0)) {
    return res.status(400).json({ error: "invalid_price" });
  }
  if (!isNonNegativeInteger(quantity ?? 0) || !isNonNegativeInteger(minQuantity ?? 5)) {
    return res.status(400).json({ error: "invalid_quantity" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (branchId && !(await branchBelongsToOrganization(client, branchId, orgId))) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "branch_not_found" });
    }
    const partRes = await client.query(
      `INSERT INTO parts (organization_id, part_number, name, brand, category, price, cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [orgId, partNumber, name, brand || null, category || null, price, cost || 0]
    );
    const part = partRes.rows[0];

    if (branchId) {
      await client.query(
        `INSERT INTO inventory (part_id, branch_id, quantity, min_quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (part_id, branch_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [part.id, branchId, quantity || 0, minQuantity || 5]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(part);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "part_number_exists" });
    console.error(err);
    res.status(500).json({ error: "create_failed" });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/parts/:id  — edit price/cost/name/brand/category of an existing part.
 * :id here is the numeric primary key (not the shop-facing part_number).
 */
router.put("/:id", async (req, res) => {
  if (!["admin", "seller"].includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
  const { name, brand, category, price, cost, barcode, manufacturer, catalogStatus } = req.body;
  if ((price != null && !isNonNegativeMoney(price)) || (cost != null && !isNonNegativeMoney(cost))) {
    return res.status(400).json({ error: "invalid_price" });
  }
  if (catalogStatus != null && !["draft", "active", "archived"].includes(catalogStatus)) {
    return res.status(400).json({ error: "invalid_catalog_status" });
  }
  if (catalogStatus === "active") {
    const current = await pool.query(
      "SELECT price FROM parts WHERE id = $1 AND organization_id = $2",
      [req.params.id, req.user.organizationId]
    );
    const effectivePrice = price ?? current.rows[0]?.price;
    if (!current.rows[0] || Number(effectivePrice) <= 0) {
      return res.status(400).json({ error: "positive_price_required_for_activation" });
    }
  }
  const r = await pool.query(
    `UPDATE parts SET
       name = COALESCE($1, name),
       brand = COALESCE($2, brand),
       category = COALESCE($3, category),
       price = COALESCE($4, price),
       cost = COALESCE($5, cost),
       barcode = COALESCE($6, barcode),
       manufacturer = COALESCE($7, manufacturer),
       catalog_status = COALESCE($8, catalog_status)
     WHERE id = $9 AND organization_id = $10 RETURNING *`,
    [name, brand, category, price, cost, barcode, manufacturer, catalogStatus, req.params.id, req.user.organizationId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  res.json(r.rows[0]);
});

/** DELETE /api/parts/:id */
router.delete("/:id", async (req, res) => {
  if (!["admin", "seller"].includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
  const r = await pool.query(
    "DELETE FROM parts WHERE id = $1 AND organization_id = $2 RETURNING id",
    [req.params.id, req.user.organizationId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

/**
 * PUT /api/parts/:id/inventory — set stock quantity + shelf location at a branch.
 * Used by the "monitor inventory" screen; upserts so the owner can set stock
 * for a branch that has no inventory row yet.
 */
router.put("/:id/inventory", async (req, res) => {
  if (!["admin", "seller"].includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
  const { branchId, quantity, minQuantity, shelfSection, shelfNumber, shelfLevel } = req.body;
  if (!branchId) return res.status(400).json({ error: "missing_branchId" });
  if (!isNonNegativeInteger(quantity ?? 0) || !isNonNegativeInteger(minQuantity ?? 5)) {
    return res.status(400).json({ error: "invalid_quantity" });
  }

  // ownership check: the branch must belong to this org
  const owns = await pool.query(
    `SELECT p.id FROM parts p WHERE p.id = $1 AND p.organization_id = $2`,
    [req.params.id, req.user.organizationId]
  );
  if (!owns.rows[0]) return res.status(404).json({ error: "not_found" });

  const branchOwned = await branchBelongsToOrganization(pool, branchId, req.user.organizationId);
  if (!branchOwned) return res.status(404).json({ error: "branch_not_found" });

  const r = await pool.query(
    `INSERT INTO inventory (part_id, branch_id, quantity, min_quantity, shelf_section, shelf_number, shelf_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (part_id, branch_id) DO UPDATE SET
       quantity = EXCLUDED.quantity,
       min_quantity = COALESCE(EXCLUDED.min_quantity, inventory.min_quantity),
       shelf_section = COALESCE(EXCLUDED.shelf_section, inventory.shelf_section),
       shelf_number = COALESCE(EXCLUDED.shelf_number, inventory.shelf_number),
       shelf_level = COALESCE(EXCLUDED.shelf_level, inventory.shelf_level)
     RETURNING *`,
    [req.params.id, branchId, quantity ?? 0, minQuantity ?? 5, shelfSection || null, shelfNumber || null, shelfLevel || null]
  );
  res.json(r.rows[0]);
});

/** Records an auditable warehouse issue; identity comes from JWT + paired device. */
router.post("/:id/issue", deviceRequired, async (req, res) => {
  if (!["admin", "warehouse_keeper"].includes(req.user.role)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const quantity = Number(req.body.quantity);
  const note = String(req.body.note || "").trim() || null;
  const branchId = req.device.branch_id;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "invalid_quantity" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const part = await client.query(
      "SELECT id FROM parts WHERE id = $1 AND organization_id = $2",
      [req.params.id, req.user.organizationId]
    );
    if (!part.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "part_not_found" });
    }
    const inventory = await client.query(
      `UPDATE inventory SET quantity = quantity - $1
       WHERE part_id = $2 AND branch_id = $3 AND quantity >= $1
       RETURNING quantity`,
      [quantity, req.params.id, branchId]
    );
    if (!inventory.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "insufficient_stock" });
    }
    const movement = await client.query(
      `INSERT INTO inventory_movements
       (organization_id, branch_id, part_id, device_id, performed_by, movement_type, quantity_change, note)
       VALUES ($1,$2,$3,$4,$5,'warehouse_issue',$6,$7)
       RETURNING id, branch_id, part_id, performed_by, movement_type, quantity_change, note, created_at`,
      [req.user.organizationId, branchId, req.params.id, req.device.id, req.user.id, -quantity, note]
    );
    await client.query("COMMIT");
    res.status(201).json({ movement: movement.rows[0], remainingQuantity: inventory.rows[0].quantity });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "warehouse_issue_failed" });
  } finally {
    client.release();
  }
});

export default router;
