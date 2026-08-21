import crypto from "crypto";
import { pool } from "../db/pool.js";
import { createSafeRouter } from "../utils/safe-router.js";
import { requireRole } from "./auth.js";
import { deviceRequired } from "./devices.js";

const router = createSafeRouter();
const MAX_TRANSFER_LINES = 200;

function cleanText(value, maxLength = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

export function validateTransferItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_TRANSFER_LINES) {
    return { error: "invalid_transfer_items", items: [] };
  }
  const seen = new Set();
  const normalized = [];
  for (const raw of items) {
    const partId = Number(raw?.partId);
    const quantity = Number(raw?.quantity);
    if (
      !Number.isInteger(partId) || partId <= 0 ||
      !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000 ||
      seen.has(partId)
    ) {
      return { error: "invalid_transfer_items", items: [] };
    }
    seen.add(partId);
    normalized.push({ partId, quantity });
  }
  return { items: normalized };
}

export function validateTransferReceiptItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_TRANSFER_LINES) {
    return { error: "invalid_transfer_receipt_items", items: [] };
  }
  const seen = new Set();
  const normalized = [];
  for (const raw of items) {
    const transferItemId = Number(raw?.transferItemId);
    const receivedQuantity = Number(raw?.receivedQuantity);
    const damagedQuantity = raw?.damagedQuantity == null || raw.damagedQuantity === ""
      ? 0
      : Number(raw.damagedQuantity);
    if (
      !Number.isInteger(transferItemId) || transferItemId <= 0 ||
      !Number.isInteger(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > 1_000_000 ||
      !Number.isInteger(damagedQuantity) || damagedQuantity < 0 || damagedQuantity > 1_000_000 ||
      seen.has(transferItemId)
    ) {
      return { error: "invalid_transfer_receipt_items", items: [] };
    }
    seen.add(transferItemId);
    normalized.push({ transferItemId, receivedQuantity, damagedQuantity });
  }
  return { items: normalized };
}

export function inventoryTransferRequestHash(sourceBranchId, destinationBranchId, items, notes = "") {
  const canonicalItems = [...items]
    .map((item) => ({ partId: Number(item.partId), quantity: Number(item.quantity) }))
    .sort((left, right) => left.partId - right.partId);
  return crypto.createHash("sha256").update(JSON.stringify({
    sourceBranchId: Number(sourceBranchId),
    destinationBranchId: Number(destinationBranchId),
    items: canonicalItems, notes: String(notes || ""),
  })).digest("hex");
}

export function inventoryTransferReceiptHash(transferId, items, receiptNote = "") {
  const canonicalItems = [...items]
    .map((item) => ({
      transferItemId: Number(item.transferItemId),
      receivedQuantity: Number(item.receivedQuantity),
      damagedQuantity: Number(item.damagedQuantity),
    }))
    .sort((left, right) => left.transferItemId - right.transferItemId);
  return crypto.createHash("sha256").update(JSON.stringify({
    transferId: Number(transferId), items: canonicalItems, receiptNote: String(receiptNote || ""),
  })).digest("hex");
}

async function loadTransfer(client, transferId, organizationId, lock = false) {
  if (lock) {
    const locked = await client.query(
      `SELECT id FROM inventory_transfers
       WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [transferId, organizationId]
    );
    if (!locked.rows[0]) return null;
  }
  const result = await client.query(
    `SELECT t.*, source.name AS source_branch_name, destination.name AS destination_branch_name,
            COALESCE(json_agg(json_build_object(
              'id', ti.id, 'partId', p.id, 'partNumber', p.part_number, 'partName', p.name,
              'requestedQuantity', ti.requested_quantity, 'shippedQuantity', ti.shipped_quantity,
              'receivedQuantity', ti.received_quantity, 'damagedQuantity', ti.damaged_quantity
            ) ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]') AS items
     FROM inventory_transfers t
     JOIN branches source ON source.id = t.source_branch_id AND source.organization_id = t.organization_id
     JOIN branches destination ON destination.id = t.destination_branch_id AND destination.organization_id = t.organization_id
     LEFT JOIN inventory_transfer_items ti ON ti.inventory_transfer_id = t.id
     LEFT JOIN parts p ON p.id = ti.part_id AND p.organization_id = t.organization_id
     WHERE t.id = $1 AND t.organization_id = $2
     GROUP BY t.id, source.name, destination.name`,
    [transferId, organizationId]
  );
  return result.rows[0];
}

router.get("/", requireRole("admin", "warehouse_keeper"), async (req, res) => {
  if (req.user.role === "warehouse_keeper" && !req.user.branchId) {
    return res.status(403).json({ error: "employee_branch_required" });
  }
  const branchFilter = req.user.role === "warehouse_keeper"
    ? "AND (t.source_branch_id = $2 OR t.destination_branch_id = $2)"
    : "";
  const params = req.user.role === "warehouse_keeper"
    ? [req.user.organizationId, req.user.branchId]
    : [req.user.organizationId];
  const result = await pool.query(
    `SELECT t.id, t.transfer_number, t.source_branch_id, t.destination_branch_id, t.status,
            t.notes, t.created_at, t.shipped_at, t.received_at,
            source.name AS source_branch_name, destination.name AS destination_branch_name,
            creator.name AS created_by_name, shipper.name AS shipped_by_name, receiver.name AS received_by_name,
            COALESCE(json_agg(json_build_object(
              'id', ti.id, 'partId', p.id, 'partNumber', p.part_number, 'partName', p.name,
              'requestedQuantity', ti.requested_quantity, 'shippedQuantity', ti.shipped_quantity,
              'receivedQuantity', ti.received_quantity, 'damagedQuantity', ti.damaged_quantity
            ) ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]') AS items
     FROM inventory_transfers t
     JOIN branches source ON source.id = t.source_branch_id AND source.organization_id = t.organization_id
     JOIN branches destination ON destination.id = t.destination_branch_id AND destination.organization_id = t.organization_id
     JOIN users creator ON creator.id = t.created_by AND creator.organization_id = t.organization_id
     LEFT JOIN users shipper ON shipper.id = t.shipped_by AND shipper.organization_id = t.organization_id
     LEFT JOIN users receiver ON receiver.id = t.received_by AND receiver.organization_id = t.organization_id
     LEFT JOIN inventory_transfer_items ti ON ti.inventory_transfer_id = t.id
     LEFT JOIN parts p ON p.id = ti.part_id AND p.organization_id = t.organization_id
     WHERE t.organization_id = $1 ${branchFilter}
     GROUP BY t.id, source.name, destination.name, creator.name, shipper.name, receiver.name
     ORDER BY t.created_at DESC LIMIT 200`,
    params
  );
  res.json(result.rows);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const sourceBranchId = Number(req.body?.sourceBranchId);
  const destinationBranchId = Number(req.body?.destinationBranchId);
  const requestReference = String(req.body?.requestReference || "");
  const notes = cleanText(req.body?.notes) || null;
  const validated = validateTransferItems(req.body?.items);
  if (
    !Number.isInteger(sourceBranchId) || !Number.isInteger(destinationBranchId) ||
    sourceBranchId === destinationBranchId || !isUuid(requestReference) || validated.error
  ) {
    return res.status(400).json({ error: validated.error || "invalid_inventory_transfer" });
  }
  const requestHash = inventoryTransferRequestHash(sourceBranchId, destinationBranchId, validated.items, notes);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(731954203, $1)", [req.user.organizationId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`transfer-request:${req.user.organizationId}:${requestReference}`]);
    const duplicate = await client.query(
      `SELECT id, request_hash FROM inventory_transfers
       WHERE organization_id = $1 AND request_reference = $2`,
      [req.user.organizationId, requestReference]
    );
    if (duplicate.rows[0]) {
      await client.query("ROLLBACK");
      if (duplicate.rows[0].request_hash !== requestHash) {
        return res.status(409).json({ error: "transfer_reference_payload_mismatch" });
      }
      return res.status(200).json({ id: duplicate.rows[0].id, duplicate: true });
    }
    const branches = await client.query(
      `SELECT id FROM branches
       WHERE organization_id = $1 AND id = ANY($2::int[])`,
      [req.user.organizationId, [sourceBranchId, destinationBranchId]]
    );
    const partIds = validated.items.map((item) => item.partId);
    const parts = await client.query(
      "SELECT id FROM parts WHERE organization_id = $1 AND id = ANY($2::int[]) AND catalog_status = 'active'",
      [req.user.organizationId, partIds]
    );
    if (branches.rows.length !== 2 || parts.rows.length !== partIds.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "transfer_reference_not_found" });
    }
    const sequence = await client.query(
      "SELECT COUNT(*)::integer + 1 AS next_number FROM inventory_transfers WHERE organization_id = $1",
      [req.user.organizationId]
    );
    const transferNumber = `TR-${new Date().getUTCFullYear()}-${String(sequence.rows[0].next_number).padStart(6, "0")}`;
    const transferResult = await client.query(
      `INSERT INTO inventory_transfers
       (organization_id, transfer_number, source_branch_id, destination_branch_id,
        request_reference, request_hash, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, transfer_number, status`,
      [req.user.organizationId, transferNumber, sourceBranchId, destinationBranchId,
        requestReference, requestHash, notes, req.user.id]
    );
    for (const item of validated.items) {
      await client.query(
        `INSERT INTO inventory_transfer_items
         (inventory_transfer_id, part_id, requested_quantity) VALUES ($1,$2,$3)`,
        [transferResult.rows[0].id, item.partId, item.quantity]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(transferResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "transfer_reference_conflict" });
    console.error(error);
    res.status(500).json({ error: "inventory_transfer_create_failed" });
  } finally {
    client.release();
  }
});

router.post("/:id/cancel", requireRole("admin"), async (req, res) => {
  const transferId = Number(req.params.id);
  if (!Number.isInteger(transferId)) return res.status(400).json({ error: "invalid_inventory_transfer" });
  const result = await pool.query(
    `UPDATE inventory_transfers SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status = 'requested'
     RETURNING id, status`,
    [transferId, req.user.organizationId]
  );
  if (!result.rows[0]) return res.status(409).json({ error: "transfer_not_cancellable" });
  res.json(result.rows[0]);
});

router.post("/:id/ship", requireRole("admin", "warehouse_keeper"), deviceRequired, async (req, res) => {
  const transferId = Number(req.params.id);
  const shipmentReference = String(req.body?.shipmentReference || "");
  if (!Number.isInteger(transferId) || !isUuid(shipmentReference)) {
    return res.status(400).json({ error: "invalid_transfer_shipment" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [transferId]);
    const transfer = await loadTransfer(client, transferId, req.user.organizationId, true);
    if (!transfer) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "inventory_transfer_not_found" });
    }
    if (transfer.shipment_reference === shipmentReference && transfer.status !== "requested") {
      await client.query("ROLLBACK");
      return res.json({ id: transfer.id, status: transfer.status, duplicate: true });
    }
    if (transfer.status !== "requested") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "transfer_not_shippable" });
    }
    if (Number(req.device.branch_id) !== Number(transfer.source_branch_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "transfer_source_device_required" });
    }
    for (const item of transfer.items) {
      const stock = await client.query(
        `SELECT i.quantity FROM inventory i
         JOIN parts p ON p.id = i.part_id
         WHERE i.part_id = $1 AND i.branch_id = $2 AND p.organization_id = $3
         FOR UPDATE OF i`,
        [item.partId, transfer.source_branch_id, req.user.organizationId]
      );
      if (!stock.rows[0] || Number(stock.rows[0].quantity) < Number(item.requestedQuantity)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "transfer_insufficient_source_stock", partId: item.partId });
      }
    }
    for (const item of transfer.items) {
      await client.query(
        "UPDATE inventory SET quantity = quantity - $1 WHERE part_id = $2 AND branch_id = $3",
        [item.requestedQuantity, item.partId, transfer.source_branch_id]
      );
      await client.query(
        "UPDATE inventory_transfer_items SET shipped_quantity = requested_quantity WHERE id = $1",
        [item.id]
      );
      await client.query(
        `INSERT INTO inventory_movements
         (organization_id, branch_id, part_id, device_id, performed_by, movement_type,
          quantity_change, reference_type, reference_id, note)
         VALUES ($1,$2,$3,$4,$5,'transfer_out',$6,'inventory_transfer',$7,$8)`,
        [req.user.organizationId, transfer.source_branch_id, item.partId, req.device.id,
          req.user.id, -Number(item.requestedQuantity), String(transfer.id), transfer.notes]
      );
    }
    await client.query(
      `UPDATE inventory_transfers
       SET status = 'in_transit', shipment_reference = $1, shipped_by = $2,
           shipped_device_id = $3, shipped_at = now(), updated_at = now()
       WHERE id = $4`,
      [shipmentReference, req.user.id, req.device.id, transfer.id]
    );
    await client.query("COMMIT");
    res.json({ id: transfer.id, status: "in_transit" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "transfer_shipment_reference_conflict" });
    console.error(error);
    res.status(500).json({ error: "inventory_transfer_ship_failed" });
  } finally {
    client.release();
  }
});

router.post("/:id/receive", requireRole("admin", "warehouse_keeper"), deviceRequired, async (req, res) => {
  const transferId = Number(req.params.id);
  const receiptReference = String(req.body?.receiptReference || "");
  const receiptNote = cleanText(req.body?.receiptNote) || null;
  const validated = validateTransferReceiptItems(req.body?.items);
  if (!Number.isInteger(transferId) || !isUuid(receiptReference) || validated.error) {
    return res.status(400).json({ error: validated.error || "invalid_transfer_receipt" });
  }
  const receiptHash = inventoryTransferReceiptHash(transferId, validated.items, receiptNote);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [transferId]);
    const transfer = await loadTransfer(client, transferId, req.user.organizationId, true);
    if (!transfer) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "inventory_transfer_not_found" });
    }
    if (transfer.receipt_reference === receiptReference && ["received", "received_with_variance"].includes(transfer.status)) {
      await client.query("ROLLBACK");
      if (transfer.receipt_hash !== receiptHash) {
        return res.status(409).json({ error: "transfer_receipt_reference_payload_mismatch" });
      }
      return res.json({ id: transfer.id, status: transfer.status, duplicate: true });
    }
    if (transfer.status !== "in_transit") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "transfer_not_receivable" });
    }
    if (Number(req.device.branch_id) !== Number(transfer.destination_branch_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "transfer_destination_device_required" });
    }
    const submitted = new Map(validated.items.map((item) => [item.transferItemId, item]));
    if (submitted.size !== transfer.items.length || transfer.items.some((item) => !submitted.has(Number(item.id)))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "transfer_receipt_all_lines_required" });
    }
    let hasVariance = false;
    for (const item of transfer.items) {
      const received = submitted.get(Number(item.id));
      const shippedQuantity = Number(item.shippedQuantity);
      if (received.receivedQuantity + received.damagedQuantity > shippedQuantity) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "transfer_receipt_exceeds_shipped", partId: item.partId });
      }
      if (received.receivedQuantity !== shippedQuantity || received.damagedQuantity > 0) hasVariance = true;
    }
    if (hasVariance && !receiptNote) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "transfer_variance_note_required" });
    }
    for (const item of transfer.items) {
      const received = submitted.get(Number(item.id));
      await client.query(
        `UPDATE inventory_transfer_items SET received_quantity = $1, damaged_quantity = $2 WHERE id = $3`,
        [received.receivedQuantity, received.damagedQuantity, item.id]
      );
      if (received.receivedQuantity > 0) {
        await client.query(
          `INSERT INTO inventory (part_id, branch_id, quantity)
           VALUES ($1,$2,$3)
           ON CONFLICT (part_id, branch_id) DO UPDATE
           SET quantity = inventory.quantity + EXCLUDED.quantity`,
          [item.partId, transfer.destination_branch_id, received.receivedQuantity]
        );
        await client.query(
          `INSERT INTO inventory_movements
           (organization_id, branch_id, part_id, device_id, performed_by, movement_type,
            quantity_change, reference_type, reference_id, note)
           VALUES ($1,$2,$3,$4,$5,'transfer_in',$6,'inventory_transfer',$7,$8)`,
          [req.user.organizationId, transfer.destination_branch_id, item.partId, req.device.id,
            req.user.id, received.receivedQuantity, String(transfer.id), transfer.notes]
        );
      }
    }
    const finalStatus = hasVariance ? "received_with_variance" : "received";
    await client.query(
      `UPDATE inventory_transfers
       SET status = $1, receipt_reference = $2, receipt_hash = $3,
           receipt_note = $4, received_by = $5, received_device_id = $6,
           received_at = now(), updated_at = now()
       WHERE id = $7`,
      [finalStatus, receiptReference, receiptHash, receiptNote,
        req.user.id, req.device.id, transfer.id]
    );
    await client.query("COMMIT");
    res.json({ id: transfer.id, status: finalStatus });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "transfer_receipt_reference_conflict" });
    console.error(error);
    res.status(500).json({ error: "inventory_transfer_receive_failed" });
  } finally {
    client.release();
  }
});

export default router;
