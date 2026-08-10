const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

function authHeaders() {
  const token = localStorage.getItem("token");
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

export async function getCurrentUser() {
  const res = await fetch(`${BASE}/auth/me`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user || null;
}

export function logout() {
  localStorage.removeItem("token");
}

export async function searchParts(q, type = "name") {
  // every shop's catalog is private now (multi-tenant), so this requires login
  const res = await fetch(`${BASE}/parts/search?q=${encodeURIComponent(q)}&type=${type}`, {
    headers: authHeaders(),
  });
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

export async function getInventoryMovements() {
  const res = await fetch(`${BASE}/admin/inventory-movements`, { headers: authHeaders() });
  return res.json();
}

export async function getOrganization() {
  const res = await fetch(`${BASE}/admin/organization`, { headers: authHeaders() });
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

export async function getInvoices() {
  const res = await fetch(`${BASE}/sales/invoices`, { headers: authHeaders() });
  return res.json();
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
