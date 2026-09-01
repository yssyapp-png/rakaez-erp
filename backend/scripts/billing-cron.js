/**
 * Recurring subscription billing — run this once a day on a schedule
 * (system cron, or a hosted scheduler like Railway Cron / GitHub Actions
 * cron once the backend is deployed). It is intentionally a standalone
 * script, not an HTTP endpoint, so it can never be triggered by a stray web
 * request — only by whatever schedules it on the server.
 *
 * What it does, in order, for every organization:
 *
 * 1. Trial expired with NO saved payment method → mark subscription
 *    'past_due' so the app can show a "add payment method" banner. We do
 *    NOT lock the account out immediately; that's a product decision you
 *    can tighten later (e.g. read-only mode after N days past_due).
 *
 * 2. Active subscription whose next_billing_at has arrived AND a saved
 *    card token exists → charge the org automatically using that saved
 *    token (source: {type:'token', token: ...}) with NO customer present,
 *    exactly like Apple/Google subscription renewals. The amount and how
 *    far next_billing_at moves forward both depend on billing_interval:
 *    'monthly' charges plan_price_sar and adds 1 month; 'yearly' charges
 *    10x plan_price_sar (see YEARLY_MONTHS_CHARGED in billing.js — kept in
 *    sync here) and adds 1 year. On failure (card declined, expired, etc.),
 *    mark 'past_due' instead of silently retrying forever.
 *
 * Run manually to test: `node scripts/billing-cron.js`
 * Example crontab entry (once daily at 3am): 0 3 * * * cd /path/to/backend && node scripts/billing-cron.js >> billing.log 2>&1
 */
import dotenv from "dotenv";
import crypto from "crypto";
import { pool } from "../src/db/pool.js";
import { createMoyasarPayment, paymentMatches, refundOutstandingMoyasarPayment } from "../src/utils/moyasar.js";

dotenv.config();
if (process.env.PAYMENTS_ENABLED !== "true") {
  console.log("[billing-cron] payments are disabled; no subscription charges were attempted");
  process.exit(0);
}
if (!process.env.MOYASAR_SECRET_KEY) {
  console.error("[billing-cron] MOYASAR_SECRET_KEY is required when payments are enabled");
  process.exit(1);
}

// Kept identical to billing.js's YEARLY_MONTHS_CHARGED on purpose — a yearly
// renewal must charge the same amount as a fresh yearly activation would.
const YEARLY_MONTHS_CHARGED = 10;

async function markTrialsExpiredWithoutPayment(db) {
  const r = await db.query(
    `UPDATE organizations
     SET subscription_status = 'past_due'
     WHERE subscription_status = 'trialing'
       AND trial_ends_at IS NOT NULL AND trial_ends_at < now()
       AND moyasar_card_token IS NULL
     RETURNING id, name`
  );
  for (const org of r.rows) {
    console.log(`[billing-cron] trial expired without payment method: org ${org.id} (${org.name}) -> past_due`);
  }
}

async function chargeDueRenewals(db) {
  const due = await db.query(
    `SELECT * FROM organizations
     WHERE subscription_status = 'active'
       AND moyasar_card_token IS NOT NULL
       AND next_billing_at IS NOT NULL AND next_billing_at < now()`
  );

  for (const org of due.rows) {
    const isYearly = org.billing_interval === "yearly";
    const amountSar = isYearly ? Number(org.plan_price_sar) * YEARLY_MONTHS_CHARGED : Number(org.plan_price_sar);
    const intervalSql = isYearly ? "interval '1 year'" : "interval '1 month'";

    const proposedGivenId = crypto.randomUUID();
    const attempt = await db.query(
      `INSERT INTO billing_renewal_attempts
       (organization_id, scheduled_for, given_id, amount_halalas, billing_interval)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, scheduled_for) DO UPDATE SET updated_at = billing_renewal_attempts.updated_at
       RETURNING id, given_id, status`,
      [org.id, org.next_billing_at, proposedGivenId, Math.round(amountSar * 100), org.billing_interval]
    );
    if (attempt.rows[0].status !== "pending") continue;
    const givenId = attempt.rows[0].given_id;

    try {
      const payment = await createMoyasarPayment({
        amountHalalas: Math.round(amountSar * 100),
        source: { type: "token", token: org.moyasar_card_token },
        description: `تجديد اشتراك ركائز - ${org.name} - ${isYearly ? "سنوي" : "شهري"}`,
        givenId,
        callbackUrl: process.env.MOYASAR_CALLBACK_URL,
        metadata: {
          rakaez_purpose: "subscription_renewal",
          rakaez_organization_id: String(org.id),
          rakaez_scheduled_for: new Date(org.next_billing_at).toISOString(),
        },
      });

      if (paymentMatches(payment, Math.round(amountSar * 100), "SAR")) {
        try {
          await db.query("BEGIN");
          await db.query(
            `INSERT INTO subscription_payments
             (organization_id, payment_reference, purpose, amount_halalas, currency, billing_interval, status)
             VALUES ($1,$2,'renewal',$3,'SAR',$4,'paid')
             ON CONFLICT (payment_reference) DO NOTHING`,
            [org.id, payment.id, Math.round(amountSar * 100), org.billing_interval]
          );
          await db.query(
            `UPDATE organizations SET next_billing_at = next_billing_at + ${intervalSql}, subscription_status = 'active'
             WHERE id = $1 AND next_billing_at = $2`,
            [org.id, org.next_billing_at]
          );
          await db.query(
            `UPDATE billing_renewal_attempts SET status='paid', payment_reference=$1, updated_at=now()
             WHERE id=$2`,
            [payment.id, attempt.rows[0].id]
          );
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK").catch(() => {});
          throw error;
        }
        console.log(`[billing-cron] renewed org ${org.id} (${org.name}, ${org.billing_interval}) successfully`);
      } else {
        const isSettled = ["paid", "captured"].includes(payment.status);
        const refund = isSettled
          ? await refundOutstandingMoyasarPayment(payment.id)
          : null;
        try {
          await db.query("BEGIN");
          await db.query(`UPDATE organizations SET subscription_status = 'past_due' WHERE id = $1`, [org.id]);
          await db.query(
            `UPDATE billing_renewal_attempts SET status='failed', payment_reference=$1, error_message=$2, updated_at=now()
             WHERE id=$3`,
            [payment.id || null, `payment_status:${payment.status};refunded:${refund?.ok ?? false}`, attempt.rows[0].id]
          );
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK").catch(() => {});
          throw error;
        }
        console.warn(`[billing-cron] renewal not paid for org ${org.id} (${org.name}): status=${payment.status}`);
      }
    } catch (err) {
      await db.query(
        `UPDATE billing_renewal_attempts SET error_message=$1, updated_at=now() WHERE id=$2`,
        [String(err.message || "renewal_failed").slice(0, 500), attempt.rows[0].id]
      );
      console.error(`[billing-cron] renewal FAILED for org ${org.id} (${org.name}):`, err.message);
      // Keep the attempt pending. A later scheduled run reuses the same
      // Moyasar given_id, so a timeout can be recovered idempotently without
      // creating a second charge. Declined payments are marked failed above
      // and require a future dunning policy rather than an immediate retry.
    }
  }
}

async function main() {
  console.log(`[billing-cron] run started ${new Date().toISOString()}`);
  const lockClient = await pool.connect();
  let lockHeld = false;
  try {
    const lock = await lockClient.query("SELECT pg_try_advisory_lock(731954202) AS acquired");
    lockHeld = Boolean(lock.rows[0]?.acquired);
    if (!lockHeld) {
      console.log("[billing-cron] another billing run is active; exiting without charging");
      return;
    }
    await markTrialsExpiredWithoutPayment(lockClient);
    await chargeDueRenewals(lockClient);
    console.log(`[billing-cron] run finished`);
  } finally {
    if (lockHeld) await lockClient.query("SELECT pg_advisory_unlock(731954202)").catch(() => {});
    lockClient.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[billing-cron] fatal error:", err);
  process.exit(1);
});
