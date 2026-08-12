import { pool } from "../db/pool.js";
import { requireRole } from "./auth.js";
import { fetchMoyasarPayment, isUuid, paymentMatches, refundableAmount, refundMoyasarPayment } from "../utils/moyasar.js";
import { createSafeRouter } from "../utils/safe-router.js";

const router = createSafeRouter();

// Yearly = 10x the monthly price instead of 12x — a ~17% discount for
// committing upfront, and simple enough to explain to a shop owner without
// a pricing calculator. Change the multiplier here if the discount changes.
const YEARLY_MONTHS_CHARGED = 10;

function yearlyPriceFor(monthlyPriceSar) {
  return Number(monthlyPriceSar) * YEARLY_MONTHS_CHARGED;
}

/** GET /api/billing/status — trial/subscription state for the caller's shop */
router.get("/status", requireRole("admin"), async (req, res) => {
  const r = await pool.query(
    `SELECT id, name, plan, plan_price_sar, trial_ends_at, subscription_status,
            (moyasar_card_token IS NOT NULL) AS has_payment_method, next_billing_at,
            billing_interval
     FROM organizations WHERE id = $1`,
    [req.user.organizationId]
  );
  const org = r.rows[0];
  if (!org) return res.json(null);
  res.json({
    ...org,
    plan_price_yearly_sar: yearlyPriceFor(org.plan_price_sar),
  });
});

/**
 * POST /api/billing/activate-subscription
 * body: { paymentId, requestReference, interval } — verifies the hosted-form payment server-side.
 * Only an org admin can do this (it's the shop's own billing, not a
 * customer's checkout). Charges the plan price ONCE right now, with
 * save_card:true, and stores the resulting reusable token — every future
 * renewal (see scripts/billing-cron.js) reuses that token to charge
 * automatically with zero customer interaction, exactly like a normal app
 * store subscription. The admin can call this any time during or after the
 * trial to lock in billing before the trial ends, and can choose monthly or
 * yearly billing at that point. The hosted form creates the first payment;
 * this endpoint independently verifies it and stores its reusable token.
 */
router.post("/activate-subscription", requireRole("admin"), async (req, res) => {
  if (process.env.PAYMENTS_ENABLED !== "true") {
    return res.status(503).json({ error: "payments_temporarily_disabled" });
  }
  const { paymentId, requestReference, interval } = req.body || {};
  if (!isUuid(paymentId)) {
    return res.status(400).json({ error: "invalid_payment_reference" });
  }
  if (!isUuid(requestReference)) {
    return res.status(400).json({ error: "invalid_request_reference" });
  }
  const billingInterval = interval === "yearly" ? "yearly" : "monthly";

  const orgId = req.user.organizationId;
  const client = await pool.connect();
  let verifiedPayment = null;
  try {
    const orgRes = await client.query("SELECT * FROM organizations WHERE id = $1", [orgId]);
    const org = orgRes.rows[0];
    if (!org) return res.status(404).json({ error: "organization_not_found" });

    const amountSar =
      billingInterval === "yearly" ? yearlyPriceFor(org.plan_price_sar) : Number(org.plan_price_sar);

    const expectedAmountHalalas = Math.round(amountSar * 100);
    const existingPayment = await client.query(
      "SELECT id FROM subscription_payments WHERE organization_id = $1 AND payment_reference = $2",
      [orgId, paymentId]
    );
    if (existingPayment.rows[0]) {
      return res.json({ ok: true, idempotent: true, message: "الاشتراك مفعّل مسبقًا بهذه الدفعة." });
    }
    const payment = await fetchMoyasarPayment(paymentId);
    const metadata = payment.metadata || {};
    if (
      metadata.rakaez_purpose !== "subscription_activation" ||
      metadata.rakaez_request_reference !== requestReference ||
      String(metadata.rakaez_organization_id) !== String(orgId)
    ) {
      return res.status(403).json({ error: "payment_ownership_mismatch" });
    }
    if (!paymentMatches(payment, expectedAmountHalalas, "SAR")) {
      const isSettled = ["paid", "captured"].includes(payment.status);
      const refundAmount = refundableAmount(payment);
      const refund = isSettled && refundAmount > 0
        ? await refundMoyasarPayment(payment.id, refundAmount)
        : null;
      return res.status(402).json({
        error: "payment_verification_failed",
        status: payment.status,
        refunded: refund?.ok ?? false,
      });
    }
    verifiedPayment = payment;

    const reusableToken = payment.source?.token;
    if (!reusableToken) {
      // Charged the customer but Moyasar didn't hand back a reusable token —
      // don't silently pretend recurring billing is set up when it isn't.
      const refund = await refundMoyasarPayment(payment.id, expectedAmountHalalas);
      return res.status(500).json({
        error: "no_reusable_token",
        refunded: refund.ok,
        message: refund.ok
          ? "تعذّر حفظ البطاقة وتم استرجاع المبلغ تلقائيًا."
          : "تعذّر حفظ البطاقة والاسترجاع التلقائي؛ تواصل مع الدعم بمرجع الدفع: " + payment.id,
      });
    }

    await client.query("BEGIN");
    const lockedOrg = await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [orgId]);
    if (!lockedOrg.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "organization_not_found" });
    }
    const lockedExistingPayment = await client.query(
      "SELECT id FROM subscription_payments WHERE organization_id = $1 AND payment_reference = $2",
      [orgId, payment.id]
    );
    if (lockedExistingPayment.rows[0]) {
      await client.query("COMMIT");
      return res.json({ ok: true, idempotent: true, message: "الاشتراك مفعّل مسبقًا بهذه الدفعة." });
    }

    const intervalSql = billingInterval === "yearly" ? "interval '1 year'" : "interval '1 month'";
    await client.query(
      `UPDATE organizations
       SET moyasar_card_token = $1, subscription_status = 'active',
           billing_interval = $2, next_billing_at = now() + ${intervalSql}
       WHERE id = $3`,
      [reusableToken, billingInterval, orgId]
    );
    await client.query(
      `INSERT INTO subscription_payments
       (organization_id, payment_reference, purpose, amount_halalas, currency, billing_interval, status)
       VALUES ($1,$2,'activation',$3,'SAR',$4,'paid')`,
      [orgId, payment.id, expectedAmountHalalas, billingInterval]
    );
    await client.query("COMMIT");

    res.json({
      ok: true,
      message:
        billingInterval === "yearly"
          ? "تم تفعيل الاشتراك السنوي — سيتم التجديد تلقائياً كل سنة بدون أي إجراء منك."
          : "تم تفعيل الاشتراك الشهري — سيتم التجديد تلقائياً كل شهر بدون أي إجراء منك.",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    if (verifiedPayment) {
      try {
        const existing = await pool.query(
          "SELECT id FROM subscription_payments WHERE organization_id = $1 AND payment_reference = $2",
          [orgId, verifiedPayment.id]
        );
        if (existing.rows[0]) {
          return res.json({ ok: true, idempotent: true, message: "الاشتراك مفعّل مسبقًا بهذه الدفعة." });
        }
        const refundAmount = refundableAmount(verifiedPayment);
        const refund = refundAmount > 0
          ? await refundMoyasarPayment(verifiedPayment.id, refundAmount)
          : { ok: false };
        return res.status(409).json({
          error: "activation_failed",
          refunded: refund.ok,
          message: refund.ok
            ? "تعذّر تفعيل الاشتراك وتم استرجاع المبلغ تلقائيًا."
            : "تعذّر تفعيل الاشتراك والاسترجاع التلقائي؛ تواصل مع الدعم بمرجع الدفع: " + verifiedPayment.id,
        });
      } catch (reconciliationError) {
        console.error("Subscription payment reconciliation failed:", reconciliationError);
        return res.status(503).json({
          error: "payment_reconciliation_required",
          paymentReference: verifiedPayment.id,
          message: "تعذّر التأكد من تسجيل الاشتراك. لم ننفذ استرجاعًا تلقائيًا لتجنب عكس اشتراك صحيح؛ تواصل مع الدعم.",
        });
      }
    }
    res.status(400).json({ error: "activation_failed" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/billing/change-interval
 * body: { interval: 'monthly' | 'yearly' }
 * Lets an already-active subscriber switch plans going forward. Does NOT
 * charge anything immediately or prorate the current period — it only
 * changes what the NEXT renewal (billing-cron.js) will charge and how far
 * next_billing_at moves. Keeping this simple (no proration) avoids a class
 * of billing-dispute bugs; revisit if shops start asking for proration.
 */
router.post("/change-interval", requireRole("admin"), async (req, res) => {
  const { interval } = req.body;
  if (interval !== "monthly" && interval !== "yearly") {
    return res.status(400).json({ error: "invalid_interval" });
  }
  const orgId = req.user.organizationId;
  const orgRes = await pool.query("SELECT subscription_status FROM organizations WHERE id = $1", [orgId]);
  const org = orgRes.rows[0];
  if (!org) return res.status(404).json({ error: "organization_not_found" });
  if (org.subscription_status !== "active") {
    return res.status(400).json({ error: "no_active_subscription" });
  }
  await pool.query("UPDATE organizations SET billing_interval = $1 WHERE id = $2", [interval, orgId]);
  res.json({ ok: true, message: "تم تحديث دورة الفوترة — سيُطبَّق ذلك عند التجديد القادم." });
});

export default router;
