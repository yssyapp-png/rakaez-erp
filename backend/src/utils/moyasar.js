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
import { secureOutboundFetch } from "./outbound-policy.js";

const MOYASAR_ORIGIN = "https://api.moyasar.com";
const MOYASAR_API = `${MOYASAR_ORIGIN}/v1`;
const configuredTimeout = Number(process.env.MOYASAR_TIMEOUT_MS || 15000);
const MOYASAR_TIMEOUT_MS = Number.isFinite(configuredTimeout)
  ? Math.min(30000, Math.max(3000, configuredTimeout))
  : 15000;
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

async function moyasarRequest(path, options = {}) {
  const secretKey = process.env.MOYASAR_SECRET_KEY;
  if (!secretKey) throw new Error("moyasar_not_configured");

  const response = await secureOutboundFetch(`${MOYASAR_API}${path}`, {
    allowedOrigins: [MOYASAR_ORIGIN],
    timeoutMs: MOYASAR_TIMEOUT_MS,
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: authorizationHeader(secretKey),
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: "invalid_moyasar_response" };
    }
  }
  return { response, data };
}

export async function fetchMoyasarPayment(paymentId) {
  if (!isUuid(paymentId)) {
    throw new Error("invalid_payment_reference");
  }
  const { response, data } = await moyasarRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (!response.ok) throw new Error(data?.message || "payment_verification_failed");
  return data;
}

export async function createMoyasarPayment({ amountHalalas, source, description, currency = "SAR", givenId, metadata, callbackUrl }) {
  if (!isUuid(givenId)) throw new Error("invalid_payment_idempotency_key");
  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new Error("invalid_moyasar_callback_url");
  }
  if (process.env.NODE_ENV === "production" && callback.protocol !== "https:") {
    throw new Error("moyasar_callback_https_required");
  }

  const { response, data } = await moyasarRequest("/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountHalalas, // Moyasar amounts are in halalas (SAR * 100)
      given_id: givenId,
      ...(metadata ? { metadata } : {}),
      currency,
      description,
      callback_url: callback.toString(),
      source, // { type: 'token', token: '<token from Moyasar.js, or a previously saved reusable token>' }
    }),
  });

  if (!response.ok) {
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
  if (!isUuid(paymentId) || !Number.isInteger(Number(amountHalalas)) || Number(amountHalalas) <= 0) {
    return { ok: false, error: "invalid_refund_request" };
  }

  try {
    const { response, data } = await moyasarRequest(`/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amountHalalas }),
    });

    if (!response.ok) {
      // Surface but don't throw — the caller is already in an error path and
      // needs to know refund failed too, without masking the original error.
      console.error("Moyasar refund failed", { status: response.status });
      return { ok: false, data };
    }
    return { ok: true, data };
  } catch (error) {
    console.error("Moyasar refund request failed", { message: String(error?.message || "refund_request_failed").slice(0, 120) });
    return { ok: false, error: error.message || "refund_request_failed" };
  }
}

/**
 * Re-fetches the provider state immediately before a compensating refund.
 * A stale in-memory payment object must never be used to calculate a second
 * refund after a timeout or retry.
 */
export async function refundOutstandingMoyasarPayment(paymentId) {
  try {
    const current = await fetchMoyasarPayment(paymentId);
    const amount = refundableAmount(current);
    if (amount === 0) {
      return { ok: current?.status === "refunded" || Number(current?.refunded || 0) > 0, alreadySettled: true, data: current };
    }
    return refundMoyasarPayment(paymentId, amount);
  } catch (error) {
    console.error("Moyasar refund reconciliation failed", { message: String(error?.message || "refund_reconciliation_failed").slice(0, 120) });
    return { ok: false, error: error.message || "refund_reconciliation_failed" };
  }
}
