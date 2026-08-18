import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

/**
 * GET /api/parts/search?q=...&type=name|pn|vin
 * Unified search used by the customer app and the seller/POS screen.
 * Every query is scoped to req.user.organizationId (set by the authRequired
 * middleware mounted on /api/parts in index.js) — this is THE critical line
 * standing between "each shop only sees its own catalog" and a serious data
 * leak across tenants, so it appears in every query below, not just once.
 */
// Reliability fix: unbounded queries (no LIMIT) let a huge catalog return
// thousands of rows in one response, slowing the app and wasting bandwidth.
// Cap page size and require a page number, same pattern used below.
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

router.get("/search", async (req, res) => {
  const { q = "", type = "name" } = req.query;
  const orgId = req.user.organizationId;
  const { page, pageSize, offset } = parsePagination(req.query);
  try {
    let rows;
    if (type === "pn") {
      const r = await pool.query(
        `SELECT * FROM parts WHERE organization_id = $1 AND part_number ILIKE $2
         ORDER BY name LIMIT $3 OFFSET $4`,
        [orgId, `%${q}%`, pageSize, offset]
      );
      rows = r.rows;
    } else if (type === "vin") {
      const r = await pool.query(
        `SELECT p.* FROM parts p
         JOIN vin_map v ON v.part_id = p.id
         WHERE p.organization_id = $1 AND $2 ILIKE v.vin_pattern || '%'
         ORDER BY p.name LIMIT $3 OFFSET $4`,
        [orgId, q, pageSize, offset]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT * FROM parts
         WHERE organization_id = $1 AND (name ILIKE $2 OR brand ILIKE $2 OR category ILIKE $2)
         ORDER BY name LIMIT $3 OFFSET $4`,
        [orgId, `%${q}%`, pageSize, offset]
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

    res.json({ items: withInventory, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "search_failed" });
  }
});

router.get("/", async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const r = await pool.query(
    "SELECT * FROM parts WHERE organization_id = $1 ORDER BY name LIMIT $2 OFFSET $3",
    [req.user.organizationId, pageSize, offset]
  );
  res.json({ items: r.rows, page, pageSize });
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
  if (price < 0 || (cost != null && cost < 0) || (quantity != null && quantity < 0) || (minQuantity != null && minQuantity < 0)) {
    return res.status(400).json({ error: "negative_value_not_allowed" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (branchId) {
      const branchCheck = await client.query(
        "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
        [branchId, orgId]
      );
      if (!branchCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "branch_not_found" });
      }
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
  const { name, brand, category, price, cost } = req.body;
  if ((price != null && price < 0) || (cost != null && cost < 0)) {
    return res.status(400).json({ error: "negative_value_not_allowed" });
  }
  const r = await pool.query(
    `UPDATE parts SET
       name = COALESCE($1, name),
       brand = COALESCE($2, brand),
       category = COALESCE($3, category),
       price = COALESCE($4, price),
       cost = COALESCE($5, cost)
     WHERE id = $6 AND organization_id = $7 RETURNING *`,
    [name, brand, category, price, cost, req.params.id, req.user.organizationId]
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
  if ((quantity != null && quantity < 0) || (minQuantity != null && minQuantity < 0)) {
    return res.status(400).json({ error: "negative_value_not_allowed" });
  }

  const owns = await pool.query(
    `SELECT p.id FROM parts p WHERE p.id = $1 AND p.organization_id = $2`,
    [req.params.id, req.user.organizationId]
  );
  if (!owns.rows[0]) return res.status(404).json({ error: "not_found" });

  const branchOwns = await pool.query(
    "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
    [branchId, req.user.organizationId]
  );
  if (!branchOwns.rows[0]) return res.status(404).json({ error: "branch_not_found" });

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

export default router;
