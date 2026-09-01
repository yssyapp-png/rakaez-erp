import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("customer UI shows branch availability without internal shelf or exact stock", async () => {
  const source = await fs.readFile(new URL("../src/pages/CustomerView.jsx", import.meta.url), "utf8");
  assert.match(source, /متوفر في/);
  assert.doesNotMatch(source, /inv\.shelf_number/);
  assert.doesNotMatch(source, /inv\.quantity/);
});

test("hosted payment form sends ownership metadata and uses a stable callback", async () => {
  const source = await fs.readFile(new URL("../src/components/MoyasarCheckout.jsx", import.meta.url), "utf8");
  const loader = await fs.readFile(new URL("../src/payments/loadMoyasar.js", import.meta.url), "utf8");
  assert.match(source, /on_initiating/);
  assert.match(source, /initiating\.current/);
  assert.match(source, /useEffect\(\(\) => \{/);
  assert.match(source, /metadata: configuration\.paymentMetadata/);
  assert.match(source, /amount: Math\.round\(configuration\.amountSar \* 100\)/);
  assert.match(source, /description: configuration\.description/);
  assert.match(source, /window\.location\.origin/);
  assert.match(source, /credit_card: \{ save_card: true \}/);
  assert.match(source, /on_failure/);
  assert.match(source, /supported_networks: \["mada", "visa", "mastercard"\]/);
  assert.match(loader, /MOYASAR_FORM_VERSION = "2\.2\.10"/);
  assert.match(loader, /moyasar_load_timeout/);
});

test("payment settlement retries only the server's explicit in-progress response", async () => {
  const source = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  assert.match(source, /postPaymentWithRetry/);
  assert.match(source, /res\.status === 409 && data\.retryable/);
  assert.match(source, /Retry-After/);
  assert.match(source, /checkout-online.*postPaymentWithRetry/s);
  assert.match(source, /activateSubscription[\s\S]+postPaymentWithRetry\(`\$\{BASE\}\/billing\/activate-subscription/);
});

test("customer checkout prevents a single order from mixing branches", async () => {
  const source = await fs.readFile(new URL("../src/pages/CustomerView.jsx", import.meta.url), "utf8");
  assert.match(source, /cart\[0\]\.branchId/);
  assert.match(source, /جميع قطع الطلب من فرع واحد/);
});

test("catalog management displays the real per-branch inventory value", async () => {
  const source = await fs.readFile(new URL("../src/pages/PartsManagementView.jsx", import.meta.url), "utf8");
  assert.match(source, /part\.inventory\?\.find/);
  assert.match(source, /defaultValue=/);
  assert.doesNotMatch(source, /defaultValue=\{0\}/);
});

test("staff onboarding exposes both administrator invitation and acceptance flows", async () => {
  const admin = await fs.readFile(new URL("../src/pages/AdminView.jsx", import.meta.url), "utf8");
  const login = await fs.readFile(new URL("../src/pages/LoginView.jsx", import.meta.url), "utf8");
  assert.match(admin, /createInvitation/);
  assert.match(admin, /warehouse_keeper/);
  assert.match(admin, /expires_at/);
  assert.match(admin, /#invite=/);
  assert.match(login, /acceptInvitation/);
  assert.match(login, /window\.location\.hash/);
  assert.match(login, /login_temporarily_blocked/);
});

test("administrator UI maintains VAT identity and creates branches", async () => {
  const source = await fs.readFile(new URL("../src/pages/AdminView.jsx", import.meta.url), "utf8");
  assert.match(source, /updateOrganization/);
  assert.match(source, /createBranch/);
  assert.match(source, /15 رقمًا/);
});

test("customers can save a vehicle and search its VIN without re-entering details", async () => {
  const source = await fs.readFile(new URL("../src/pages/CustomerView.jsx", import.meta.url), "utf8");
  assert.match(source, /saveVehicle/);
  assert.match(source, /getVehicles/);
  assert.match(source, /deleteVehicle/);
  assert.match(source, /searchSavedVehicle/);
});

test("logout clears user secrets and pending-payment state while retaining the server-protected paired device", async () => {
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(api, /removeItem\("deviceToken"\)/);
  assert.match(api, /sessionStorage\.removeItem\("token"\)/);
  assert.match(api, /localStorage\.removeItem\("token"\)/);
  assert.match(api, /removeItem\("rakaez_pending_payment"\)/);
  assert.match(app, /removeItem\("rakaez_pending_payment"\)/);
  assert.match(api, /apiFetch\(`\$\{BASE\}\/auth\/logout`/);
  assert.match(api, /credentials: "include"/);
  assert.doesNotMatch(api, /Authorization: `Bearer/);
});

test("web authentication uses an HttpOnly cookie and removes JavaScript-readable legacy tokens", async () => {
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  assert.match(api, /localStorage\.removeItem\("token"\)/);
  assert.match(api, /sessionStorage\.removeItem\("token"\)/);
  assert.doesNotMatch(api, /data\.token/);
  assert.doesNotMatch(api, /getItem\("token"\)/);
  assert.doesNotMatch(api, /getItem\("deviceToken"\)/);
  assert.doesNotMatch(api, /setItem\("deviceToken"\)/);
  assert.match(api, /\/devices\/status/);
});

test("Moyasar third-party assets fail closed without verified Subresource Integrity", async () => {
  const loader = await fs.readFile(new URL("../src/payments/loadMoyasar.js", import.meta.url), "utf8");
  assert.match(loader, /moyasar_integrity_required/);
  assert.match(loader, /script\.integrity = SCRIPT_INTEGRITY/);
  assert.match(loader, /stylesheet\.integrity = STYLE_INTEGRITY/);
  assert.match(loader, /crossOrigin = "anonymous"/);
});

test("account security UI lists and revokes server-side sessions", async () => {
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const view = await fs.readFile(new URL("../src/pages/SecurityView.jsx", import.meta.url), "utf8");
  assert.match(app, /SecurityView/);
  assert.match(api, /\/auth\/sessions\/revoke-others/);
  assert.match(api, /\/auth\/password/);
  assert.match(api, /\/auth\/sessions\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(view, /getSessions/);
  assert.match(view, /revokeOtherSessions/);
  assert.match(view, /changePassword/);
  assert.match(view, /currentSessionRevoked/);
});

test("CSV upload is bounded and rejects non-CSV and binary content", async () => {
  const source = await fs.readFile(new URL("../src/pages/PartsManagementView.jsx", import.meta.url), "utf8");
  assert.match(source, /2 \* 1024 \* 1024/);
  assert.match(source, /parsed\.length > 1000/);
  assert.match(source, /text\.includes\("\\u0000"\)/);
});

test("payment callers persist a request reference for 3DS return", async () => {
  const customer = await fs.readFile(new URL("../src/pages/CustomerView.jsx", import.meta.url), "utf8");
  const billing = await fs.readFile(new URL("../src/pages/BillingView.jsx", import.meta.url), "utf8");
  for (const source of [customer, billing]) {
    assert.match(source, /crypto\.randomUUID\(\)/);
    assert.match(source, /rakaez_pending_payment/);
    assert.match(source, /new URLSearchParams\(window\.location\.search\)/);
    assert.match(source, /payment\.status === "initiated"/);
  }
});

test("procurement UI keeps receipt idempotency and requires a paired device", async () => {
  const view = await fs.readFile(new URL("../src/pages/ProcurementView.jsx", import.meta.url), "utf8");
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /ProcurementView/);
  assert.match(view, /isDevicePaired/);
  assert.match(view, /receiptReference/);
  assert.match(view, /receivePurchaseOrder\(order\.id, receiptItems, "", receiptReference\)/);
  assert.match(api, /receiptReference = crypto\.randomUUID\(\)/);
  assert.match(api, /\/procurement\/purchase-orders\/\$\{id\}\/receipts/);
});

test("branch transfer UI preserves request, shipment, and receipt idempotency references", async () => {
  const view = await fs.readFile(new URL("../src/pages/TransfersView.jsx", import.meta.url), "utf8");
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /TransfersView/);
  assert.match(view, /requestReference/);
  assert.match(view, /shipmentReference/);
  assert.match(view, /receiptReference/);
  assert.match(view, /isDevicePaired/);
  assert.match(view, /damagedQuantity/);
  assert.match(api, /\/transfers\/\$\{id\}\/ship/);
  assert.match(api, /\/transfers\/\$\{id\}\/receive/);
});

test("branch manager UI can only perform a tenant-scoped read-only inventory search", async () => {
  const view = await fs.readFile(new URL("../src/pages/BranchInventoryView.jsx", import.meta.url), "utf8");
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const admin = await fs.readFile(new URL("../src/pages/AdminView.jsx", import.meta.url), "utf8");
  assert.match(app, /BranchInventoryView/);
  assert.match(app, /roles: \["branch_manager", "admin"\]/);
  assert.match(app, /role === "branch_manager"/);
  assert.match(admin, /option value="branch_manager"/);
  assert.match(api, /\/parts\/branch-availability\?/);
  assert.match(view, /searchBranchAvailability/);
  assert.match(view, /isCurrentBranch/);
  assert.match(view, /totalAvailable/);
  assert.match(view, /shelfLabel/);
  assert.doesNotMatch(view, /createPart|updatePart|updateInventory|issueInventory|deletePart/);
});

test("administrator compliance UI exposes blockers without exposing credentials or invoice XML", async () => {
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const view = await fs.readFile(new URL("../src/pages/ComplianceView.jsx", import.meta.url), "utf8");
  const admin = await fs.readFile(new URL("../src/pages/AdminView.jsx", import.meta.url), "utf8");
  assert.match(app, /ComplianceView/);
  assert.match(app, /key: "compliance"[\s\S]+roles: \["admin"\]/);
  assert.match(api, /\/compliance\/status/);
  assert.match(view, /zatca\.blockers/);
  assert.match(view, /raw_payload/);
  assert.doesNotMatch(view, /BINARY_SECURITY_TOKEN|ZATCA_SECRET|invoiceBase64/);
  assert.match(admin, /commercialRegistrationNumber/);
  assert.match(admin, /10 أرقام/);
});

test("public landing experience uses local abstract visuals without people or remote media", async () => {
  const login = await fs.readFile(new URL("../src/pages/LoginView.jsx", import.meta.url), "utf8");
  const theme = await fs.readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  assert.match(login, /rk-system-preview/);
  assert.match(login, /rk-feature-grid/);
  assert.doesNotMatch(login, /<img|<video|https?:\/\//);
  assert.doesNotMatch(theme, /url\s*\(\s*["']?https?:\/\//i);
});

test("public landing experience remains bilingual and motion-accessible", async () => {
  const login = await fs.readFile(new URL("../src/pages/LoginView.jsx", import.meta.url), "utf8");
  const strings = await fs.readFile(new URL("../src/i18n/LanguageContext.jsx", import.meta.url), "utf8");
  const theme = await fs.readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  assert.match(login, /aria-labelledby="rakaez-hero-title"/);
  assert.match(login, /role="alert"/);
  assert.match(login, /type="button" className="rk-link"/);
  assert.equal((strings.match(/hero_title:/g) || []).length, 2);
  assert.equal((strings.match(/login_privacy_note:/g) || []).length, 2);
  assert.match(theme, /prefers-reduced-motion:\s*reduce/);
  assert.match(theme, /button:focus-visible/);
});

test("administrator catalog provider panel is fail-closed and never exposes secrets or VIN values", async () => {
  const admin = await fs.readFile(new URL("../src/pages/AdminView.jsx", import.meta.url), "utf8");
  const client = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const providerConfig = await fs.readFile(new URL("../../backend/src/utils/catalog-providers.js", import.meta.url), "utf8");
  assert.match(admin, /function CatalogProviders/);
  assert.match(admin, /getCatalogProviders/);
  assert.match(client, /\/catalog\/providers/);
  assert.match(providerConfig, /credentialsConfigured/);
  assert.doesNotMatch(admin, /LEVAM_API_KEY|PARTSOUQ_API_KEY/);
  assert.doesNotMatch(client, /LEVAM_API_KEY|PARTSOUQ_API_KEY/);
  assert.doesNotMatch(admin, /provider\.apiKey|provider\.vin/);
});

test("shop inventory remains authoritative and future providers are absent from active staff workflows", async () => {
  const seller = await fs.readFile(new URL("../src/pages/SellerView.jsx", import.meta.url), "utf8");
  const warehouse = await fs.readFile(new URL("../src/pages/WarehouseView.jsx", import.meta.url), "utf8");
  assert.match(seller, /searchParts/);
  assert.match(warehouse, /findWarehouseParts/);
  assert.doesNotMatch(seller, /7zap|partsouq|ExternalCatalogLinks/i);
  assert.doesNotMatch(warehouse, /7zap|partsouq|ExternalCatalogLinks/i);
});
