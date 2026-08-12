/**
 * Minimal Moyasar payment gateway client (Saudi-focused card/Mada/Apple Pay
 * processor). Docs: https://docs.moyasar.com
 *
 * Flow used here:
 *  1. Moyasar's hosted form creates the payment without exposing card data
 *     to Rakaez.
 *  2. The frontend sends only the payment id and an idempotency reference.
 *  3. The backend retrieves the payment with its secret key and verifies
 *     status, amount, currency, and ownership metadata before fulfillment.
 *
 * Requires MOYASAR_SECRET_KEY in the environment. Without it, checkout will
 * fail loudly instead of silently pretending to charge the customer.
 */
const MOYASAR_API = "https://api.moyasar.com/v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function authorizationHeader(secretKey) {
  return "Basic " + Buffer.from(`${secretKey}:`).toString("base64");
}

export function paymentMatches(payment, amountHalalas, currency = "SAR") {
  const expectedAmount = Number(amountHalalas);
  const paymentAmount = Number(payment?.amount);
  const refundedAmount = Number(payment?.refunded || 0);
  const fullySettled = payment?.status === "paid" ||
    (payment?.status === "captured" && Number(payment?.captured) === expectedAmount);
  return Boolean(
    payment &&
    fullySettled &&
    paymentAmount === expectedAmount &&
    refundedAmount === 0 &&
    payment.currency === currency
  );
}

export function refundableAmount(payment) {
  if (!payment || !["paid", "captured"].includes(payment.status)) return 0;
  const settledAmount = payment.status === "captured" ? Number(payment.captured) : Number(payment.amount);
  const refundedAmount = Number(payment.refunded || 0);
  const remaining = settledAmount - refundedAmount;
  return Number.isInteger(remaining) && remaining > 0 ? remaining : 0;
}

export async function fetchMoyasarPayment(paymentId) {
  const secretKey = process.env.MOYASAR_SECRET_KEY;
  if (!secretKey) throw new Error("moyasar_not_configured");
  if (!isUuid(paymentId)) {
    throw new Error("invalid_payment_reference");
  }
  const res = await fetch(`${MOYASAR_API}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authorizationHeader(secretKey) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "payment_verification_failed");
  return data;
}

export async function createMoyasarPayment({ amountHalalas, source, description, currency = "SAR", givenId, metadata }) {
  const secretKey = process.env.MOYASAR_SECRET_KEY;
  if (!secretKey) {
    throw new Error("moyasar_not_configured");
  }

  const res = await fetch(`${MOYASAR_API}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorizationHeader(secretKey),
    },
    body: JSON.stringify({
      amount: amountHalalas, // Moyasar amounts are in halalas (SAR * 100)
      ...(givenId ? { given_id: givenId } : {}),
      ...(metadata ? { metadata } : {}),
      currency,
      description,
      source, // { type: 'token', token: '<token from Moyasar.js, or a previously saved reusable token>' }
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = data?.message || "payment_failed";
    throw new Error(message);
  }
  return data;
}

/**
 * Refunds a previously captured payment. Used when a card charge succeeds
 * but we then fail to reserve inventory (race condition: someone else sold
 * the last unit between price-check and stock update) — the customer must
 * not be left charged for an order we can't actually fulfill.
 */
export async function refundMoyasarPayment(paymentId, amountHalalas) {
  const secretKey = process.env.MOYASAR_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "moyasar_not_configured" };

  try {
    const res = await fetch(`${MOYASAR_API}/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorizationHeader(secretKey),
      },
      body: JSON.stringify({ amount: amountHalalas }),
    });

    const data = await res.json();
    if (!res.ok) {
      // Surface but don't throw — the caller is already in an error path and
      // needs to know refund failed too, without masking the original error.
      console.error("Moyasar refund failed:", data);
      return { ok: false, data };
    }
    return { ok: true, data };
  } catch (error) {
    console.error("Moyasar refund request failed:", error);
    return { ok: false, error: error.message || "refund_request_failed" };
  }
}
