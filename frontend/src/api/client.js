const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

// Authentication is held only in a Secure, HttpOnly, SameSite cookie issued
// by the API. Remove legacy JavaScript-readable tokens during the upgrade.
localStorage.removeItem("token");
sessionStorage.removeItem("token");

async function apiFetch(url, options = {}) {
  return globalThis.fetch(url, { credentials: "include", ...options });
}

async function postPaymentWithRetry(url, body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await apiFetch(url, {
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
  return {};
}

export async function login(email, password, organizationCode) {
  const res = await apiFetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, organizationCode }),
  });
  return res.json();
}

export async function register(payload) {
  const res = await apiFetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function acceptInvitation(token, name, password) {
  const res = await apiFetch(`${BASE}/auth/accept-invitation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name, password }),
  });
  return res.json();
}

export async function getCurrentUser() {
  const res = await apiFetch(`${BASE}/auth/me`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user || null;
}

function clearLocalSession() {
  sessionStorage.removeItem("token");
  localStorage.removeItem("token");
  localStorage.removeItem("deviceToken"); // remove legacy JavaScript-readable device tokens
  sessionStorage.removeItem("rakaez_pending_payment");
}

export async function logout() {
  try {
    await apiFetch(`${BASE}/auth/logout`, { method: "POST", headers: authHeaders() });
  } finally {
    clearLocalSession();
  }
}

export async function getSessions() {
  const res = await apiFetch(`${BASE}/auth/sessions`, { headers: authHeaders() });
  return res.json();
}

export async function revokeSession(id) {
  const res = await apiFetch(`${BASE}/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await res.json();
  if (data.currentSessionRevoked) clearLocalSession();
  return data;
}

export async function revokeOtherSessions() {
  const res = await apiFetch(`${BASE}/auth/sessions/revoke-others`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  return res.json();
}

export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch(`${BASE}/auth/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return res.json();
}

export async function searchParts(q, type = "name") {
  // every shop's catalog is private now (multi-tenant), so this requires login
  const res = await apiFetch(`${BASE}/parts/search?q=${encodeURIComponent(q)}&type=${type}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function searchBranchAvailability(q, type = "all") {
  const params = new URLSearchParams({ q, type });
  const res = await apiFetch(`${BASE}/parts/branch-availability?${params.toString()}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function getVehicles() {
  const res = await apiFetch(`${BASE}/vehicles`, { headers: authHeaders() });
  return res.json();
}

export async function saveVehicle(payload) {
  const res = await apiFetch(`${BASE}/vehicles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteVehicle(id) {
  const res = await apiFetch(`${BASE}/vehicles/${id}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export async function checkout(branchId, items) {
  const res = await apiFetch(`${BASE}/sales/checkout`, {
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
  const res = await apiFetch(`${BASE}/admin/stats`, { headers: authHeaders() });
  return res.json();
}

export async function createInvitation(email, role, branchId) {
  const res = await apiFetch(`${BASE}/admin/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email, role, branchId: branchId || null }),
  });
  return res.json();
}

export async function getBranchesSummary() {
  const res = await apiFetch(`${BASE}/admin/branches-summary`, { headers: authHeaders() });
  return res.json();
}

export async function createBranch(name, city) {
  const res = await apiFetch(`${BASE}/admin/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, city }),
  });
  return res.json();
}

export async function getInventoryMovements() {
  const res = await apiFetch(`${BASE}/admin/inventory-movements`, { headers: authHeaders() });
  return res.json();
}

export async function getOrganization() {
  const res = await apiFetch(`${BASE}/admin/organization`, { headers: authHeaders() });
  return res.json();
}

export async function updateOrganization(name, vatNumber, commercialRegistrationNumber) {
  const res = await apiFetch(`${BASE}/admin/organization`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, vatNumber, commercialRegistrationNumber }),
  });
  return res.json();
}

export async function getComplianceStatus() {
  const res = await apiFetch(`${BASE}/compliance/status`, { headers: authHeaders() });
  return res.json();
}

export async function getSuppliers() {
  const res = await apiFetch(`${BASE}/procurement/suppliers`, { headers: authHeaders() });
  return res.json();
}

export async function createSupplier(payload) {
  const res = await apiFetch(`${BASE}/procurement/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function updateSupplier(id, payload) {
  const res = await apiFetch(`${BASE}/procurement/suppliers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getPurchaseOrders() {
  const res = await apiFetch(`${BASE}/procurement/purchase-orders`, { headers: authHeaders() });
  return res.json();
}

export async function createPurchaseOrder(payload) {
  const res = await apiFetch(`${BASE}/procurement/purchase-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function approvePurchaseOrder(id) {
  const res = await apiFetch(`${BASE}/procurement/purchase-orders/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  return res.json();
}

export async function cancelPurchaseOrder(id) {
  const res = await apiFetch(`${BASE}/procurement/purchase-orders/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  return res.json();
}

export async function receivePurchaseOrder(id, items, note = "", receiptReference = crypto.randomUUID()) {
  const res = await apiFetch(`${BASE}/procurement/purchase-orders/${id}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ receiptReference, items, note }),
  });
  return res.json();
}

export async function getInventoryTransfers() {
  const res = await apiFetch(`${BASE}/transfers`, { headers: authHeaders() });
  return res.json();
}

export async function createInventoryTransfer(payload, requestReference = crypto.randomUUID()) {
  const res = await apiFetch(`${BASE}/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ...payload, requestReference }),
  });
  return res.json();
}

export async function cancelInventoryTransfer(id) {
  const res = await apiFetch(`${BASE}/transfers/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  return res.json();
}

export async function shipInventoryTransfer(id, shipmentReference = crypto.randomUUID()) {
  const res = await apiFetch(`${BASE}/transfers/${id}/ship`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ shipmentReference }),
  });
  return res.json();
}

export async function receiveInventoryTransfer(id, items, receiptNote = "", receiptReference = crypto.randomUUID()) {
  const res = await apiFetch(`${BASE}/transfers/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ items, receiptNote, receiptReference }),
  });
  return res.json();
}

export async function getAllParts() {
  const res = await apiFetch(`${BASE}/parts`, { headers: authHeaders() });
  return res.json();
}

export async function createPart(payload) {
  const res = await apiFetch(`${BASE}/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function previewPartsImport(rows, mode) {
  const res = await apiFetch(`${BASE}/parts/import/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows, mode }),
  });
  return res.json();
}

export async function commitPartsImport(rows, mode, branchId) {
  const res = await apiFetch(`${BASE}/parts/import/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows, mode, branchId }),
  });
  return res.json();
}

export async function updatePart(id, payload) {
  const res = await apiFetch(`${BASE}/parts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deletePart(id) {
  const res = await apiFetch(`${BASE}/parts/${id}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export async function updateInventory(partId, payload) {
  const res = await apiFetch(`${BASE}/parts/${partId}/inventory`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function issueInventory(partId, quantity, note) {
  const res = await apiFetch(`${BASE}/parts/${partId}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ quantity, note }),
  });
  return res.json();
}

export async function findPartsByShelf(code) {
  const res = await apiFetch(`${BASE}/parts/shelf-lookup?code=${encodeURIComponent(code)}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function findWarehouseParts(query) {
  const res = await apiFetch(`${BASE}/parts/warehouse-lookup?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  return res.json();
}

export async function getWarehouseLowStock() {
  const res = await apiFetch(`${BASE}/parts/warehouse-low-stock`, { headers: authHeaders() });
  return res.json();
}

export async function getInvoices(page = 1, pageSize = 50) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  const res = await apiFetch(`${BASE}/sales/invoices?${params.toString()}`, {
    headers: authHeaders(),
  });

  const data = await res.json();
  return data.items ?? data;
}

export async function getBillingStatus() {
  const res = await apiFetch(`${BASE}/billing/status`, { headers: authHeaders() });
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
  const res = await apiFetch(`${BASE}/billing/change-interval`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ interval }),
  });
  return res.json();
}

export async function createDevicePairingCode(branchId, deviceName) {
  const res = await apiFetch(`${BASE}/devices/pairing-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ branchId, deviceName }),
  });
  return res.json();
}

export async function getDevices() {
  const res = await apiFetch(`${BASE}/devices`, { headers: authHeaders() });
  return res.json();
}

export async function revokeDevice(id) {
  const res = await apiFetch(`${BASE}/devices/${id}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export async function previewSaudiStarterCatalog() {
  const res = await apiFetch(`${BASE}/catalog/saudi-starter/preview`, { headers: authHeaders() });
  return res.json();
}

export async function getCatalogProviders() {
  const res = await apiFetch(`${BASE}/catalog/providers`, { headers: authHeaders() });
  return res.json();
}

export async function importSaudiStarterCatalog() {
  const res = await apiFetch(`${BASE}/catalog/saudi-starter/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ confirm: true }),
  });
  return res.json();
}

export async function isDevicePaired() {
  const res = await apiFetch(`${BASE}/devices/status`, { headers: authHeaders() });
  return res.ok;
}

export async function pairDevice(code) {
  const res = await apiFetch(`${BASE}/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return res.json();
}
