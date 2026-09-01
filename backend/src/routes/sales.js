import { pool } from "../db/pool.js";
import { requireRole } from "./auth.js";
import { buildZatcaQrBase64 } from "../utils/zatca.js";
import crypto from "crypto";
import { fetchMoyasarPayment, isUuid, paymentMatches, refundOutstandingMoyasarPayment } from "../utils/moyasar.js";
import { deviceRequired } from "./devices.js";
import { createSafeRouter } from "../utils/safe-router.js";

const router = createSafeRouter();

const MAX_CHECKOUT_LINES = 200;

function publicSalesError(error, fallback) {
  const message = String(error?.message || "");
  if (message === "part_not_found" || message === "organization_vat_number_required") return message;
  if (message.startsWith("insufficient_stock:")) return "insufficient_stock";
  return fallback;
}

export function hasValidItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_CHECKOUT_LINES) return false;
  const partIds = new Set();
  return items.every((item) => {
    const partId = typeof item.partId === "string" ? item.partId.trim() : "";
    if (!partId || partId.length > 100 || partIds.has(partId)) return false;
    partIds.add(partId);
    return Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0;
  });
}

async function requireOwnedBranch(client, branchId, orgId) {
  const result = await client.query(
    "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
    [branchId, orgId]
  );
  return Boolean(result.rows[0]);
}

async function getOrganization(client, orgId) {
  const r = await client.query("SELECT * FROM organizations WHERE id = $1", [orgId]);
  return r.rows[0] || null;
}

function requireInvoiceIdentity(organization) {
  if (!organization || !organization.name || !/^\d{15}$/.test(String(organization.vat_number || ""))) {
    throw new Error("organization_vat_number_required");
  }
  return organization;
}

/**
 * Looks a part up by its shop-facing part_number WITHIN the caller's
 * organization only — this is what actually prevents shop A's checkout
 * from ever touching shop B's inventory, even if someone guesses a
 * part_number that happens to also exist at another tenant.
 */
async function findPartId(client, orgId, partNumber) {
  const r = await client.query("SELECT id, price FROM parts WHERE organization_id = $1 AND part_number = $2", [
    orgId,
    partNumber,
  ]);
  return r.rows[0] || null;
}

/**
 * POST /api/sales/checkout
 * body: { items: [{ partId (= part_number), quantity }] }
 * branchId, sellerId, and organizationId all come from the authenticated
 * user (req.user) — never trust these from the request body, or a seller
 * at one shop could invoice against another shop's branch/inventory.
 */
router.post("/checkout", requireRole("seller", "admin"), deviceRequired, async (req, res) => {
  const { items } = req.body;
  const orgId = req.user.organizationId;
  const sellerId = req.user.id;
  const branchId = req.device.branch_id;
  if (!branchId) return res.status(400).json({ error: "missing_branch" });
  if (!hasValidItems(items)) return res.status(400).json({ error: "invalid_items" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await requireOwnedBranch(client, branchId, orgId))) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "branch_not_found" });
    }

    let subtotal = 0;
    const resolvedItems = [];
    for (const item of items) {
      const part = await findPartId(client, orgId, item.partId);
      if (!part) throw new Error("part_not_found");
      const price = Number(part.price);
      subtotal += price * item.quantity;
      resolvedItems.push({ id: part.id, price, quantity: item.quantity });

      const inv = await client.query(
        `UPDATE inventory SET quantity = quantity - $1
         WHERE part_id = $2 AND branch_id = $3 AND quantity >= $1
         RETURNING quantity`,
        [item.quantity, part.id, branchId]
      );
      if (!inv.rows.length) throw new Error(`insufficient_stock:${item.partId}`);
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const total = Math.round((subtotal + vat) * 100) / 100;
    const invoiceNumber = `INV-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const timestampIso = new Date().toISOString();
    const org = requireInvoiceIdentity(await getOrganization(client, orgId));
    const zatcaQr = buildZatcaQrBase64({
      sellerName: org.name,
      vatNumber: org.vat_number,
      timestampIso,
      total,
      vatAmount: vat,
    });

    const invoiceRes = await client.query(
      `INSERT INTO invoices (organization_id, invoice_number, branch_id, seller_id, subtotal, vat, total, zatca_status, zatca_qr, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'generated_locally',$8,'pos') RETURNING *`,
      [orgId, invoiceNumber, branchId, sellerId, subtotal, vat, total, zatcaQr]
    );
    const invoice = invoiceRes.rows[0];

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, part_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [invoice.id, item.id, item.quantity, item.price]
      );
      await client.query(
        `INSERT INTO inventory_movements
         (organization_id, branch_id, part_id, device_id, performed_by, movement_type, quantity_change, reference_type, reference_id)
         VALUES ($1,$2,$3,$4,$5,'sale',$6,'invoice',$7)`,
        [orgId, branchId, item.id, req.device.id, sellerId, -item.quantity, String(invoice.id)]
      );
    }

    await client.query("COMMIT");
    res.json(invoice);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: publicSalesError(err, "checkout_failed") });
  } finally {
    client.release();
  }
});

/**
 * POST /api/sales/checkout-online
 * body: { branchId, items: [{partId (= part_number), quantity}], paymentId, requestReference }
 * Used by the customer app after Moyasar's hosted form creates the payment.
 * The server independently retrieves and verifies that payment before touching inventory. Requires
 * the caller to be authenticated (any role) — customers must have an
 * account, scoped to the same organization as the branch they're buying
 * from, so an invoice can be attributed to someone within that shop's data.
 */
router.post("/checkout-online", requireRole("customer", "seller", "admin"), async (req, res) => {
  if (process.env.PAYMENTS_ENABLED !== "true") {
    return res.status(503).json({ error: "payments_temporarily_disabled" });
  }
  const { branchId, items, paymentId, requestReference } = req.body || {};
  const orgId = req.user.organizationId;
  if (!hasValidItems(items)) return res.status(400).json({ error: "invalid_items" });
  if (!branchId) return res.status(400).json({ error: "missing_branch" });
  if (!isUuid(paymentId)) {
    return res.status(400).json({ error: "invalid_payment_reference" });
  }
  if (!isUuid(requestReference)) {
    return res.status(400).json({ error: "invalid_request_reference" });
  }

  const client = await pool.connect();
  let verifiedOwnedPayment = null;
  let paymentLockHeld = false;
  try {
    // Serializes retries for one Moyasar payment across all API instances.
    // The lock is released in finally and never blocks unrelated payments.
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [`rakaez:online-payment:${paymentId}`]
    );
    if (!lockResult.rows[0]?.acquired) {
      res.setHeader("Retry-After", "2");
      return res.status(409).json({ error: "payment_processing_in_progress", retryable: true });
    }
    paymentLockHeld = true;
    if (!(await requireOwnedBranch(client, branchId, orgId))) {
      return res.status(404).json({ error: "branch_not_found" });
    }
    const payment = await fetchMoyasarPayment(paymentId);
    const metadata = payment.metadata || {};
    if (
      metadata.rakaez_purpose !== "online_order" ||
      metadata.rakaez_request_reference !== requestReference ||
      String(metadata.rakaez_organization_id) !== String(orgId) ||
      String(metadata.rakaez_user_id) !== String(req.user.id)
    ) {
      return res.status(403).json({ error: "payment_ownership_mismatch" });
    }
    verifiedOwnedPayment = payment;

    // A lost HTTP response can make the browser retry after prices change.
    // Return the already-created invoice using its original total before
    // repricing, otherwise a valid paid order could be refunded by mistake.
    const priorInvoice = await client.query(
      `SELECT * FROM invoices
       WHERE organization_id = $1 AND customer_id = $2 AND branch_id = $3 AND payment_reference = $4`,
      [orgId, req.user.id, branchId, payment.id]
    );
    if (priorInvoice.rows[0]) {
      const invoice = priorInvoice.rows[0];
      if (!paymentMatches(payment, Math.round(Number(invoice.total) * 100), "SAR")) {
        return res.status(409).json({ error: "payment_reconciliation_required" });
      }
      return res.json({ ...invoice, idempotent: true });
    }

    // price everything first (read-only) so we know the exact amount to charge
    let subtotal = 0;
    const resolvedItems = [];
    for (const item of items) {
      const part = await findPartId(client, orgId, item.partId);
      if (!part) throw new Error("part_not_found");
      subtotal += Number(part.price) * item.quantity;
      resolvedItems.push({ id: part.id, price: Number(part.price), quantity: item.quantity });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const total = Math.round((subtotal + vat) * 100) / 100;

    const expectedAmountHalalas = Math.round(total * 100);
    if (!paymentMatches(payment, expectedAmountHalalas, "SAR")) {
      const isSettled = ["paid", "captured"].includes(payment.status);
      const refund = isSettled
        ? await refundOutstandingMoyasarPayment(payment.id)
        : null;
      return res.status(402).json({
        error: "payment_verification_failed",
        status: payment.status,
        refunded: refund?.ok ?? false,
      });
    }

    // From this point the customer HAS been charged — any failure below
    // must trigger a refund before we return an error, or they lose money
    // for an order we never actually fulfilled.
    try {
      await client.query("BEGIN");
      const existingInvoice = await client.query(
        "SELECT * FROM invoices WHERE organization_id = $1 AND payment_reference = $2 FOR UPDATE",
        [orgId, payment.id]
      );
      if (existingInvoice.rows[0]) {
        await client.query("COMMIT");
        return res.json({ ...existingInvoice.rows[0], idempotent: true });
      }
      for (const item of resolvedItems) {
        const inv = await client.query(
          `UPDATE inventory SET quantity = quantity - $1
           WHERE part_id = $2 AND branch_id = $3 AND quantity >= $1
           RETURNING quantity`,
          [item.quantity, item.id, branchId]
        );
        if (!inv.rows.length) throw new Error(`insufficient_stock:${item.id}`);
      }

      const invoiceNumber = `INV-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const timestampIso = new Date().toISOString();
      const org = requireInvoiceIdentity(await getOrganization(client, orgId));
      const zatcaQr = buildZatcaQrBase64({
        sellerName: org.name,
        vatNumber: org.vat_number,
        timestampIso,
        total,
        vatAmount: vat,
      });

      const invoiceRes = await client.query(
        `INSERT INTO invoices (organization_id, invoice_number, branch_id, seller_id, customer_id, subtotal, vat, total, zatca_status, zatca_qr, payment_status, payment_reference)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,'generated_locally',$8,'paid',$9) RETURNING *`,
        [orgId, invoiceNumber, branchId, req.user.id, subtotal, vat, total, zatcaQr, payment.id]
      );
      const invoice = invoiceRes.rows[0];

      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, part_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [invoice.id, item.id, item.quantity, item.price]
        );
        await client.query(
          `INSERT INTO inventory_movements
           (organization_id, branch_id, part_id, performed_by, movement_type, quantity_change, reference_type, reference_id)
           VALUES ($1,$2,$3,$4,'sale',$5,'invoice',$6)`,
          [orgId, branchId, item.id, req.user.id, -item.quantity, String(invoice.id)]
        );
      }

      await client.query("COMMIT");
      res.json(invoice);
    } catch (fulfillmentErr) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Fulfillment failed after successful payment, refunding:", fulfillmentErr);
      const existing = await client.query(
        "SELECT * FROM invoices WHERE organization_id = $1 AND payment_reference = $2",
        [orgId, payment.id]
      );
      if (existing.rows[0]) return res.json({ ...existing.rows[0], idempotent: true });
      const refund = await refundOutstandingMoyasarPayment(payment.id);
      res.status(409).json({
        error: publicSalesError(fulfillmentErr, "fulfillment_failed"),
        refunded: refund.ok,
        message: refund.ok
          ? "تعذّر إتمام الطلب (نفد المخزون على الأرجح) وتم استرجاع كامل المبلغ تلقائياً."
          : "تعذّر إتمام الطلب والاسترجاع التلقائي فشل أيضاً — يرجى التواصل مع الدعم فوراً بمرجع الدفع: " + payment.id,
      });
    }
  } catch (err) {
    console.error(err);
    if (verifiedOwnedPayment && ["paid", "captured"].includes(verifiedOwnedPayment.status)) {
      try {
        const existing = await client.query(
          "SELECT * FROM invoices WHERE organization_id = $1 AND customer_id = $2 AND payment_reference = $3",
          [orgId, req.user.id, verifiedOwnedPayment.id]
        );
        if (existing.rows[0]) return res.json({ ...existing.rows[0], idempotent: true });
        const refund = await refundOutstandingMoyasarPayment(verifiedOwnedPayment.id);
        return res.status(409).json({
          error: publicSalesError(err, "order_preparation_failed"),
          refunded: refund.ok,
          message: refund.ok
            ? "تعذّر تجهيز الطلب وتم استرجاع كامل المبلغ تلقائيًا."
            : "تعذّر تجهيز الطلب والاسترجاع التلقائي؛ تواصل مع الدعم بمرجع الدفع: " + verifiedOwnedPayment.id,
        });
      } catch (reconciliationError) {
        console.error("Payment reconciliation failed; leaving payment unchanged for manual review:", reconciliationError);
        return res.status(503).json({
          error: "payment_reconciliation_required",
          paymentReference: verifiedOwnedPayment.id,
          message: "تعذّر التأكد من حالة الطلب. لم ننفذ استرجاعًا تلقائيًا لتجنب عكس طلب صحيح؛ تواصل مع الدعم.",
        });
      }
    }
    res.status(400).json({ error: publicSalesError(err, "checkout_failed") });
  } finally {
    if (paymentLockHeld) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
        [`rakaez:online-payment:${paymentId}`]
      ).catch(() => {});
    }
    client.release();
  }
});

router.get("/invoices", requireRole("customer", "seller", "admin"), async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 50));
  const offset = (page - 1) * pageSize;

  let scopeFilter = "";
  const sellerFilter = req.user.role === "seller" ? "AND i.branch_id = $2" : "";
  const scopeParams = [req.user.organizationId];

  if (req.user.role === "customer") {
    scopeParams.push(req.user.id);
    scopeFilter = "AND i.customer_id = $2";
  }

  if (req.user.role === "seller") {
    if (!req.user.branchId) {
      return res.status(403).json({ error: "employee_branch_required" });
    }
    scopeParams.push(req.user.branchId);
    scopeFilter = sellerFilter;
  }

  const limitPosition = scopeParams.length + 1;
  const offsetPosition = scopeParams.length + 2;

  try {
    const [invoiceResult, countResult] = await Promise.all([
      pool.query(
        `SELECT i.*, b.name AS branch_name
         FROM invoices i
         JOIN branches b
           ON b.id = i.branch_id
          AND b.organization_id = i.organization_id
         WHERE i.organization_id = $1
           ${scopeFilter}
         ORDER BY i.created_at DESC
         LIMIT $${limitPosition}
         OFFSET $${offsetPosition}`,
        [...scopeParams, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::integer AS total
         FROM invoices i
         WHERE i.organization_id = $1
           ${scopeFilter}`,
        scopeParams
      ),
    ]);

    const total = countResult.rows[0]?.total ?? 0;

    return res.json({
      items: invoiceResult.rows,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Invoice listing failed:", error);
    return res.status(500).json({ error: "invoice_listing_failed" });
  }
});

export default router;
