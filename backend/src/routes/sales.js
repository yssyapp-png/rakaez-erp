import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { requireRole } from "./auth.js";
import { buildZatcaQrBase64 } from "../utils/zatca.js";
import { createMoyasarPayment, refundMoyasarPayment } from "../utils/moyasar.js";

const router = Router();

// Security fix: payment-initiating routes were only covered by the general
// 300-req/15min /api limiter, which is far too loose for endpoints that
// charge a card — that limit lets an attacker run hundreds of card-testing
// attempts before being blocked. Apply a much tighter limit specifically
// to checkout routes.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "محاولات كثيرة جداً — يرجى المحاولة لاحقاً." },
});

async function getOrganization(client, orgId) {
  const r = await client.query("SELECT * FROM organizations WHERE id = $1", [orgId]);
  return r.rows[0] || { name: "ركائز لقطع غيار السيارات", vat_number: "000000000000000" };
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
router.post("/checkout", paymentLimiter, requireRole("seller", "admin"), async (req, res) => {
  const { items } = req.body;
  const orgId = req.user.organizationId;
  const sellerId = req.user.id;
  const branchId = req.body.branchId || req.user.branchId;
  if (!branchId) return res.status(400).json({ error: "missing_branch" });
  if (!items?.length) return res.status(400).json({ error: "empty_cart" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Security fix: the comment above always said branchId must never be
    // trusted from the request body, but the code was doing exactly that
    // (req.body.branchId took priority over req.user.branchId). Verify the
    // branch actually belongs to this seller's organization before using it,
    // rather than relying on inventory lookups happening to fail for a
    // mismatched branch.
    const branchCheck = await client.query(
      "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
      [branchId, orgId]
    );
    if (!branchCheck.rows.length) {
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

    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const total = subtotal + vat;
    const invoiceNumber = `INV-${Date.now()}`;
    const timestampIso = new Date().toISOString();
    const org = await getOrganization(client, orgId);
    const zatcaQr = buildZatcaQrBase64({
      sellerName: org.name,
      vatNumber: org.vat_number || "000000000000000",
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
    }

    await client.query("COMMIT");
    res.json(invoice);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: err.message || "checkout_failed" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/sales/checkout-online
 * body: { branchId, items: [{partId (= part_number), quantity}], moyasarToken }
 * Used by the customer app: charges the card via Moyasar BEFORE touching
 * inventory, so a failed/declined payment never decrements stock. Requires
 * the caller to be authenticated (any role) — customers must have an
 * account, scoped to the same organization as the branch they're buying
 * from, so an invoice can be attributed to someone within that shop's data.
 */
router.post("/checkout-online", paymentLimiter, async (req, res) => {
  const { branchId, items, moyasarToken } = req.body;
  const orgId = req.user.organizationId;
  if (!items?.length) return res.status(400).json({ error: "empty_cart" });
  if (!branchId) return res.status(400).json({ error: "missing_branch" });
  if (!moyasarToken) return res.status(400).json({ error: "missing_payment_token" });

  const client = await pool.connect();
  try {
    // Security fix: verify branchId belongs to the caller's organization
    // before charging the customer's card or touching inventory — the same
    // issue as in POST /checkout above.
    const branchCheck = await client.query(
      "SELECT id FROM branches WHERE id = $1 AND organization_id = $2",
      [branchId, orgId]
    );
    if (!branchCheck.rows.length) {
      return res.status(404).json({ error: "branch_not_found" });
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
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const total = subtotal + vat;

    const payment = await createMoyasarPayment({
      amountHalalas: Math.round(total * 100),
      source: { type: "token", token: moyasarToken },
      description: `طلب ركائز - ${items.length} صنف`,
    });

    if (payment.status !== "paid") {
      return res.status(402).json({ error: "payment_not_completed", status: payment.status });
    }

    // From this point the customer HAS been charged — any failure below
    // must trigger a refund before we return an error, or they lose money
    // for an order we never actually fulfilled.
    try {
      await client.query("BEGIN");
      for (const item of resolvedItems) {
        const inv = await client.query(
          `UPDATE inventory SET quantity = quantity - $1
           WHERE part_id = $2 AND branch_id = $3 AND quantity >= $1
           RETURNING quantity`,
          [item.quantity, item.id, branchId]
        );
        if (!inv.rows.length) throw new Error(`insufficient_stock:${item.id}`);
      }

      const invoiceNumber = `INV-${Date.now()}`;
      const timestampIso = new Date().toISOString();
      const org = await getOrganization(client, orgId);
      const zatcaQr = buildZatcaQrBase64({
        sellerName: org.name,
        vatNumber: org.vat_number || "000000000000000",
        timestampIso,
        total,
        vatAmount: vat,
      });

      const invoiceRes = await client.query(
        `INSERT INTO invoices (organization_id, invoice_number, branch_id, seller_id, subtotal, vat, total, zatca_status, zatca_qr, payment_status, payment_reference)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,'generated_locally',$7,'paid',$8) RETURNING *`,
        [orgId, invoiceNumber, branchId, subtotal, vat, total, zatcaQr, payment.id]
      );
      const invoice = invoiceRes.rows[0];

      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, part_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [invoice.id, item.id, item.quantity, item.price]
        );
      }

      await client.query("COMMIT");
      res.json(invoice);
    } catch (fulfillmentErr) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Fulfillment failed after successful payment, refunding:", fulfillmentErr);
      const refund = await refundMoyasarPayment(payment.id, Math.round(total * 100));
      res.status(409).json({
        error: fulfillmentErr.message || "fulfillment_failed",
        refunded: refund.ok,
        message: refund.ok
          ? "تعذّر إتمام الطلب (نفد المخزون على الأرجح) وتم استرجاع كامل المبلغ تلقائياً."
          : "تعذّر إتمام الطلب والاسترجاع التلقائي فشل أيضاً — يرجى التواصل مع الدعم فوراً بمرجع الدفع: " + payment.id,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "checkout_failed" });
  } finally {
    client.release();
  }
});

// Security fix: this previously had no role restriction, so an
// authenticated "customer" could list every invoice for the whole
// organization — not just their own purchases. Restrict to staff.
router.get("/invoices", requireRole("seller", "admin"), async (req, res) => {
  const r = await pool.query(
    `SELECT i.*, b.name AS branch_name
     FROM invoices i JOIN branches b ON b.id = i.branch_id
     WHERE i.organization_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [req.user.organizationId]
  );
  res.json(r.rows);
});

export default router;
