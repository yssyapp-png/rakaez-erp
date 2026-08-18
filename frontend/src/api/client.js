const BASE = "/api";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(email, password, organizationId) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, organizationId }),
  });
  const data = await res.json();
  if (data.token) localStorage.setItem("token", data.token);
  return data;
}

export async function register(payload) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.token) localStorage.setItem("token", data.token);
  return data;
}

export function logout() {
  localStorage.removeItem("token");
}

export async function searchParts(q, type = "name") {
  // every shop's catalog is private now (multi-tenant), so this requires login
  const res = await fetch(`${BASE}/parts/search?q=${encodeURIComponent(q)}&type=${type}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  // Backend now returns { items, page, pageSize } for pagination — unwrap
  // here so callers (CustomerView, SellerView) keep working unchanged.
  return data.items ?? data;
}

export async function checkout(branchId, items) {
  const res = await fetch(`${BASE}/sales/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ branchId, items }),
  });
  return res.json();
}

/** Customer-facing checkout: charges the card via Moyasar server-side, then creates the invoice. */
export async function checkoutOnline(branchId, items, moyasarToken) {
  const res = await fetch(`${BASE}/sales/checkout-online`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ branchId, items, moyasarToken }),
  });
  return res.json();
}

export async function getAdminStats() {
  const res = await fetch(`${BASE}/admin/stats`, { headers: authHeaders() });
  return res.json();
}

export async function getBranchesSummary() {
  const res = await fetch(`${BASE}/admin/branches-summary`, { headers: authHeaders() });
  return res.json();
}

export async function getOrganization() {
  const res = await fetch(`${BASE}/admin/organization`, { headers: authHeaders() });
  return res.json();
}

export async function getAllParts() {
  const res = await fetch(`${BASE}/parts`, { headers: authHeaders() });
  const data = await res.json();
  return data.items ?? data;
}

export async function createPart(payload) {
  const res = await fetch(`${BASE}/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function updatePart(id, payload) {
  const res = await fetch(`${BASE}/parts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deletePart(id) {
  const res = await fetch(`${BASE}/parts/${id}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export async function updateInventory(partId, payload) {
  const res = await fetch(`${BASE}/parts/${partId}/inventory`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getInvoices() {
  const res = await fetch(`${BASE}/sales/invoices`, { headers: authHeaders() });
  const data = await res.json();
  return data.items ?? data;
}

export async function getBillingStatus() {
  const res = await fetch(`${BASE}/billing/status`, { headers: authHeaders() });
  return res.json();
}

/**
 * Saves the card (reusable token) and charges the first billing cycle now —
 * every renewal after this is fully automatic. `interval` is 'monthly' or
 * 'yearly'; defaults to monthly on the server if omitted.
 */
export async function activateSubscription(moyasarToken, interval = "monthly") {
  const res = await fetch(`${BASE}/billing/activate-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ moyasarToken, interval }),
  });
  return res.json();
}

/** Switches an already-active subscription's billing cycle for the NEXT renewal (no proration). */
export async function changeBillingInterval(interval) {
  const res = await fetch(`${BASE}/billing/change-interval`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ interval }),
  });
  return res.json();
}
