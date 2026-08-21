import crypto from "crypto";
import { pool } from "../db/pool.js";
import { createSafeRouter } from "../utils/safe-router.js";
import { requireRole } from "./auth.js";
import { deviceRequired } from "./devices.js";

const router = createSafeRouter();
const MAX_ORDER_LINES = 200;

function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

export function normalizeSupplierPayload(body = {}) {
  const name = cleanText(body.name, 200);
  const vatNumber = cleanText(body.vatNumber, 15).replace(/\s/g, "");
  const phone = cleanText(body.phone, 40);
  const email = cleanText(body.email, 254).toLowerCase();
  const paymentTermsDays = body.paymentTermsDays === "" || body.paymentTermsDays == null
    ? 0
    : Number(body.paymentTermsDays);
  const status = body.status == null ? "active" : String(body.status);
  const errors = [];
  if (!name) errors.push("supplier_name_required");
  if (vatNumber && !/^\d{15}$/.test(vatNumber)) errors.push("invalid_vat_number");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid_email");
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) {
    errors.push("invalid_payment_terms");
  }
  if (!["active", "inactive"].includes(status)) errors.push("invalid_supplier_status");
  return {
    errors,
    value: {
      name,
      vatNumber: vatNumber || null,
      phone: phone || null,
      email: email || null,
      paymentTermsDays,
      status,
    },
  };
}

export function validatePurchaseOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_LINES) {
    return { error: "invalid_purchase_order_items", items: [] };
  }
  const seen = new Set();
  const normalized = [];
  for (const raw of items) {
    const partId = Number(raw?.partId);
    const quantity = Number(raw?.quantity);
    const unitCost = Number(raw?.unitCost);
    if (
      !Number.isInteger(partId) || partId <= 0 ||
      !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000 ||
      !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 100_000_000 ||
      seen.has(partId)
    ) {
      return { error: "invalid_purchase_order_items", items: [] };
    }
    seen.add(partId);
    normalized.push({ partId, quantity, unitCost: Math.round(unitCost * 100) / 100 });
  }
  return { items: normalized };
}

export function validateReceiptItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_LINES) {
    return { error: "invalid_receipt_items", items: [] };
  }
  const seen = new Set();
  const normalized = [];
  for (const raw of items) {
    const purchaseOrderItemId = Number(raw?.purchaseOrderItemId);
    const quantity = Number(raw?.quantity);
    if (
      !Number.isInteger(purchaseOrderItemId) || purchaseOrderItemId <= 0 ||
      !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000 ||
      seen.has(purchaseOrderItemId)
    ) {
      return { error: "invalid_receipt_items", items: [] };
    }
    seen.add(purchaseOrderItemId);
    normalized.push({ purchaseOrderItemId, quantity });
  }
  return { items: normalized };
}

export function weightedAverageCost(currentQuantity, currentCost, receivedQuantity, receivedCost) {
  const oldQuantity = Math.max(0, Number(currentQuantity) || 0);
  const incomingQuantity = Math.max(0, Number(receivedQuantity) || 0);
  if (!incomingQuantity) return Math.round((Number(currentCost) || 0) * 100) / 100;
  const totalQuantity = oldQuantity + incomingQuantity;
  const totalValue = oldQuantity * (Number(currentCost) || 0) + incomingQuantity * Number(receivedCost);
  return Math.round((totalValue / totalQuantity) * 100) / 100;
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isReceiptReference(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

export function purchaseReceiptRequestHash(orderId, items) {
  const canonicalItems = [...items]
    .map((item) => ({
      purchaseOrderItemId: Number(item.purchaseOrderItemId),
      quantity: Number(item.quantity),
    }))
    .sort((left, right) => left.purchaseOrderItemId - right.purchaseOrderItemId);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ orderId: Number(orderId), items: canonicalItems }))
    .digest("hex");
}

router.get("/suppliers", requireRole("admin", "warehouse_keeper"), async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, vat_number, phone, email, payment_terms_days, status
     FROM suppliers WHERE organization_id = $1 ORDER BY status, name`,
    [req.user.organizationId]
  );
  res.json(result.rows);
});

router.post("/suppliers", requireRole("admin"), async (req, res) => {
  const normalized = normalizeSupplierPayload(req.body);
  if (normalized.errors.length) {
    return res.status(400).json({ error: "invalid_supplier", details: normalized.errors });
  }
  const value = normalized.value;
  try {
    const existing = await pool.query(
      "SELECT id FROM suppliers WHERE organization_id = $1 AND lower(name) = lower($2)",
      [req.user.organizationId, value.name]
    );
    if (existing.rows[0]) return res.status(409).json({ error: "supplier_name_exists" });
    const result = await pool.query(
      `INSERT INTO suppliers
       (organization_id, name, vat_number, phone, email, payment_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, vat_number, phone, email, payment_terms_days, status`,
      [req.user.organizationId, value.name, value.vatNumber, value.phone, value.email, value.paymentTermsDays]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "supplier_name_exists" });
    console.error(error);
    res.status(500).json({ error: "supplier_create_failed" });
  }
});

router.put("/suppliers/:id", requireRole("admin"), async (req, res) => {
  const supplierId = Number(req.params.id);
  const normalized = normalizeSupplierPayload(req.body);
  if (!Number.isInteger(supplierId) || normalized.errors.length) {
    return res.status(400).json({ error: "invalid_supplier", details: normalized.errors });
  }
  const value = normalized.value;
  try {
    const result = await pool.query(
      `UPDATE suppliers SET name = $1, vat_number = $2, phone = $3, email = $4,
                            payment_terms_days = $5, status = $6
       WHERE id = $7 AND organization_id = $8
       RETURNING id, name, vat_number, phone, email, payment_terms_days, status`,
      [
        value.name, value.vatNumber, value.phone, value.email, value.paymentTermsDays,
        value.status, supplierId, req.user.organizationId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "supplier_not_found" });
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "supplier_name_exists" });
    console.error(error);
    res.status(500).json({ error: "supplier_update_failed" });
  }
});

router.get("/purchase-orders", requireRole("admin", "warehouse_keeper"), async (req, res) => {
  const branchFilter = req.user.role === "warehouse_keeper" ? "AND po.branch_id = $2" : "";
  const params = req.user.role === "warehouse_keeper"
    ? [req.user.organizationId, req.user.branchId]
    : [req.user.organizationId];
  if (req.user.role === "warehouse_keeper" && !req.user.branchId) {
    return res.status(403).json({ error: "employee_branch_required" });
  }
  const result = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.currency, po.expected_at, po.notes,
            po.created_at, po.approved_at, po.branch_id, b.name AS branch_name,
            s.id AS supplier_id, s.name AS supplier_name,
            creator.name AS created_by_name, approver.name AS approved_by_name,
            COALESCE(SUM(poi.ordered_quantity * poi.unit_cost), 0) AS subtotal,
            COALESCE(json_agg(json_build_object(
              'id', poi.id, 'partId', p.id, 'partNumber', p.part_number,
              'partName', p.name, 'orderedQuantity', poi.ordered_quantity,
              'receivedQuantity', poi.received_quantity, 'unitCost', poi.unit_cost
            ) ORDER BY poi.id) FILTER (WHERE poi.id IS NOT NULL), '[]') AS items
     FROM purchase_orders po
     JOIN branches b ON b.id = po.branch_id AND b.organization_id = po.organization_id
     JOIN suppliers s ON s.id = po.supplier_id AND s.organization_id = po.organization_id
     JOIN users creator ON creator.id = po.created_by AND creator.organization_id = po.organization_id
     LEFT JOIN users approver ON approver.id = po.approved_by AND approver.organization_id = po.organization_id
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     LEFT JOIN parts p ON p.id = poi.part_id AND p.organization_id = po.organization_id
     WHERE po.organization_id = $1 ${branchFilter}
     GROUP BY po.id, b.name, s.id, s.name, creator.name, approver.name
     ORDER BY po.created_at DESC LIMIT 200`,
    params
  );
  res.json(result.rows);
});

router.post("/purchase-orders", requireRole("admin"), async (req, res) => {
  const supplierId = Number(req.body?.supplierId);
  const branchId = Number(req.body?.branchId);
  const expectedAt = cleanText(req.body?.expectedAt, 10) || null;
  const notes = cleanText(req.body?.notes, 1000) || null;
  const validated = validatePurchaseOrderItems(req.body?.items);
  if (
    !Number.isInteger(supplierId) || !Number.isInteger(branchId) || validated.error ||
    (expectedAt && !isIsoDate(expectedAt))
  ) {
    return res.status(400).json({ error: validated.error || "invalid_purchase_order" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const supplier = await client.query(
      "SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND status = 'active'",
      [supplierId, req.user.organizationId]
    );
    const branch = await client.query(
      "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
      [branchId, req.user.organizationId]
    );
    const partIds = validated.items.map((item) => item.partId);
    const parts = await client.query(
      `SELECT id FROM parts
       WHERE organization_id = $1 AND id = ANY($2::integer[]) AND catalog_status <> 'archived'`,
      [req.user.organizationId, partIds]
    );
    if (!supplier.rows[0] || !branch.rows[0] || parts.rows.length !== partIds.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "procurement_reference_not_found" });
    }
    const poNumber = `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const order = await client.query(
      `INSERT INTO purchase_orders
       (organization_id, supplier_id, branch_id, po_number, expected_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, po_number, status, currency, expected_at, notes, created_at`,
      [req.user.organizationId, supplierId, branchId, poNumber, expectedAt, notes, req.user.id]
    );
    for (const item of validated.items) {
      await client.query(
        `INSERT INTO purchase_order_items
         (purchase_order_id, part_id, ordered_quantity, unit_cost)
         VALUES ($1,$2,$3,$4)`,
        [order.rows[0].id, item.partId, item.quantity, item.unitCost]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ ...order.rows[0], items: validated.items });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    res.status(500).json({ error: "purchase_order_create_failed" });
  } finally {
    client.release();
  }
});

router.post("/purchase-orders/:id/approve", requireRole("admin"), async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) return res.status(400).json({ error: "invalid_purchase_order" });
  const result = await pool.query(
    `UPDATE purchase_orders
     SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now()
     WHERE id = $2 AND organization_id = $3 AND status = 'draft'
     RETURNING id, po_number, status, approved_at`,
    [req.user.id, orderId, req.user.organizationId]
  );
  if (!result.rows[0]) return res.status(409).json({ error: "purchase_order_not_approvable" });
  res.json(result.rows[0]);
});

router.post("/purchase-orders/:id/cancel", requireRole("admin"), async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) return res.status(400).json({ error: "invalid_purchase_order" });
  const result = await pool.query(
    `UPDATE purchase_orders SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status IN ('draft','approved')
     RETURNING id, po_number, status`,
    [orderId, req.user.organizationId]
  );
  if (!result.rows[0]) return res.status(409).json({ error: "purchase_order_not_cancellable" });
  res.json(result.rows[0]);
});

router.post(
  "/purchase-orders/:id/receipts",
  requireRole("admin", "warehouse_keeper"),
  deviceRequired,
  async (req, res) => {
    const orderId = Number(req.params.id);
    const receiptReference = String(req.body?.receiptReference || "").toLowerCase();
    const note = cleanText(req.body?.note, 500) || null;
    const validated = validateReceiptItems(req.body?.items);
    if (!Number.isInteger(orderId) || !isReceiptReference(receiptReference) || validated.error) {
      return res.status(400).json({ error: validated.error || "invalid_purchase_receipt" });
    }
    const receiptItems = [...validated.items].sort(
      (left, right) => left.purchaseOrderItemId - right.purchaseOrderItemId
    );
    const requestHash = purchaseReceiptRequestHash(orderId, receiptItems);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `rakaez:purchase-receipt:${req.user.organizationId}:${receiptReference}`,
      ]);
      const existing = await client.query(
        `SELECT id, purchase_order_id, request_hash FROM purchase_receipts
         WHERE organization_id = $1 AND receipt_reference = $2`,
        [req.user.organizationId, receiptReference]
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        if (
          Number(existing.rows[0].purchase_order_id) !== orderId ||
          existing.rows[0].request_hash !== requestHash
        ) {
          return res.status(409).json({ error: "receipt_reference_conflict" });
        }
        return res.json({ ok: true, idempotent: true, receiptId: existing.rows[0].id });
      }

      const orderResult = await client.query(
        `SELECT id, po_number, branch_id, supplier_id, status
         FROM purchase_orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [orderId, req.user.organizationId]
      );
      const order = orderResult.rows[0];
      if (!order) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "purchase_order_not_found" });
      }
      if (!["approved", "partially_received"].includes(order.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "purchase_order_not_receivable" });
      }
      if (Number(order.branch_id) !== Number(req.device.branch_id)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "device_branch_mismatch" });
      }

      const requestedIds = receiptItems.map((item) => item.purchaseOrderItemId);
      const orderItems = await client.query(
        `SELECT poi.id, poi.part_id, poi.ordered_quantity, poi.received_quantity, poi.unit_cost,
                p.cost AS current_cost
         FROM purchase_order_items poi
         JOIN parts p ON p.id = poi.part_id
         WHERE poi.purchase_order_id = $1 AND poi.id = ANY($2::bigint[])
           AND p.organization_id = $3
         FOR UPDATE OF poi, p`,
        [orderId, requestedIds, req.user.organizationId]
      );
      if (orderItems.rows.length !== requestedIds.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "purchase_order_item_not_found" });
      }
      const byId = new Map(orderItems.rows.map((item) => [Number(item.id), item]));
      for (const requested of receiptItems) {
        const item = byId.get(requested.purchaseOrderItemId);
        if (requested.quantity > Number(item.ordered_quantity) - Number(item.received_quantity)) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "receipt_quantity_exceeds_remaining" });
        }
      }

      const receipt = await client.query(
        `INSERT INTO purchase_receipts
         (organization_id, purchase_order_id, branch_id, receipt_reference, request_hash, received_by, device_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, receipt_reference, created_at`,
        [
          req.user.organizationId, orderId, order.branch_id, receiptReference, requestHash,
          req.user.id, req.device.id, note,
        ]
      );

      for (const requested of receiptItems) {
        const item = byId.get(requested.purchaseOrderItemId);
        const inventoryRows = await client.query(
          "SELECT quantity FROM inventory WHERE part_id = $1 FOR UPDATE",
          [item.part_id]
        );
        const currentTotalQuantity = inventoryRows.rows.reduce((sum, row) => sum + Number(row.quantity), 0);
        const nextCost = weightedAverageCost(
          currentTotalQuantity,
          item.current_cost,
          requested.quantity,
          item.unit_cost
        );
        await client.query(
          `INSERT INTO inventory (part_id, branch_id, quantity)
           VALUES ($1,$2,$3)
           ON CONFLICT (part_id, branch_id) DO UPDATE
           SET quantity = inventory.quantity + EXCLUDED.quantity`,
          [item.part_id, order.branch_id, requested.quantity]
        );
        await client.query("UPDATE parts SET cost = $1 WHERE id = $2 AND organization_id = $3", [
          nextCost, item.part_id, req.user.organizationId,
        ]);
        await client.query(
          `UPDATE purchase_order_items
           SET received_quantity = received_quantity + $1 WHERE id = $2`,
          [requested.quantity, item.id]
        );
        await client.query(
          `INSERT INTO purchase_receipt_items
           (purchase_receipt_id, purchase_order_item_id, part_id, quantity, unit_cost)
           VALUES ($1,$2,$3,$4,$5)`,
          [receipt.rows[0].id, item.id, item.part_id, requested.quantity, item.unit_cost]
        );
        await client.query(
          `INSERT INTO inventory_movements
           (organization_id, branch_id, part_id, device_id, performed_by, movement_type,
            quantity_change, reference_type, reference_id, note)
           VALUES ($1,$2,$3,$4,$5,'receipt',$6,'purchase_receipt',$7,$8)`,
          [
            req.user.organizationId, order.branch_id, item.part_id, req.device.id, req.user.id,
            requested.quantity, String(receipt.rows[0].id), `استلام ${order.po_number}`,
          ]
        );
        await client.query(
          `INSERT INTO part_suppliers (part_id, supplier_id, purchase_price)
           VALUES ($1,$2,$3)
           ON CONFLICT (part_id, supplier_id) DO UPDATE
           SET purchase_price = EXCLUDED.purchase_price`,
          [item.part_id, order.supplier_id, item.unit_cost]
        );
      }

      const remaining = await client.query(
        `SELECT COUNT(*)::integer AS count FROM purchase_order_items
         WHERE purchase_order_id = $1 AND received_quantity < ordered_quantity`,
        [orderId]
      );
      const nextStatus = Number(remaining.rows[0].count) === 0 ? "received" : "partially_received";
      await client.query(
        "UPDATE purchase_orders SET status = $1, updated_at = now() WHERE id = $2",
        [nextStatus, orderId]
      );
      await client.query("COMMIT");
      res.status(201).json({
        ok: true,
        receiptId: receipt.rows[0].id,
        receiptReference: receipt.rows[0].receipt_reference,
        purchaseOrderStatus: nextStatus,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(error);
      res.status(500).json({ error: "purchase_receipt_failed" });
    } finally {
      client.release();
    }
  }
);

export default router;
