import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireRole } from "./auth.js";
import { createMoyasarPayment } from "../utils/moyasar.js";

const router = Router();

// Yearly = 10x the monthly price instead of 12x — a ~17% discount for
// committing upfront, and simple enough to explain to a shop owner without
// a pricing calculator. Change the multiplier here if the discount changes.
const YEARLY_MONTHS_CHARGED = 10;

function yearlyPriceFor(monthlyPriceSar) {
  return Number(monthlyPriceSar) * YEARLY_MONTHS_CHARGED;
}

/** GET /api/billing/status — trial/subscription state for the caller's shop */
router.get("/status", async (req, res) => {
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
 * body: { moyasarToken, interval }  — interval: 'monthly' | 'yearly' (defaults to monthly)
 * Only an org admin can do this (it's the shop's own billing, not a
 * customer's checkout). Charges the plan price ONCE right now, with
 * save_card:true, and stores the resulting reusable token — every future
 * renewal (see scripts/billing-cron.js) reuses that token to charge
 * automatically with zero customer interaction, exactly like a normal app
 * store subscription. The admin can call this any time during or after the
 * trial to lock in billing before the trial ends, and can choose monthly or
 * yearly billing at that point.
 */
router.post("/activate-subscription", requireRole("admin"), async (req, res) => {
  if (process.env.PAYMENTS_ENABLED !== "true") {
    return res.status(503).json({ error: "payments_temporarily_disabled" });
  }
  const { moyasarToken, interval } = req.body;
  if (!moyasarToken) return res.status(400).json({ error: "missing_payment_token" });
  const billingInterval = interval === "yearly" ? "yearly" : "monthly";

  const orgId = req.user.organizationId;
  const client = await pool.connect();
  try {
    const orgRes = await client.query("SELECT * FROM organizations WHERE id = $1", [orgId]);
    const org = orgRes.rows[0];
    if (!org) return res.status(404).json({ error: "organization_not_found" });

    const amountSar =
      billingInterval === "yearly" ? yearlyPriceFor(org.plan_price_sar) : Number(org.plan_price_sar);

    const payment = await createMoyasarPayment({
      amountHalalas: Math.round(amountSar * 100),
      source: { type: "token", token: moyasarToken },
      description: `اشتراك ركائز - ${org.name} - ${billingInterval === "yearly" ? "سنوي" : "شهري"} - أول دورة فوترة`,
      saveCard: true, // <- this is what unlocks unattended renewals later
    });

    if (payment.status !== "paid") {
      return res.status(402).json({ error: "payment_not_completed", status: payment.status });
    }

    const reusableToken = payment.source?.token;
    if (!reusableToken) {
      // Charged the customer but Moyasar didn't hand back a reusable token —
      // don't silently pretend recurring billing is set up when it isn't.
      console.error("Moyasar did not return a reusable token despite save_card:true", payment);
      return res.status(500).json({
        error: "no_reusable_token",
        message: "تم الدفع لكن تعذّر حفظ البطاقة للتجديد التلقائي — يرجى المحاولة مرة أخرى أو التواصل مع الدعم.",
      });
    }

    const intervalSql = billingInterval === "yearly" ? "interval '1 year'" : "interval '1 month'";
    await client.query(
      `UPDATE organizations
       SET moyasar_card_token = $1, subscription_status = 'active',
           billing_interval = $2, next_billing_at = now() + ${intervalSql}
       WHERE id = $3`,
      [reusableToken, billingInterval, orgId]
    );

    res.json({
      ok: true,
      message:
        billingInterval === "yearly"
          ? "تم تفعيل الاشتراك السنوي — سيتم التجديد تلقائياً كل سنة بدون أي إجراء منك."
          : "تم تفعيل الاشتراك الشهري — سيتم التجديد تلقائياً كل شهر بدون أي إجراء منك.",
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "activation_failed" });
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
