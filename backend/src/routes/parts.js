import { pool } from "../db/pool.js";
import { deviceRequired } from "./devices.js";
import { normalizeVin } from "./vehicles.js";
import { requireRole } from "./auth.js";
import { createSafeRouter } from "../utils/safe-router.js";
import { recordSecurityEvent, securityHash } from "../utils/security.js";

const router = createSafeRouter();

export function isNonNegativeMoney(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function isNonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

const IMPORT_BATCH_LIMIT = 1000;
const IMPORT_MODES = new Set(["skip", "replace", "add"]);

function cleanImportText(value, maxLength = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

export function validateImportRows(rows, mode = "skip") {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > IMPORT_BATCH_LIMIT) {
    return { error: "invalid_import_batch", validRows: [], errors: [] };
  }
  if (!IMPORT_MODES.has(mode)) return { error: "invalid_import_mode", validRows: [], errors: [] };

  const seen = new Set();
  const validRows = [];
  const errors = [];
  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const partNumber = cleanImportText(raw.partNumber, 100).toUpperCase();
    const name = cleanImportText(raw.name);
    const price = Number(raw.price);
    const cost = raw.cost === "" || raw.cost == null ? 0 : Number(raw.cost);
    const quantity = raw.quantity === "" || raw.quantity == null ? 0 : Number(raw.quantity);
    const minQuantity = raw.minQuantity === "" || raw.minQuantity == null ? 5 : Number(raw.minQuantity);
    const rowErrors = [];
    if (!partNumber) rowErrors.push("part_number_required");
    if (!name) rowErrors.push("name_required");
    if (!isNonNegativeMoney(price) || price <= 0) rowErrors.push("invalid_price");
    if (!isNonNegativeMoney(cost)) rowErrors.push("invalid_cost");
    if (!isNonNegativeInteger(quantity)) rowErrors.push("invalid_quantity");
    if (!isNonNegativeInteger(minQuantity)) rowErrors.push("invalid_min_quantity");
    if (seen.has(partNumber)) rowErrors.push("duplicate_in_file");
    if (partNumber) seen.add(partNumber);
    if (rowErrors.length) {
      errors.push({ rowNumber, partNumber, errors: rowErrors });
      return;
    }
    validRows.push({
      rowNumber, partNumber, name,
      brand: cleanImportText(raw.brand, 120) || null,
      category: cleanImportText(raw.category, 120) || null,
      barcode: cleanImportText(raw.barcode, 120) || null,
      price, cost, quantity, minQuantity,
      shelfSection: cleanImportText(raw.shelfSection, 50) || null,
      shelfNumber: cleanImportText(raw.shelfNumber, 50) || null,
      shelfLevel: cleanImportText(raw.shelfLevel, 50) || null,
    });
  });
  return { validRows, errors, mode };
}

export function normalizeShelfLookup(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return normalized && normalized.length <= 100 ? normalized : null;
}

export function normalizeWarehouseLookup(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 120 ? normalized : null;
}

const BRANCH_INVENTORY_SEARCH_TYPES = new Set(["all", "part_number", "barcode", "oem", "name"]);

/**
 * Normalizes the cross-branch availability query and escapes SQL LIKE
 * metacharacters. Requiring at least two visible characters prevents a
 * branch manager from turning this lookup into an unbounded catalog export.
 */
export function normalizeBranchInventorySearch(value, type = "all") {
  const query = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  const normalizedType = String(type || "all");
  if (query.length < 2 || query.length > 120 || !BRANCH_INVENTORY_SEARCH_TYPES.has(normalizedType)) {
    return null;
  }
  return {
    query,
    type: normalizedType,
    likeQuery: `%${query.replace(/[\\%_]/g, "\\$&")}%`,
  };
}

export function groupBranchInventoryRows(rows, currentBranchId) {
  const parts = [];
  const byId = new Map();
  for (const row of rows) {
    let part = byId.get(row.part_id);
    if (!part) {
      part = {
        id: row.part_id,
        partNumber: row.part_number,
        name: row.name,
        brand: row.brand,
        category: row.category,
        barcode: row.barcode,
        oemNumbers: row.oem_numbers,
        crossReferenceNumbers: row.cross_reference_numbers,
        totalAvailable: 0,
        availability: [],
      };
      byId.set(row.part_id, part);
      parts.push(part);
    }
    const quantity = Number(row.quantity);
    part.totalAvailable += quantity;
    part.availability.push({
      branchId: row.branch_id,
      branchName: row.branch_name,
      city: row.branch_city,
      quantity,
      shelfSection: row.shelf_section,
      shelfNumber: row.shelf_number,
      shelfLevel: row.shelf_level,
      isCurrentBranch: Number(row.branch_id) === Number(currentBranchId),
    });
  }
  return parts;
}

async function branchBelongsToOrganization(client, branchId, organizationId) {
  const result = await client.query(
    "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
    [branchId, organizationId]
  );
  return Boolean(result.rows[0]);
}

const CUSTOMER_PART_COLUMNS = `p.id, p.part_number, p.name, p.brand, p.category,
  p.barcode, p.manufacturer, p.oem_numbers, p.cross_reference_numbers, p.unit,
  p.quality_grade, p.country_of_origin, p.warranty_months, p.price`;

const STAFF_PART_COLUMNS = `${CUSTOMER_PART_COLUMNS}, p.cost, p.catalog_status,
  p.catalog_source, p.catalog_key`;

function normalizeCatalogCodes(value) {
  if (value == null) return undefined;

  const source = Array.isArray(value)
    ? value
    : String(value).split(/[;,\n]+/);

  const items = [...new Set(
    source
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];

  if (items.length > 50) return null;
  if (items.some((item) => item.length > 120)) return null;

  return items;
}

function normalizeCatalogText(value, maxLength) {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (text.length > maxLength) return null;
  return text || null;
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
  if (!["customer", "seller", "warehouse_keeper", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const { q = "", type = "all" } = req.query;
  const searchTerm = String(q).trim();
  const searchType = String(type || "all").trim().toLowerCase();
  const allowedSearchTypes = new Set(["all", "name", "pn", "barcode", "oem", "vin"]);

  if (!searchTerm) return res.status(400).json({ error: "search_required" });
  if (searchTerm.length > 120) return res.status(400).json({ error: "search_too_long" });
  if (!allowedSearchTypes.has(searchType)) {
    return res.status(400).json({ error: "invalid_search_type" });
  }

  const orgId = req.user.organizationId;
  const isCustomer = req.user.role === "customer";
  const partColumns = req.user.role === "admin" ? STAFF_PART_COLUMNS : CUSTOMER_PART_COLUMNS;
  try {
    let rows;
    if (searchType === "pn") {
      const r = await pool.query(
        `SELECT ${partColumns} FROM parts p
         WHERE p.organization_id = $1 AND p.catalog_status = 'active' AND p.part_number ILIKE $2
         ORDER BY p.name LIMIT 100`,
        [orgId, `%${searchTerm}%`]
      );
      rows = r.rows;
    } else if (searchType === "barcode") {
      const r = await pool.query(
        `SELECT ${partColumns} FROM parts p
         WHERE p.organization_id = $1
           AND p.catalog_status = 'active'
           AND p.barcode = $2
         ORDER BY p.name
         LIMIT 100`,
        [orgId, searchTerm]
      );
      rows = r.rows;
    } else if (searchType === "oem") {
      const r = await pool.query(
        `SELECT ${partColumns} FROM parts p
         WHERE p.organization_id = $1
           AND p.catalog_status = 'active'
           AND EXISTS (
             SELECT 1
             FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS code
             WHERE code ILIKE $2
           )
         ORDER BY CASE
           WHEN EXISTS (
             SELECT 1
             FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS exact_code
             WHERE upper(exact_code) = upper($3)
           ) THEN 0
           ELSE 1
         END, p.name
         LIMIT 100`,
        [orgId, `%${searchTerm}%`, searchTerm]
      );
      rows = r.rows;
    } else if (searchType === "vin") {
      const vin = normalizeVin(searchTerm);
      if (!vin) return res.status(400).json({ error: "invalid_vin" });
      const ownerFilter = req.user.role === "customer" ? "AND cv.user_id = $3" : "";
      const params = req.user.role === "customer" ? [orgId, vin, req.user.id] : [orgId, vin];
      const savedVehicle = await pool.query(
        `SELECT id FROM customer_vehicles cv WHERE cv.organization_id = $1 AND cv.vin = $2 ${ownerFilter} LIMIT 1`,
        params
      );
      if (!savedVehicle.rows[0]) return res.status(404).json({ error: "vehicle_not_saved" });
      const r = await pool.query(
        `SELECT DISTINCT ${partColumns} FROM customer_vehicles cv
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
        `SELECT ${partColumns} FROM parts p
         WHERE p.organization_id = $1
           AND p.catalog_status = 'active'
           AND (
             ($3 = 'name' AND (
               p.name ILIKE $2
               OR coalesce(p.brand, '') ILIKE $2
               OR coalesce(p.category, '') ILIKE $2
               OR coalesce(p.manufacturer, '') ILIKE $2
             ))
             OR
             ($3 = 'all' AND (
               p.name ILIKE $2
               OR coalesce(p.brand, '') ILIKE $2
               OR coalesce(p.category, '') ILIKE $2
               OR coalesce(p.manufacturer, '') ILIKE $2
               OR p.part_number ILIKE $2
               OR coalesce(p.barcode, '') ILIKE $2
               OR EXISTS (
                 SELECT 1
                 FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS code
                 WHERE code ILIKE $2
               )
             ))
           )
         ORDER BY CASE
           WHEN upper(p.part_number) = upper($4)
             OR upper(coalesce(p.barcode, '')) = upper($4)
           THEN 0
           WHEN EXISTS (
             SELECT 1
             FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS exact_code
             WHERE upper(exact_code) = upper($4)
           ) THEN 1
           ELSE 2
         END, p.name
         LIMIT 100`,
        [orgId, `%${searchTerm}%`, searchType, searchTerm]
      );
      rows = r.rows;
    }

    // attach inventory + shelf location per branch for each part found
    const withInventory = await Promise.all(
      rows.map(async (part) => {
        const inventoryColumns = isCustomer
          ? "i.id, i.branch_id, b.name AS branch_name, i.quantity"
          : "i.id, i.branch_id, b.name AS branch_name, i.quantity, i.min_quantity, i.shelf_section, i.shelf_number, i.shelf_level";
        const isBranchEmployee = ["seller", "warehouse_keeper"].includes(req.user.role);
        const branchFilter = isBranchEmployee ? "AND i.branch_id = $3" : "";
        const inventoryParams = isBranchEmployee
          ? [part.id, orgId, req.user.branchId]
          : [part.id, orgId];
        const inv = await pool.query(
          `SELECT ${inventoryColumns}
           FROM inventory i JOIN branches b ON b.id = i.branch_id
           WHERE i.part_id = $1 AND b.organization_id = $2 ${branchFilter}`,
          inventoryParams
        );
        const visibleInventory = isCustomer
          ? inv.rows.filter((row) => Number(row.quantity) > 0).map((row) => ({
              id: row.id,
              branch_id: row.branch_id,
              branch_name: row.branch_name,
              available: true,
            }))
          : inv.rows;
        // the app-facing "id" stays the shop-friendly part_number (e.g. P-1001);
        // the numeric primary key is an internal detail callers don't need
        return { ...part, id: part.part_number, inventory: visibleInventory };
      })
    );

    res.json(withInventory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "search_failed" });
  }
});

/**
 * GET /api/parts/branch-availability?q=...&type=all|part_number|barcode|oem|name
 *
 * Read-only network availability for branch managers. The organization id
 * and current branch id always come from the verified server session. Both
 * parts and branches are independently tenant-scoped in SQL so guessed ids
 * can never expose another company's stock. Cost and supplier data are not
 * selected. Only positive stock is returned, capped at 50 matched parts.
 */
router.get(
  "/branch-availability",
  requireRole("branch_manager", "admin"),
  async (req, res) => {
    const search = normalizeBranchInventorySearch(req.query.q, req.query.type);
    if (!search) return res.status(400).json({ error: "invalid_branch_inventory_search" });
    if (req.user.role === "branch_manager" && !req.user.branchId) {
      return res.status(403).json({ error: "employee_branch_required" });
    }

    try {
      const result = await pool.query(
        `WITH matched_parts AS (
           SELECT p.id, p.part_number, p.name, p.brand, p.category, p.barcode,
                  p.oem_numbers, p.cross_reference_numbers
           FROM parts p
           WHERE p.organization_id = $1
             AND p.catalog_status = 'active'
             AND (
               ($4 = 'barcode' AND p.barcode = $2)
               OR ($4 = 'part_number' AND p.part_number ILIKE $3 ESCAPE '\\')
               OR ($4 = 'oem' AND EXISTS (
                 SELECT 1 FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS code
                 WHERE code ILIKE $3 ESCAPE '\\'
               ))
               OR ($4 = 'name' AND (
                 p.name ILIKE $3 ESCAPE '\\'
                 OR coalesce(p.brand, '') ILIKE $3 ESCAPE '\\'
                 OR coalesce(p.category, '') ILIKE $3 ESCAPE '\\'
               ))
               OR ($4 = 'all' AND (
                 p.barcode = $2
                 OR p.part_number ILIKE $3 ESCAPE '\\'
                 OR p.name ILIKE $3 ESCAPE '\\'
                 OR coalesce(p.brand, '') ILIKE $3 ESCAPE '\\'
                 OR coalesce(p.category, '') ILIKE $3 ESCAPE '\\'
                 OR EXISTS (
                   SELECT 1 FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS code
                   WHERE code ILIKE $3 ESCAPE '\\'
                 )
               ))
             )
           ORDER BY CASE
             WHEN p.barcode = $2 OR upper(p.part_number) = upper($2) THEN 0
             WHEN EXISTS (
               SELECT 1 FROM unnest(p.oem_numbers || p.cross_reference_numbers) AS exact_code
               WHERE upper(exact_code) = upper($2)
             ) THEN 1
             ELSE 2
           END, p.name
           LIMIT 50
         )
         SELECT mp.id AS part_id, mp.part_number, mp.name, mp.brand, mp.category,
                mp.barcode, mp.oem_numbers, mp.cross_reference_numbers,
                b.id AS branch_id, b.name AS branch_name, b.city AS branch_city,
                i.quantity, i.shelf_section, i.shelf_number, i.shelf_level
         FROM matched_parts mp
         JOIN inventory i ON i.part_id = mp.id AND i.quantity > 0
         JOIN branches b ON b.id = i.branch_id AND b.organization_id = $1
         ORDER BY mp.name,
                  CASE WHEN b.id = $5::integer THEN 0 ELSE 1 END,
                  i.quantity DESC, b.name`,
        [
          req.user.organizationId,
          search.query,
          search.likeQuery,
          search.type,
          req.user.branchId ?? null,
        ]
      );

      const parts = groupBranchInventoryRows(result.rows, req.user.branchId);

      await recordSecurityEvent(pool, {
        req,
        organizationId: req.user.organizationId,
        userId: req.user.id,
        sessionId: req.user.sid,
        eventType: "branch_inventory_searched",
        outcome: "success",
        metadata: {
          search_type: search.type,
          query_hash: securityHash(`branch-inventory-query\n${search.query}`).slice(0, 24),
          result_count: parts.length,
        },
      });

      res.json({
        query: search.query,
        type: search.type,
        currentBranchId: req.user.branchId ?? null,
        count: parts.length,
        parts,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "branch_inventory_search_failed" });
    }
  }
);

router.get("/", requireRole("admin", "warehouse_keeper"), async (req, res) => {
  const columns = req.user.role === "warehouse_keeper" ? CUSTOMER_PART_COLUMNS : STAFF_PART_COLUMNS;
  const statusFilter = req.user.role === "warehouse_keeper"
    ? "AND p.catalog_status = 'active'"
    : "AND p.catalog_status <> 'archived'";
  if (req.user.role === "warehouse_keeper" && !req.user.branchId) {
    return res.status(403).json({ error: "employee_branch_required" });
  }
  const r = await pool.query(`SELECT ${columns} FROM parts p WHERE p.organization_id = $1 ${statusFilter} ORDER BY p.name`, [
    req.user.organizationId,
  ]);
  const employeeBranchFilter = req.user.role === "warehouse_keeper" ? "AND i.branch_id = $2" : "";
  const inventoryParams = req.user.role === "warehouse_keeper"
    ? [req.user.organizationId, req.user.branchId]
    : [req.user.organizationId];
  const inventory = await pool.query(
    `SELECT i.part_id, i.branch_id, i.quantity, i.min_quantity,
            i.shelf_section, i.shelf_number, i.shelf_level
     FROM inventory i
     JOIN parts p ON p.id = i.part_id
     JOIN branches b ON b.id = i.branch_id
     WHERE p.organization_id = $1 AND b.organization_id = $1 ${employeeBranchFilter}`,
    inventoryParams
  );
  const byPart = new Map();
  for (const row of inventory.rows) {
    if (!byPart.has(row.part_id)) byPart.set(row.part_id, []);
    byPart.get(row.part_id).push(row);
  }
  const visibleParts = r.rows.filter((part) => req.user.role !== "warehouse_keeper" || byPart.has(part.id));
  res.json(visibleParts.map((part) => ({ ...part, inventory: byPart.get(part.id) || [] })));
});

router.post("/import/preview", requireRole("admin"), async (req, res) => {
  const validation = validateImportRows(req.body.rows, req.body.mode);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const numbers = validation.validRows.map((row) => row.partNumber);
  const existing = numbers.length
    ? await pool.query(
        "SELECT part_number FROM parts WHERE organization_id = $1 AND part_number = ANY($2::text[])",
        [req.user.organizationId, numbers]
      )
    : { rows: [] };
  const found = new Set(existing.rows.map((row) => row.part_number));
  res.json({
    total: req.body.rows.length,
    valid: validation.validRows.length,
    invalid: validation.errors.length,
    existing: validation.validRows.filter((row) => found.has(row.partNumber)).length,
    new: validation.validRows.filter((row) => !found.has(row.partNumber)).length,
    errors: validation.errors.slice(0, 100),
  });
});

router.post("/import/commit", requireRole("admin"), async (req, res) => {
  const branchId = Number(req.body.branchId);
  const validation = validateImportRows(req.body.rows, req.body.mode);
  if (validation.error) return res.status(400).json({ error: validation.error });
  if (validation.errors.length) {
    return res.status(400).json({ error: "import_contains_invalid_rows", errors: validation.errors.slice(0, 100) });
  }
  if (!Number.isInteger(branchId)) return res.status(400).json({ error: "invalid_branch" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await branchBelongsToOrganization(client, branchId, req.user.organizationId))) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "branch_not_found" });
    }
    const runResult = await client.query(
      `INSERT INTO catalog_import_runs
       (organization_id, source, requested_by, branch_id, import_mode, status)
       VALUES ($1,'shop-csv',$2,$3,$4,'running') RETURNING id`,
      [req.user.organizationId, req.user.id, branchId, validation.mode]
    );
    const importRunId = runResult.rows[0].id;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of validation.validRows) {
      const found = await client.query(
        "SELECT id FROM parts WHERE organization_id = $1 AND part_number = $2 FOR UPDATE",
        [req.user.organizationId, row.partNumber]
      );
      let partId = found.rows[0]?.id;
      if (partId && validation.mode === "skip") {
        skipped += 1;
        continue;
      }
      if (!partId) {
        const created = await client.query(
          `INSERT INTO parts (organization_id, part_number, name, brand, category, barcode, price, cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [req.user.organizationId, row.partNumber, row.name, row.brand, row.category, row.barcode, row.price, row.cost]
        );
        partId = created.rows[0].id;
        inserted += 1;
      } else {
        await client.query(
          `UPDATE parts SET name=$1, brand=$2, category=$3, barcode=$4, price=$5, cost=$6
           WHERE id=$7 AND organization_id=$8`,
          [row.name, row.brand, row.category, row.barcode, row.price, row.cost, partId, req.user.organizationId]
        );
        updated += 1;
      }
      const inventoryBefore = await client.query(
        "SELECT quantity FROM inventory WHERE part_id = $1 AND branch_id = $2 FOR UPDATE",
        [partId, branchId]
      );
      const previousQuantity = Number(inventoryBefore.rows[0]?.quantity || 0);
      const quantitySql = validation.mode === "add" ? "inventory.quantity + EXCLUDED.quantity" : "EXCLUDED.quantity";
      const quantityChange = validation.mode === "add" ? row.quantity : row.quantity - previousQuantity;
      await client.query(
        `INSERT INTO inventory
         (part_id, branch_id, quantity, min_quantity, shelf_section, shelf_number, shelf_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (part_id, branch_id) DO UPDATE SET
           quantity = ${quantitySql}, min_quantity = EXCLUDED.min_quantity,
           shelf_section = EXCLUDED.shelf_section, shelf_number = EXCLUDED.shelf_number,
           shelf_level = EXCLUDED.shelf_level`,
        [partId, branchId, row.quantity, row.minQuantity, row.shelfSection, row.shelfNumber, row.shelfLevel]
      );
      if (quantityChange !== 0) {
        await client.query(
          `INSERT INTO inventory_movements
           (organization_id, branch_id, part_id, performed_by, movement_type, quantity_change, reference_type, reference_id, note)
           VALUES ($1,$2,$3,$4,'receipt',$5,'catalog_import',$6,'استيراد مخزون CSV')`,
          [req.user.organizationId, branchId, partId, req.user.id, quantityChange, String(importRunId)]
        );
      }
    }
    await client.query(
      `UPDATE catalog_import_runs SET status='completed', inserted_count=$1, updated_count=$2,
       skipped_count=$3, completed_at=now() WHERE id=$4`,
      [inserted, updated, skipped, importRunId]
    );
    await client.query("COMMIT");
    res.status(201).json({ ok: true, inserted, updated, skipped });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "inventory_import_failed" });
  } finally {
    client.release();
  }
});

/** Finds stock by its physical shelf label, scoped to this paired device's branch. */
router.get("/shelf-lookup", deviceRequired, async (req, res) => {
  if (!["admin", "seller", "warehouse_keeper"].includes(req.user.role)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const shelfCode = normalizeShelfLookup(req.query.code);
  if (!shelfCode) return res.status(400).json({ error: "invalid_shelf_code" });
  try {
    const result = await pool.query(
      `SELECT p.id, p.part_number, p.name, p.brand, p.barcode,
              i.quantity, i.min_quantity, i.shelf_section, i.shelf_number, i.shelf_level
       FROM inventory i
       JOIN parts p ON p.id = i.part_id
       WHERE p.organization_id = $1 AND i.branch_id = $2
         AND (
           upper(regexp_replace(coalesce(i.shelf_number,''), '\\s+', '', 'g')) = $3
           OR upper(regexp_replace(concat_ws('-', i.shelf_section, i.shelf_number), '\\s+', '', 'g')) = $3
         )
       ORDER BY p.name`,
      [req.user.organizationId, req.device.branch_id, shelfCode]
    );
    res.json({ shelfCode, branchId: req.device.branch_id, count: result.rows.length, parts: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "shelf_lookup_failed" });
  }
});

/** Unified warehouse lookup by shelf, part number, barcode, or part name. */
router.get("/warehouse-lookup", deviceRequired, async (req, res) => {
  if (!["admin", "seller", "warehouse_keeper"].includes(req.user.role)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const query = normalizeWarehouseLookup(req.query.q);
  if (!query) return res.status(400).json({ error: "invalid_lookup_query" });
  const shelfCode = normalizeShelfLookup(query);
  try {
    const result = await pool.query(
      `SELECT p.id, p.part_number, p.name, p.brand, p.barcode,
              i.quantity, i.min_quantity, i.shelf_section, i.shelf_number, i.shelf_level,
              CASE
                WHEN p.barcode = $3 THEN 'barcode'
                WHEN upper(p.part_number) = upper($3) THEN 'part_number'
                WHEN upper(regexp_replace(coalesce(i.shelf_number,''), '\\s+', '', 'g')) = $4
                  OR upper(regexp_replace(concat_ws('-', i.shelf_section, i.shelf_number), '\\s+', '', 'g')) = $4
                  THEN 'shelf'
                ELSE 'text'
              END AS match_type
       FROM inventory i
       JOIN parts p ON p.id = i.part_id
       WHERE p.organization_id = $1 AND i.branch_id = $2
         AND (
           p.barcode = $3
           OR p.part_number ILIKE '%' || $3 || '%'
           OR p.name ILIKE '%' || $3 || '%'
           OR upper(regexp_replace(coalesce(i.shelf_number,''), '\\s+', '', 'g')) = $4
           OR upper(regexp_replace(concat_ws('-', i.shelf_section, i.shelf_number), '\\s+', '', 'g')) = $4
         )
       ORDER BY
         CASE WHEN p.barcode = $3 OR upper(p.part_number) = upper($3) THEN 0 ELSE 1 END,
         p.name
       LIMIT 50`,
      [req.user.organizationId, req.device.branch_id, query, shelfCode]
    );
    res.json({ query, branchId: req.device.branch_id, count: result.rows.length, parts: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "warehouse_lookup_failed" });
  }
});

/** Low-stock dashboard for the paired device's branch. */
router.get("/warehouse-low-stock", deviceRequired, async (req, res) => {
  if (!["admin", "seller", "warehouse_keeper"].includes(req.user.role)) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const result = await pool.query(
      `SELECT p.id, p.part_number, p.name, p.brand, p.barcode,
              i.quantity, i.min_quantity, i.shelf_section, i.shelf_number, i.shelf_level
       FROM inventory i
       JOIN parts p ON p.id = i.part_id
       WHERE p.organization_id = $1 AND i.branch_id = $2
         AND i.quantity <= i.min_quantity
       ORDER BY (i.min_quantity - i.quantity) DESC, p.name
       LIMIT 100`,
      [req.user.organizationId, req.device.branch_id]
    );
    res.json({ branchId: req.device.branch_id, count: result.rows.length, parts: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "low_stock_lookup_failed" });
  }
});

/**
 * POST /api/parts
 * Lets a shop owner add a new part to THEIR OWN catalog from the dashboard —
 * no developer involvement needed. Catalog and direct stock mutations are
 * restricted to administrators; sellers only sell through paired POS flows.
 */
router.post("/", requireRole("admin"), async (req, res) => {
  const orgId = req.user.organizationId;
  const {
    partNumber,
    name,
    brand,
    category,
    price,
    cost,
    branchId,
    quantity,
    minQuantity,
    barcode,
    manufacturer,
    oemNumbers,
    crossReferenceNumbers,
    unit,
    qualityGrade,
    countryOfOrigin,
    warrantyMonths,
    catalogStatus,
  } = req.body;

  if (!partNumber || !name || price == null) {
    return res.status(400).json({ error: "missing_fields" });
  }

  if (!isNonNegativeMoney(price) || Number(price) <= 0 || !isNonNegativeMoney(cost ?? 0)) {
    return res.status(400).json({ error: "invalid_price" });
  }

  if (!isNonNegativeInteger(quantity ?? 0) || !isNonNegativeInteger(minQuantity ?? 5)) {
    return res.status(400).json({ error: "invalid_quantity" });
  }

  if (catalogStatus != null && !["draft", "active", "archived"].includes(catalogStatus)) {
    return res.status(400).json({ error: "invalid_catalog_status" });
  }

  const normalizedOemNumbers = normalizeCatalogCodes(oemNumbers);
  const normalizedCrossReferences = normalizeCatalogCodes(crossReferenceNumbers);
  const normalizedBarcode = normalizeCatalogText(barcode, 120);
  const normalizedManufacturer = normalizeCatalogText(manufacturer, 120);
  const normalizedUnit = normalizeCatalogText(unit, 40);
  const normalizedQualityGrade = normalizeCatalogText(qualityGrade, 60);
  const normalizedCountryOfOrigin = normalizeCatalogText(countryOfOrigin, 100);

  if (oemNumbers != null && normalizedOemNumbers === null) {
    return res.status(400).json({ error: "invalid_oem_numbers" });
  }

  if (crossReferenceNumbers != null && normalizedCrossReferences === null) {
    return res.status(400).json({ error: "invalid_cross_reference_numbers" });
  }

  if (barcode != null && normalizedBarcode === null && String(barcode).trim().length > 120) {
    return res.status(400).json({ error: "invalid_barcode" });
  }

  if (
    manufacturer != null &&
    normalizedManufacturer === null &&
    String(manufacturer).trim().length > 120
  ) {
    return res.status(400).json({ error: "invalid_manufacturer" });
  }

  if (unit != null && normalizedUnit === null && String(unit).trim().length > 40) {
    return res.status(400).json({ error: "invalid_unit" });
  }

  if (
    qualityGrade != null &&
    normalizedQualityGrade === null &&
    String(qualityGrade).trim().length > 60
  ) {
    return res.status(400).json({ error: "invalid_quality_grade" });
  }

  if (
    countryOfOrigin != null &&
    normalizedCountryOfOrigin === null &&
    String(countryOfOrigin).trim().length > 100
  ) {
    return res.status(400).json({ error: "invalid_country_of_origin" });
  }

  if (
    warrantyMonths != null &&
    (!Number.isInteger(Number(warrantyMonths)) ||
      Number(warrantyMonths) < 0 ||
      Number(warrantyMonths) > 240)
  ) {
    return res.status(400).json({ error: "invalid_warranty_months" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (branchId && !(await branchBelongsToOrganization(client, branchId, orgId))) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "branch_not_found" });
    }
    const partRes = await client.query(
      `INSERT INTO parts (
         organization_id,
         part_number,
         name,
         brand,
         category,
         price,
         cost,
         barcode,
         manufacturer,
         oem_numbers,
         cross_reference_numbers,
         unit,
         quality_grade,
         country_of_origin,
         warranty_months,
         catalog_status
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11::text[],
         $12,$13,$14,$15,$16
       )
       RETURNING *`,
      [
        orgId,
        String(partNumber).trim(),
        String(name).trim(),
        brand ? String(brand).trim() : null,
        category ? String(category).trim() : null,
        price,
        cost ?? 0,
        normalizedBarcode,
        normalizedManufacturer,
        normalizedOemNumbers ?? [],
        normalizedCrossReferences ?? [],
        normalizedUnit,
        normalizedQualityGrade,
        normalizedCountryOfOrigin,
        warrantyMonths == null || warrantyMonths === "" ? null : Number(warrantyMonths),
        catalogStatus || "active",
      ]
    );
    const part = partRes.rows[0];

    if (branchId) {
      await client.query(
        `INSERT INTO inventory (part_id, branch_id, quantity, min_quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (part_id, branch_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [part.id, branchId, quantity ?? 0, minQuantity ?? 5]
      );
      if (Number(quantity || 0) > 0) {
        await client.query(
          `INSERT INTO inventory_movements
           (organization_id, branch_id, part_id, performed_by, movement_type, quantity_change, reference_type, reference_id, note)
           VALUES ($1,$2,$3,$4,'receipt',$5,'part_creation',$6,'رصيد افتتاحي عند إنشاء القطعة')`,
          [orgId, branchId, part.id, req.user.id, Number(quantity), String(part.id)]
        );
      }
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
router.put("/:id", requireRole("admin"), async (req, res) => {
  const {
    name,
    brand,
    category,
    price,
    cost,
    barcode,
    manufacturer,
    oemNumbers,
    crossReferenceNumbers,
    unit,
    qualityGrade,
    countryOfOrigin,
    warrantyMonths,
    catalogStatus,
  } = req.body;

  if ((price != null && !isNonNegativeMoney(price)) || (cost != null && !isNonNegativeMoney(cost))) {
    return res.status(400).json({ error: "invalid_price" });
  }

  if (catalogStatus != null && !["draft", "active", "archived"].includes(catalogStatus)) {
    return res.status(400).json({ error: "invalid_catalog_status" });
  }

  const normalizedOemNumbers = normalizeCatalogCodes(oemNumbers);
  const normalizedCrossReferences = normalizeCatalogCodes(crossReferenceNumbers);
  const normalizedUnit = normalizeCatalogText(unit, 40);
  const normalizedQualityGrade = normalizeCatalogText(qualityGrade, 60);
  const normalizedCountryOfOrigin = normalizeCatalogText(countryOfOrigin, 100);

  if (oemNumbers != null && normalizedOemNumbers === null) {
    return res.status(400).json({ error: "invalid_oem_numbers" });
  }

  if (crossReferenceNumbers != null && normalizedCrossReferences === null) {
    return res.status(400).json({ error: "invalid_cross_reference_numbers" });
  }

  if (unit != null && normalizedUnit === null && String(unit).trim().length > 40) {
    return res.status(400).json({ error: "invalid_unit" });
  }

  if (qualityGrade != null && normalizedQualityGrade === null && String(qualityGrade).trim().length > 60) {
    return res.status(400).json({ error: "invalid_quality_grade" });
  }

  if (
    countryOfOrigin != null &&
    normalizedCountryOfOrigin === null &&
    String(countryOfOrigin).trim().length > 100
  ) {
    return res.status(400).json({ error: "invalid_country_of_origin" });
  }

  if (
    warrantyMonths != null &&
    (!Number.isInteger(Number(warrantyMonths)) ||
      Number(warrantyMonths) < 0 ||
      Number(warrantyMonths) > 240)
  ) {
    return res.status(400).json({ error: "invalid_warranty_months" });
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
       barcode = CASE WHEN $6::boolean THEN $7 ELSE barcode END,
       manufacturer = CASE WHEN $8::boolean THEN $9 ELSE manufacturer END,
       oem_numbers = COALESCE($10::text[], oem_numbers),
       cross_reference_numbers = COALESCE($11::text[], cross_reference_numbers),
       unit = CASE WHEN $12::boolean THEN $13 ELSE unit END,
       quality_grade = CASE WHEN $14::boolean THEN $15 ELSE quality_grade END,
       country_of_origin = CASE WHEN $16::boolean THEN $17 ELSE country_of_origin END,
       warranty_months = CASE WHEN $18::boolean THEN $19 ELSE warranty_months END,
       catalog_status = COALESCE($20, catalog_status)
     WHERE id = $21
       AND organization_id = $22
     RETURNING *`,
    [
      name,
      brand,
      category,
      price,
      cost,
      barcode !== undefined,
      barcode == null ? null : String(barcode).trim() || null,
      manufacturer !== undefined,
      manufacturer == null ? null : String(manufacturer).trim() || null,
      normalizedOemNumbers,
      normalizedCrossReferences,
      unit !== undefined,
      normalizedUnit,
      qualityGrade !== undefined,
      normalizedQualityGrade,
      countryOfOrigin !== undefined,
      normalizedCountryOfOrigin,
      warrantyMonths !== undefined,
      warrantyMonths == null || warrantyMonths === "" ? null : Number(warrantyMonths),
      catalogStatus,
      req.params.id,
      req.user.organizationId,
    ]
  );

  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });

  res.json(r.rows[0]);
});

/** DELETE /api/parts/:id — archives instead of destroying invoice history. */
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const r = await pool.query(
    "UPDATE parts SET catalog_status = 'archived' WHERE id = $1 AND organization_id = $2 RETURNING id",
    [req.params.id, req.user.organizationId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true, archived: true });
});

/**
 * PUT /api/parts/:id/inventory — set stock quantity + shelf location at a branch.
 * Used by the "monitor inventory" screen; upserts so the owner can set stock
 * for a branch that has no inventory row yet.
 */
router.put("/:id/inventory", requireRole("admin"), async (req, res) => {
  const { branchId, quantity, minQuantity, shelfSection, shelfNumber, shelfLevel } = req.body;
  if (!branchId) return res.status(400).json({ error: "missing_branchId" });
  if (!isNonNegativeInteger(quantity ?? 0) || (minQuantity != null && !isNonNegativeInteger(minQuantity))) {
    return res.status(400).json({ error: "invalid_quantity" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owns = await client.query(
      `SELECT p.id FROM parts p WHERE p.id = $1 AND p.organization_id = $2 FOR UPDATE`,
      [req.params.id, req.user.organizationId]
    );
    if (!owns.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (!(await branchBelongsToOrganization(client, branchId, req.user.organizationId))) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "branch_not_found" });
    }
    const before = await client.query(
      "SELECT quantity FROM inventory WHERE part_id = $1 AND branch_id = $2 FOR UPDATE",
      [req.params.id, branchId]
    );
    const previousQuantity = Number(before.rows[0]?.quantity || 0);
    const nextQuantity = Number(quantity ?? 0);
    const nextMinQuantity = minQuantity == null ? null : Number(minQuantity);
    const r = await client.query(
      `INSERT INTO inventory (part_id, branch_id, quantity, min_quantity, shelf_section, shelf_number, shelf_level)
       VALUES ($1,$2,$3,COALESCE($4,5),$5,$6,$7)
       ON CONFLICT (part_id, branch_id) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         min_quantity = CASE WHEN $4::integer IS NULL THEN inventory.min_quantity ELSE EXCLUDED.min_quantity END,
         shelf_section = COALESCE(EXCLUDED.shelf_section, inventory.shelf_section),
         shelf_number = COALESCE(EXCLUDED.shelf_number, inventory.shelf_number),
         shelf_level = COALESCE(EXCLUDED.shelf_level, inventory.shelf_level)
       RETURNING *`,
      [req.params.id, branchId, nextQuantity, nextMinQuantity, shelfSection || null, shelfNumber || null, shelfLevel || null]
    );
    const quantityChange = nextQuantity - previousQuantity;
    if (quantityChange !== 0) {
      await client.query(
        `INSERT INTO inventory_movements
         (organization_id, branch_id, part_id, performed_by, movement_type, quantity_change, reference_type, reference_id, note)
         VALUES ($1,$2,$3,$4,'adjustment',$5,'manual_inventory_adjustment',$6,'تعديل يدوي بواسطة المدير')`,
        [req.user.organizationId, branchId, req.params.id, req.user.id, quantityChange, String(req.params.id)]
      );
    }
    await client.query("COMMIT");
    res.json(r.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "inventory_update_failed" });
  } finally {
    client.release();
  }
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
