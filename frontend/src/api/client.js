const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

// One-time migration from the old persistent browser session. The access
// token remains available in this tab, then is removed from localStorage so
// closing the browser ends the session instead of leaving a long-lived JWT.
const legacyToken = localStorage.getItem("token");
if (legacyToken && !sessionStorage.getItem("token")) sessionStorage.setItem("token", legacyToken);
localStorage.removeItem("token");

async function postPaymentWithRetry(url, body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!(res.status === 409 && data.retryable && attempt === 0)) return data;
    const retryAfterSeconds = Math.min(3, Math.max(1, Number(res.headers.get("Retry-After") || 1)));
    await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
  }
  return { error: "payment_processing_in_progress" };
}

function authHeaders() {
  const token = sessionStorage.getItem("token");
  const deviceToken = localStorage.getItem("deviceToken");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(deviceToken ? { "X-Device-Token": deviceToken } : {}),
  };
}

export async function login(email, password, organizationCode) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, organizationCode }),
  });
  const data = await res.json();
  if (data.token) sessionStorage.setItem("token", data.token);
  return data;
}

export async function register(payload) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.token) sessionStorage.setItem("token", data.token);
  return data;
}

export async function acceptInvitation(token, name, password) {
  const res = await fetch(`${BASE}/auth/accept-invitation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name, password }),
  });
  const data = await res.json();
  if (data.token) sessionStorage.setItem("token", data.token);
  return data;
}

export async function getCurrentUser() {
  const res = await fetch(`${BASE}/auth/me`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user || null;
}

export function logout() {
  sessionStorage.removeItem("token");
  localStorage.removeItem("token");
  localStorage.removeItem("deviceToken");
  sessionStorage.removeItem("rakaez_pending_payment");
}

export async function searchParts(q, type = "name") {
  // every shop's catalog is private now (multi-tenant), so this requires login
  const res = await fetch(`${BASE}/parts/search?q=${encodeURIComponent(q)}&type=${type}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function getVehicles() {
  const res = await fetch(`${BASE}/vehicles`, { headers: authHeaders() });
  return res.json();
}

export async function saveVehicle(payload) {
  const res = await fetch(`${BASE}/vehicles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteVehicle(id) {
  const res = await fetch(`${BASE}/vehicles/${id}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export async function checkout(branchId, items) {
  const res = await fetch(`${BASE}/sales/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ branchId, items }),
  });
  return res.json();
}

/** Customer checkout: the server verifies the hosted-form payment, then creates the invoice. */
export async function checkoutOnline(branchId, items, paymentId, requestReference) {
  return postPaymentWithRetry(`${BASE}/sales/checkout-online`, { branchId, items, paymentId, requestReference });
}

export async function getAdminStats() {
  const res = await fetch(`${BASE}/admin/stats`, { headers: authHeaders() });
  return res.json();
}

export async function createInvitation(email, role, branchId) {
  const res = await fetch(`${BASE}/admin/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email, role, branchId: branchId || null }),
  });
  return res.json();
}

export async function getBranchesSummary() {
  const res = await fetch(`${BASE}/admin/branches-summary`, { headers: authHeaders() });
  return res.json();
}

export async function createBranch(name, city) {
  const res = await fetch(`${BASE}/admin/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, city }),
  });
  return res.json();
}

export async function getInventoryMovements() {
  const res = await fetch(`${BASE}/admin/inventory-movements`, { headers: authHeaders() });
  return res.json();
}

export async function getOrganization() {
  const res = await fetch(`${BASE}/admin/organization`, { headers: authHeaders() });
  return res.json();
}

export async function updateOrganization(name, vatNumber) {
  const res = await fetch(`${BASE}/admin/organization`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, vatNumber }),
  });
  return res.json();
}

export async function getAllParts() {
  const res = await fetch(`${BASE}/parts`, { headers: authHeaders() });
  return res.json();
}

export async function createPart(payload) {
  const res = await fetch(`${BASE}/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function previewPartsImport(rows, mode) {
  const res = await fetch(`${BASE}/parts/import/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows, mode }),
  });
  return res.json();
}

export async function commitPartsImport(rows, mode, branchId) {
  const res = await fetch(`${BASE}/parts/import/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows, mode, branchId }),
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

export async function issueInventory(partId, quantity, note) {
  const res = await fetch(`${BASE}/parts/${partId}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ quantity, note }),
  });
  return res.json();
}

export async function findPartsByShelf(code) {
  const res = await fetch(`${BASE}/parts/shelf-lookup?code=${encodeURIComponent(code)}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function findWarehouseParts(query) {
  const res = await fetch(`${BASE}/parts/warehouse-lookup?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function getWarehouseLowStock() {
  const res = await fetch(`${BASE}/parts/warehouse-low-stock`, { headers: authHeaders() });
  return res.json();
}

export async function getInvoices() {
  const res = await fetch(`${BASE}/sales/invoices`, { headers: authHeaders() });
  return res.json();
}

export async function getBillingStatus() {
  const res = await fetch(`${BASE}/billing/status`, { headers: authHeaders() });
  return res.json();
}

/**
 * Verifies the hosted-form payment, saves its reusable card token, and
 * activates recurring billing. `interval` is 'monthly' or 'yearly'.
 */
export async function activateSubscription(paymentId, requestReference, interval = "monthly") {
  return postPaymentWithRetry(`${BASE}/billing/activate-subscription`, {
    paymentId,
    requestReference,
    interval,
  });
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

export async function createDevicePairingCode(branchId, deviceName) {
  const res = await fetch(`${BASE}/devices/pairing-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ branchId, deviceName }),
  });
  return res.json();
}

export async function getDevices() {
  const res = await fetch(`${BASE}/devices`, { headers: authHeaders() });
  return res.json();
}

export async function revokeDevice(id) {
  const res = await fetch(`${BASE}/devices/${id}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export async function previewSaudiStarterCatalog() {
  const res = await fetch(`${BASE}/catalog/saudi-starter/preview`, { headers: authHeaders() });
  return res.json();
}

export async function importSaudiStarterCatalog() {
  const res = await fetch(`${BASE}/catalog/saudi-starter/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ confirm: true }),
  });
  return res.json();
}

export function isDevicePaired() {
  return Boolean(localStorage.getItem("deviceToken"));
}

export async function pairDevice(code) {
  const res = await fetch(`${BASE}/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (data.deviceToken) localStorage.setItem("deviceToken", data.deviceToken);
  return data;
}
