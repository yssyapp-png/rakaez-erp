import test from "node:test";
import assert from "node:assert/strict";
import { groupBranchInventoryRows, isNonNegativeInteger, isNonNegativeMoney, normalizeBranchInventorySearch, normalizeShelfLookup, normalizeWarehouseLookup, validateImportRows } from "../src/routes/parts.js";
import { hasValidItems } from "../src/routes/sales.js";
import { isAcceptablePassword, jwtExpirySeconds, subscriptionAllowsAccess } from "../src/routes/auth.js";
import { loginSubjectHash, securityHash, validateSecurityConfiguration } from "../src/utils/security.js";
import { isUuid, paymentMatches, refundableAmount } from "../src/utils/moyasar.js";
import { validateOutboundUrl } from "../src/utils/outbound-policy.js";
import { getCatalogProviderStatuses, validateCatalogProviderConfiguration } from "../src/utils/catalog-providers.js";
import {
  getZatcaConfiguration,
  signedInvoiceMatchesOrganization,
  validateSignedInvoicePackage,
  validateZatcaRuntimeConfiguration,
} from "../src/utils/zatca-integration.js";
import { SAUDI_STARTER_CATALOG } from "../src/routes/catalog.js";
import { normalizeVin } from "../src/routes/vehicles.js";
import { asyncHandler } from "../src/utils/safe-router.js";
import {
  authCookieName,
  crossSiteRequestGuard,
  parseAllowedOrigins,
  parseCookies,
} from "../src/utils/http-security.js";
import {
  normalizeSupplierPayload,
  isIsoDate,
  purchaseReceiptRequestHash,
  validatePurchaseOrderItems,
  validateReceiptItems,
  weightedAverageCost,
} from "../src/routes/procurement.js";
import {
  inventoryTransferReceiptHash,
  inventoryTransferRequestHash,
  validateTransferItems,
  validateTransferReceiptItems,
} from "../src/routes/transfers.js";
import { migrationFiles } from "../src/db/migrations.js";
import fs from "node:fs/promises";

test("money values reject negative and non-numeric input", () => {
  assert.equal(isNonNegativeMoney(0), true);
  assert.equal(isNonNegativeMoney("12.50"), true);
  assert.equal(isNonNegativeMoney(-1), false);
  assert.equal(isNonNegativeMoney("not-a-number"), false);
});

test("Saudi starter catalog keys and generated part numbers are unique", () => {
  const keys = SAUDI_STARTER_CATALOG.map(([key]) => key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.every((key) => /^[a-z0-9-]+$/.test(key)), true);
});

test("VIN normalization accepts 17 valid characters and rejects I, O, Q", () => {
  assert.equal(normalizeVin("1hgcm82633a004352"), "1HGCM82633A004352");
  assert.equal(normalizeVin("1HGCM82633A00435I"), null);
  assert.equal(normalizeVin("short"), null);
});

test("catalog search rejects an empty query instead of listing the full catalog", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /search_required/);
  assert.match(source, /search_too_long/);
});

test("inventory quantities are non-negative whole numbers", () => {
  assert.equal(isNonNegativeInteger(0), true);
  assert.equal(isNonNegativeInteger("12"), true);
  assert.equal(isNonNegativeInteger(-1), false);
  assert.equal(isNonNegativeInteger(1.5), false);
});

test("inventory import validates, normalizes, and rejects duplicate rows", () => {
  const result = validateImportRows([
    { partNumber: " ab-10 ", name: "فلتر زيت", price: "25", quantity: "4" },
    { partNumber: "AB-10", name: "مكرر", price: 30, quantity: 1 },
    { partNumber: "BAD", name: "", price: -1, quantity: 1.5 },
  ], "skip");
  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].partNumber, "AB-10");
  assert.equal(result.validRows[0].quantity, 4);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.errors[0].errors, ["duplicate_in_file"]);
  assert.equal(result.errors[1].errors.includes("name_required"), true);
  assert.equal(result.errors[1].errors.includes("invalid_price"), true);
  assert.equal(validateImportRows([{ partNumber: "FREE", name: "قطعة", price: 0 }], "skip").errors[0].errors.includes("invalid_price"), true);
  assert.equal(validateImportRows([{ partNumber: "SAFE", name: "فلتر\u0007زيت", price: 10 }], "skip").validRows[0].name, "فلترزيت");
});

test("inventory import enforces safe modes and batch limits", () => {
  assert.equal(validateImportRows([], "skip").error, "invalid_import_batch");
  assert.equal(validateImportRows([{ partNumber: "P1", name: "قطعة", price: 1 }], "delete").error, "invalid_import_mode");
  assert.equal(validateImportRows(Array.from({ length: 1001 }, (_, i) => ({ partNumber: `P${i}`, name: "قطعة", price: 1 })), "skip").error, "invalid_import_batch");
});

test("checkout accepts only non-empty lines with positive whole quantities", () => {
  assert.equal(hasValidItems([{ partId: "P-100", quantity: 1 }]), true);
  assert.equal(hasValidItems([]), false);
  assert.equal(hasValidItems([{ partId: "P-100", quantity: 0 }]), false);
  assert.equal(hasValidItems([{ partId: "P-100", quantity: -2 }]), false);
  assert.equal(hasValidItems([{ partId: "P-100", quantity: 1.5 }]), false);
  assert.equal(hasValidItems([{ partId: "", quantity: 1 }]), false);
  assert.equal(hasValidItems([{ partId: "P-100", quantity: 1 }, { partId: "P-100", quantity: 1 }]), false);
  assert.equal(hasValidItems(Array.from({ length: 201 }, (_, i) => ({ partId: `P-${i}`, quantity: 1 }))), false);
});

test("async route failures are forwarded to the central API error handler", async () => {
  const expected = new Error("database_down");
  let forwarded;
  asyncHandler(async () => { throw expected; })({}, {}, (error) => { forwarded = error; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(forwarded, expected);
  const index = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(index, /internal_server_error/);
});

test("database and gateway exception details are not returned to API clients", async () => {
  const sales = await fs.readFile(new URL("../src/routes/sales.js", import.meta.url), "utf8");
  const billing = await fs.readFile(new URL("../src/routes/billing.js", import.meta.url), "utf8");
  assert.match(sales, /publicSalesError/);
  assert.doesNotMatch(sales, /error: err\.message \|\| "checkout_failed"/);
  assert.match(billing, /error: "activation_failed"/);
  assert.doesNotMatch(billing, /error: err\.message \|\| "activation_failed"/);
});

test("subscription access allows active and unexpired trials only", () => {
  const now = new Date("2026-08-10T00:00:00Z");
  assert.equal(subscriptionAllowsAccess("active", null, now), true);
  assert.equal(subscriptionAllowsAccess("trialing", "2026-08-11T00:00:00Z", now), true);
  assert.equal(subscriptionAllowsAccess("trialing", "2026-08-09T00:00:00Z", now), false);
  assert.equal(subscriptionAllowsAccess("past_due", null, now), false);
  assert.equal(subscriptionAllowsAccess("canceled", null, now), false);
});

test("account passwords require a practical minimum strength", () => {
  assert.equal(isAcceptablePassword("123456"), false);
  assert.equal(isAcceptablePassword("twelveletters"), false);
  assert.equal(isAcceptablePassword("StrongPassword12"), true);
  assert.equal(isAcceptablePassword("كلمةمرورآمنة12"), true);
  assert.equal(isAcceptablePassword("A1".repeat(65)), false);
});

test("JWT duration parsing is bounded and explicit", () => {
  assert.equal(jwtExpirySeconds("30m"), 1800);
  assert.equal(jwtExpirySeconds("12h"), 43200);
  assert.equal(jwtExpirySeconds("1d"), 86400);
  assert.throws(() => jwtExpirySeconds("forever"));
});

test("security identifiers are deterministic pseudonymous hashes", () => {
  assert.match(securityHash("203.0.113.7"), /^[0-9a-f]{64}$/);
  assert.equal(loginSubjectHash(" User@Example.com ", " rkz-a1 "), loginSubjectHash("user@example.com", "RKZ-A1"));
  assert.notEqual(loginSubjectHash("user@example.com", "RKZ-A1"), loginSubjectHash("user@example.com", "RKZ-A2"));
});

test("production security records require an independent HMAC pepper", () => {
  assert.throws(() => validateSecurityConfiguration({ nodeEnv: "production", pepper: "short" }));
  assert.doesNotThrow(() => validateSecurityConfiguration({ nodeEnv: "production", pepper: "S".repeat(32) }));
  assert.doesNotThrow(() => validateSecurityConfiguration({ nodeEnv: "test", pepper: "" }));
});

test("verified payments must be paid and match amount and currency", () => {
  assert.equal(paymentMatches({ status: "paid", amount: 34900, currency: "SAR" }, 34900), true);
  assert.equal(paymentMatches({ status: "captured", amount: 34900, captured: 34900, currency: "SAR" }, 34900), true);
  assert.equal(paymentMatches({ status: "captured", amount: 34900, captured: 10000, currency: "SAR" }, 34900), false);
  assert.equal(paymentMatches({ status: "paid", amount: 34900, refunded: 1000, currency: "SAR" }, 34900), false);
  assert.equal(paymentMatches({ status: "initiated", amount: 34900, currency: "SAR" }, 34900), false);
  assert.equal(paymentMatches({ status: "paid", amount: 34901, currency: "SAR" }, 34900), false);
  assert.equal(paymentMatches({ status: "paid", amount: 34900, currency: "USD" }, 34900), false);
  assert.equal(refundableAmount({ status: "paid", amount: 34900, refunded: 1000 }), 33900);
  assert.equal(refundableAmount({ status: "captured", amount: 34900, captured: 12000, refunded: 2000 }), 10000);
});

test("payment and request references must be real UUIDs", () => {
  assert.equal(isUuid("760878ec-d1d3-5f72-9056-191683faa872"), true);
  assert.equal(isUuid("------------------------------------"), false);
  assert.equal(isUuid("not-a-payment-id"), false);
});

test("Supabase API security migration enables RLS and revokes browser roles", async () => {
  const sql = await fs.readFile(new URL("../src/db/migration_api_surface_security.sql", import.meta.url), "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE[^;]+anon, authenticated/);
  for (const table of ["organizations", "users", "parts", "inventory", "invoices", "organization_invites"]) {
    assert.match(sql, new RegExp(`['\"]${table}['\"]`));
  }
});

test("database release verification fails closed and checks every required migration", async () => {
  const source = await fs.readFile(new URL("../dbtest.mjs", import.meta.url), "utf8");
  const migrateSource = await fs.readFile(new URL("../scripts/migrate.js", import.meta.url), "utf8");

  assert.match(source, /process\.exitCode = 1/);
  assert.match(source, /Missing database migrations/);
  assert.match(source, /database connection or verification query failed/);
  assert.doesNotMatch(source, /console\.error\([^\n]+error\.message/);
  assert.match(source, /schema_migrations/);
  assert.match(source, /finally\s*\{[\s\S]*pool\.end\(\)/);
  assert.ok(migrationFiles.length > 0);
  assert.equal(new Set(migrationFiles).size, migrationFiles.length);
  assert.match(migrateSource, /import \{ migrationFiles \} from "\.\.\/src\/db\/migrations\.js"/);
  assert.doesNotMatch(migrateSource, /const migrationFiles\s*=\s*\[/);
});

test("tenant login requires an organization code and never selects the first matching email", async () => {
  const source = await fs.readFile(new URL("../src/routes/auth.js", import.meta.url), "utf8");
  assert.match(source, /missing_login_fields/);
  assert.match(source, /upper\(o\.login_code\) = \$2/);
  assert.doesNotMatch(source, /ORDER BY id LIMIT 1/);
});

test("authentication uses revocable server sessions and a bounded login guard", async () => {
  const auth = await fs.readFile(new URL("../src/routes/auth.js", import.meta.url), "utf8");
  const security = await fs.readFile(new URL("../src/utils/security.js", import.meta.url), "utf8");
  assert.match(auth, /DUMMY_PASSWORD_HASH/);
  assert.match(auth, /LOGIN_FAILURE_LIMIT/);
  assert.match(auth, /securityHash\(`login-attempt/);
  assert.match(auth, /login_temporarily_blocked/);
  assert.match(auth, /INSERT INTO user_sessions/);
  assert.match(auth, /claims\.sid/);
  assert.match(auth, /s\.revoked_at IS NULL AND s\.expires_at > now\(\)/);
  assert.match(auth, /u\.role = \$4/);
  assert.match(auth, /u\.branch_id IS NOT DISTINCT FROM \$5::integer/);
  assert.match(auth, /router\.post\("\/logout", authRequired/);
  assert.match(auth, /router\.post\("\/sessions\/revoke-others", authRequired/);
  assert.match(auth, /router\.put\("\/password", authRequired/);
  assert.match(auth, /revoked_reason = 'credentials_changed'/);
  assert.match(auth, /eventType: "password_changed"/);
  assert.match(auth, /readAuthCookie\(req\) \|\| bearerToken/);
  assert.match(auth, /setAuthCookie\(res, token, SESSION_TTL_HOURS\)/);
  assert.doesNotMatch(auth, /res\.json\(\{ user: publicUser\(user\), token/);
  assert.match(security, /createHmac\("sha256", SECURITY_EVENT_PEPPER\)/);
  assert.doesNotMatch(security, /INSERT INTO security_events[\s\S]+email/);
});

test("production cookies and request origins are fail-closed", () => {
  assert.equal(authCookieName("production"), "__Host-rakaez_session");
  assert.deepEqual(parseCookies("a=1; rakaez_session=abc%20123"), { a: "1", rakaez_session: "abc 123" });
  assert.deepEqual(parseAllowedOrigins("https://app.example, https://app.example", "production"), ["https://app.example"]);
  assert.throws(() => parseAllowedOrigins("http://app.example", "production"));
  assert.throws(() => parseAllowedOrigins("https://*.example", "production"));

  let status;
  let payload;
  const res = {
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; },
  };
  crossSiteRequestGuard(["https://app.example"])(
    { method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } },
    res,
    () => assert.fail("cross-site request must not reach next")
  );
  assert.equal(status, 403);
  assert.equal(payload.error, "cross_site_request_blocked");
});

test("session security migration is append-only, private, and last in migration order", async () => {
  const migration = await fs.readFile(new URL("../src/db/migration_session_security.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_login_guards/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS security_events/);
  assert.match(migration, /security_events are append-only/);
  assert.doesNotMatch(migration, /security_events[\s\S]+REFERENCES user_sessions/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON security_events/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE[^;]+anon, authenticated/);
  assert.equal(migrationFiles.includes("migration_session_security.sql"), true);
  assert.equal(migrationFiles.indexOf("migration_inventory_transfers.sql") < migrationFiles.indexOf("migration_session_security.sql"), true);
});

test("device pairing is HMAC protected, distributed-rate-limited, audited, and expiring", async () => {
  const devices = await fs.readFile(new URL("../src/routes/devices.js", import.meta.url), "utf8");
  const migration = await fs.readFile(new URL("../src/db/migration_device_security.sql", import.meta.url), "utf8");
  assert.match(devices, /securityHash\(`device-pairing-code/);
  assert.match(devices, /securityHash\(`device-token/);
  assert.match(devices, /setDeviceCookie\(res, deviceToken, DEVICE_TTL_DAYS\)/);
  assert.match(devices, /readDeviceCookie\(req\) \|\| req\.headers\["x-device-token"\]/);
  assert.doesNotMatch(devices, /json\(\{[^\n]*deviceToken/);
  assert.match(devices, /device_pairing_guards/);
  assert.match(devices, /PAIRING_FAILURE_LIMIT = 10/);
  assert.match(devices, /expires_at > now\(\)/);
  assert.match(devices, /device_pairing_succeeded/);
  assert.match(devices, /device_revoked/);
  assert.doesNotMatch(devices, /createHash\("sha256"\)/);
  assert.match(migration, /SET status = 'revoked'/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.equal(migrationFiles.includes("migration_device_security.sql"), true);
  assert.equal(migrationFiles.indexOf("migration_session_security.sql") < migrationFiles.indexOf("migration_device_security.sql"), true);
});

test("public tenant registration is closed by default in production", async () => {
  const auth = await fs.readFile(new URL("../src/routes/auth.js", import.meta.url), "utf8");
  assert.match(auth, /PUBLIC_REGISTRATION_ENABLED !== "true"/);
  assert.match(auth, /public_registration_disabled/);
});

test("registration, login, and invitation return one public user shape", async () => {
  const source = await fs.readFile(new URL("../src/routes/auth.js", import.meta.url), "utf8");
  assert.match(source, /function publicUser/);
  assert.equal((source.match(/publicUser\(user\)/g) || []).length >= 3, true);
});

test("fresh schema creates users before the import audit foreign key", async () => {
  const sql = await fs.readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  assert.equal(sql.indexOf("CREATE TABLE users" ) < sql.indexOf("CREATE TABLE catalog_import_runs"), true);
});

test("local seed follows the multi-tenant schema and does not seed a password", async () => {
  const sql = await fs.readFile(new URL("../src/db/seed.sql", import.meta.url), "utf8");
  assert.match(sql, /INSERT INTO organizations/);
  assert.match(sql, /organization_id/);
  assert.doesNotMatch(sql, /INSERT INTO users/);
  assert.doesNotMatch(sql, /password_hash/);
});

test("CSV inventory import records an auditable run and inventory movements", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO catalog_import_runs/);
  assert.match(source, /'catalog_import'/);
  assert.match(source, /updated_count=\$2/);
  assert.match(source, /row\.quantity - previousQuantity/);
  assert.match(source, /'receipt',\$5,'catalog_import'/);
});

test("shelf lookup normalizes physical labels and rejects unsafe lengths", () => {
  assert.equal(normalizeShelfLookup(" a - 15 "), "A-15");
  assert.equal(normalizeShelfLookup(" 15 "), "15");
  assert.equal(normalizeShelfLookup(""), null);
  assert.equal(normalizeShelfLookup("A".repeat(101)), null);
});

test("shelf lookup is scoped to the paired device branch and tenant", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /i\.branch_id = \$2/);
  assert.match(source, /p\.organization_id = \$1/);
  assert.match(source, /router\.get\("\/shelf-lookup", deviceRequired/);
});

test("warehouse lookup accepts useful terms and bounds query size", () => {
  assert.equal(normalizeWarehouseLookup("  04465  0W141 "), "04465 0W141");
  assert.equal(normalizeWarehouseLookup(""), null);
  assert.equal(normalizeWarehouseLookup("X".repeat(121)), null);
});

test("warehouse lookup and low stock are device, branch, and tenant scoped", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /router\.get\("\/warehouse-lookup", deviceRequired/);
  assert.match(source, /router\.get\("\/warehouse-low-stock", deviceRequired/);
  assert.match(source, /i\.quantity <= i\.min_quantity/);
  assert.match(source, /LIMIT 50/);
  assert.match(source, /LIMIT 100/);
});

test("branch inventory search is bounded and escapes wildcard input", () => {
  assert.deepEqual(normalizeBranchInventorySearch("  04465  0W141 ", "oem"), {
    query: "04465 0W141",
    type: "oem",
    likeQuery: "%04465 0W141%",
  });
  assert.equal(normalizeBranchInventorySearch("a", "all"), null);
  assert.equal(normalizeBranchInventorySearch("A".repeat(121), "all"), null);
  assert.equal(normalizeBranchInventorySearch("ABC", "cost"), null);
  assert.equal(normalizeBranchInventorySearch("_%\\", "name").likeQuery, "%\\_\\%\\\\%");
});

test("branch inventory rows are grouped with totals and the caller's current branch", () => {
  const rows = [
    { part_id: 7, part_number: "P-7", name: "Filter", brand: "R", category: "Engine", barcode: "77", oem_numbers: ["OEM7"], cross_reference_numbers: [], branch_id: 4, branch_name: "North", branch_city: "Riyadh", quantity: 2, shelf_section: "A", shelf_number: "4", shelf_level: "1" },
    { part_id: 7, part_number: "P-7", name: "Filter", brand: "R", category: "Engine", barcode: "77", oem_numbers: ["OEM7"], cross_reference_numbers: [], branch_id: 5, branch_name: "South", branch_city: "Riyadh", quantity: 9, shelf_section: "B", shelf_number: "8", shelf_level: "2" },
  ];
  const [part] = groupBranchInventoryRows(rows, 4);
  assert.equal(part.totalAvailable, 11);
  assert.equal(part.availability[0].isCurrentBranch, true);
  assert.equal(part.availability[1].isCurrentBranch, false);
  assert.equal(part.availability[1].shelfNumber, "8");
  assert.equal("cost" in part, false);
});

test("branch manager availability is read-only, least-privileged, tenant-scoped, and audited", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  const route = source.match(/router\.get\(\n  "\/branch-availability"[\s\S]+?\n\);/)?.[0] || "";
  assert.match(route, /requireRole\("branch_manager", "admin"\)/);
  assert.match(route, /p\.organization_id = \$1/);
  assert.match(route, /b\.organization_id = \$1/);
  assert.match(route, /i\.quantity > 0/);
  assert.match(route, /LIMIT 50/);
  assert.match(route, /branch_inventory_searched/);
  assert.match(route, /query_hash/);
  assert.match(route, /employee_branch_required/);
  assert.doesNotMatch(route, /p\.cost|p\.price|supplier|INSERT INTO inventory|UPDATE inventory|DELETE FROM inventory/);
  assert.match(source, /\["customer", "seller", "warehouse_keeper", "admin"\]\.includes\(req\.user\.role\)/);
});

test("branch manager database migration enforces tenant-owned branch assignments", async () => {
  const migration = await fs.readFile(new URL("../src/db/migration_branch_manager.sql", import.meta.url), "utf8");
  assert.match(migration, /'branch_manager'/);
  assert.match(migration, /FOREIGN KEY \(organization_id, branch_id\)/);
  assert.match(migration, /REFERENCES branches\(organization_id, id\)/);
  assert.match(migration, /users_staff_branch_required/);
  assert.match(migration, /organization_invites_staff_branch_required/);
  assert.match(migration, /Invalid user branch assignment detected/);
  assert.equal(migrationFiles.includes("migration_branch_manager.sql"), true);
  assert.equal(migrationFiles.indexOf("migration_device_security.sql") < migrationFiles.indexOf("migration_branch_manager.sql"), true);
});

test("administrator can invite a branch manager only into an owned branch", async () => {
  const source = await fs.readFile(new URL("../src/routes/admin.js", import.meta.url), "utf8");
  assert.match(source, /"branch_manager"/);
  assert.match(source, /\["seller", "warehouse_keeper", "branch_manager"\]\.includes\(role\)/);
  assert.match(source, /SELECT id FROM branches WHERE id = \$1 AND organization_id = \$2/);
  assert.match(source, /customer_branch_not_allowed/);
});

test("paired devices enforce the branch assignment for every staff role", async () => {
  const source = await fs.readFile(new URL("../src/routes/devices.js", import.meta.url), "utf8");
  assert.match(source, /\["seller", "warehouse_keeper", "branch_manager"\]\.includes\(req\.user\.role\)/);
  assert.match(source, /employee_device_branch_mismatch/);
});

test("customer catalog response excludes costs, exact stock, and shelf locations", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /CUSTOMER_PART_COLUMNS/);
  assert.doesNotMatch(source.match(/const CUSTOMER_PART_COLUMNS[\s\S]+?;/)?.[0] || "", /p\.cost/);
  assert.match(source, /req\.user\.role === "admin" \? STAFF_PART_COLUMNS : CUSTOMER_PART_COLUMNS/);
  assert.match(source, /available: true/);
});

test("employee catalog inventory is limited to the assigned branch", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /\["seller", "warehouse_keeper"\]\.includes\(req\.user\.role\)/);
  assert.match(source, /AND i\.branch_id = \$3/);
  assert.match(source, /req\.user\.branchId/);
  assert.match(source, /const employeeBranchFilter = req\.user\.role === "warehouse_keeper" \? "AND i\.branch_id = \$2"/);
  assert.match(source, /employee_branch_required/);
});

test("manually entered vehicle compatibility is not marked as independently verified", async () => {
  const source = await fs.readFile(new URL("../src/routes/catalog.js", import.meta.url), "utf8");
  assert.match(source, /'SA','manual','unverified'/);
  assert.doesNotMatch(source, /'SA','manual','verified'/);
});

test("seller invoice history is limited to the assigned branch", async () => {
  const source = await fs.readFile(new URL("../src/routes/sales.js", import.meta.url), "utf8");
  assert.match(source, /req\.user\.role === "seller" \? "AND i\.branch_id = \$2"/);
  assert.match(source, /employee_branch_required/);
});

test("invoices require a real organization VAT identity and round monetary totals", async () => {
  const source = await fs.readFile(new URL("../src/routes/sales.js", import.meta.url), "utf8");
  assert.match(source, /organization_vat_number_required/);
  assert.doesNotMatch(source, /000000000000000/);
  assert.match(source, /Math\.round\(\(subtotal \+ vat\) \* 100\) \/ 100/);
});

test("administrator can maintain organization VAT identity and create tenant branches", async () => {
  const source = await fs.readFile(new URL("../src/routes/admin.js", import.meta.url), "utf8");
  assert.match(source, /router\.put\("\/organization"/);
  assert.match(source, /\^\\d\{15\}\$/);
  assert.match(source, /router\.post\("\/branches"/);
  assert.match(source, /organization_id = \$1/);
});

test("catalog and manual stock mutations require an administrator", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /router\.post\("\/", requireRole\("admin"\)/);
  assert.match(source, /router\.put\("\/:id", requireRole\("admin"\)/);
  assert.match(source, /router\.delete\("\/:id", requireRole\("admin"\)/);
  assert.match(source, /router\.put\("\/:id\/inventory", requireRole\("admin"\)/);
  assert.match(source, /router\.post\("\/:id\/issue", deviceRequired/);
  assert.match(source, /manual_inventory_adjustment/);
  assert.match(source, /catalog_status = 'archived'/);
  assert.match(source, /CASE WHEN \$4::integer IS NULL THEN inventory\.min_quantity/);
});

test("payment schema and routes enforce unique payment references and server verification", async () => {
  const sql = await fs.readFile(new URL("../src/db/migration_payment_hardening.sql", import.meta.url), "utf8");
  const sales = await fs.readFile(new URL("../src/routes/sales.js", import.meta.url), "utf8");
  const billing = await fs.readFile(new URL("../src/routes/billing.js", import.meta.url), "utf8");
  const renewals = await fs.readFile(new URL("../scripts/billing-cron.js", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE INDEX[^\n]+payment_reference/i);
  assert.match(sql, /UNIQUE\(organization_id, scheduled_for\)/);
  assert.match(sql, /duplicate invoices\.payment_reference/);
  assert.match(sales, /fetchMoyasarPayment\(paymentId\)/);
  assert.match(sales, /payment_ownership_mismatch/);
  assert.match(sales, /payment_reconciliation_required/);
  assert.match(sales, /verifiedOwnedPayment/);
  assert.match(sales, /pg_try_advisory_lock/);
  assert.match(sales, /payment_processing_in_progress/);
  assert.match(sales, /refundOutstandingMoyasarPayment/);
  assert.doesNotMatch(sales, /const existing = await pool\.query/);
  assert.match(sales, /leaving payment unchanged for manual review/);
  assert.match(billing, /fetchMoyasarPayment\(paymentId\)/);
  assert.match(billing, /pg_try_advisory_lock/);
  assert.match(billing, /refundOutstandingMoyasarPayment/);
  assert.doesNotMatch(billing, /const existing = await pool\.query/);
  assert.match(billing, /subscription_payments/);
  assert.match(billing, /Subscription payment reconciliation failed/);
  assert.match(billing, /payment_reconciliation_required/);
  assert.match(renewals, /paymentMatches\(payment/);
  assert.match(renewals, /refundOutstandingMoyasarPayment/);
  assert.match(renewals, /givenId/);
  assert.match(renewals, /pg_try_advisory_lock\(731954202\)/);
  assert.match(renewals, /PAYMENTS_ENABLED !== "true"/);
});

test("production web delivery is restricted to compiled assets with CSP and request IDs", async () => {
  const index = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const docker = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(index, /contentSecurityPolicy/);
  assert.match(index, /X-Request-ID/);
  assert.match(index, /safe-path/);
  assert.match(index, /client-fingerprint/);
  assert.doesNotMatch(index, /':remote-addr/);
  assert.match(index, /Retry-After/);
  assert.match(index, /Strict-Transport-Security/);
  assert.match(index, /frameAncestors: \["'none'"\]/);
  assert.match(index, /Cache-Control", "no-store"/);
  assert.match(await fs.readFile(new URL("../src/utils/security.js", import.meta.url), "utf8"), /SECURITY_EVENT_PEPPER/);
  assert.match(index, /dotfiles: "deny"/);
  assert.match(index, /sendFile\(path\.join\(publicDirectory, "index\.html"\)/);
  assert.match(docker, /FROM node:24-alpine AS web-dependencies/);
  assert.match(docker, /COPY --from=web-build \/web\/dist \.\/public/);
});

test("local, CI, and container runtimes are pinned to Node.js 24", async () => {
  const rootPackage = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const backendPackage = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  const frontendPackage = JSON.parse(await fs.readFile(new URL("../../frontend/package.json", import.meta.url), "utf8"));
  const workflow = await fs.readFile(new URL("../../.github/workflows/ci-cd.yml", import.meta.url), "utf8");
  const docker = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const nodeVersion = (await fs.readFile(new URL("../../.node-version", import.meta.url), "utf8")).trim();
  const nvmVersion = (await fs.readFile(new URL("../../.nvmrc", import.meta.url), "utf8")).trim();

  assert.equal(rootPackage.engines.node, ">=24 <25");
  assert.equal(backendPackage.engines.node, ">=24 <25");
  assert.equal(frontendPackage.engines.node, ">=24 <25");
  assert.equal(nodeVersion, "24");
  assert.equal(nvmVersion, "24");
  assert.match(workflow, /node-version: \[24\.x\]/);
  assert.doesNotMatch(workflow, /node-version: (?:20|22|26)\.x/);
  assert.equal((docker.match(/FROM node:24-alpine/g) || []).length, 3);
});

test("Supabase database TLS uses the official CA and never disables certificate verification", async () => {
  const sslSource = await fs.readFile(new URL("../src/db/ssl.js", import.meta.url), "utf8");
  const certificate = await fs.readFile(new URL("../certs/supabase-ca-2021.crt", import.meta.url), "utf8");
  const docker = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(sslSource, /rejectUnauthorized: true/);
  assert.doesNotMatch(sslSource, /rejectUnauthorized: false/);
  assert.match(certificate, /BEGIN CERTIFICATE/);
  assert.match(certificate, /END CERTIFICATE/);
  assert.match(docker, /COPY backend\/certs \.\/certs/);
});

test("Supabase advisor hardening protects the migration ledger and trigger search path", async () => {
  const migration = await fs.readFile(new URL("../src/db/migration_supabase_advisor_hardening.sql", import.meta.url), "utf8");

  assert.match(migration, /ALTER TABLE public\.schema_migrations ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.schema_migrations FROM anon, authenticated/);
  assert.match(migration, /ALTER FUNCTION public\.prevent_security_event_mutation\(\)/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.equal(migrationFiles.includes("migration_supabase_advisor_hardening.sql"), true);
  assert.equal(
    migrationFiles.indexOf("migration_saudi_compliance.sql") < migrationFiles.indexOf("migration_supabase_advisor_hardening.sql"),
    true
  );
});

test("procurement validates suppliers and Saudi VAT identities", () => {
  const supplier = normalizeSupplierPayload({
    name: "  مورد الخليج ",
    vatNumber: "310123456700003",
    email: "SALES@EXAMPLE.COM",
    paymentTermsDays: "30",
  });
  assert.deepEqual(supplier.errors, []);
  assert.equal(supplier.value.name, "مورد الخليج");
  assert.equal(supplier.value.email, "sales@example.com");
  assert.equal(supplier.value.paymentTermsDays, 30);
  assert.equal(normalizeSupplierPayload({ name: "مورد", vatNumber: "123" }).errors.includes("invalid_vat_number"), true);
  assert.equal(normalizeSupplierPayload({ name: "", email: "bad" }).errors.length, 2);
});

test("purchase orders reject duplicates, fractions, and unbounded lines", () => {
  const valid = validatePurchaseOrderItems([
    { partId: 10, quantity: 4, unitCost: "12.345" },
    { partId: 11, quantity: 1, unitCost: 0 },
  ]);
  assert.deepEqual(valid.items, [
    { partId: 10, quantity: 4, unitCost: 12.35 },
    { partId: 11, quantity: 1, unitCost: 0 },
  ]);
  assert.equal(validatePurchaseOrderItems([{ partId: 10, quantity: 1.5, unitCost: 1 }]).error, "invalid_purchase_order_items");
  assert.equal(validatePurchaseOrderItems([
    { partId: 10, quantity: 1, unitCost: 1 },
    { partId: 10, quantity: 2, unitCost: 1 },
  ]).error, "invalid_purchase_order_items");
});

test("purchase orders accept real ISO dates only", () => {
  assert.equal(isIsoDate("2026-08-13"), true);
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("13-08-2026"), false);
});

test("purchase receipts accept only unique positive whole quantities", () => {
  assert.deepEqual(validateReceiptItems([{ purchaseOrderItemId: 9, quantity: 3 }]).items, [
    { purchaseOrderItemId: 9, quantity: 3 },
  ]);
  assert.equal(validateReceiptItems([{ purchaseOrderItemId: 9, quantity: 0 }]).error, "invalid_receipt_items");
  assert.equal(validateReceiptItems([
    { purchaseOrderItemId: 9, quantity: 1 },
    { purchaseOrderItemId: 9, quantity: 1 },
  ]).error, "invalid_receipt_items");
});

test("purchase receipt idempotency detects payload changes but ignores line order", () => {
  const left = purchaseReceiptRequestHash(10, [
    { purchaseOrderItemId: 2, quantity: 3 },
    { purchaseOrderItemId: 1, quantity: 5 },
  ]);
  const reordered = purchaseReceiptRequestHash(10, [
    { purchaseOrderItemId: 1, quantity: 5 },
    { purchaseOrderItemId: 2, quantity: 3 },
  ]);
  const changed = purchaseReceiptRequestHash(10, [
    { purchaseOrderItemId: 1, quantity: 4 },
    { purchaseOrderItemId: 2, quantity: 3 },
  ]);
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test("procurement uses weighted-average cost without floating point drift", () => {
  assert.equal(weightedAverageCost(10, 20, 10, 30), 25);
  assert.equal(weightedAverageCost(3, 10, 2, 10.01), 10);
  assert.equal(weightedAverageCost(0, 99, 4, 12.34), 12.34);
});

test("purchase receipts are atomic, tenant scoped, branch paired, and idempotent", async () => {
  const source = await fs.readFile(new URL("../src/routes/procurement.js", import.meta.url), "utf8");
  assert.match(source, /deviceRequired/);
  assert.match(source, /po\.organization_id = \$1/);
  assert.match(source, /p\.organization_id = \$3/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /receipt_reference/);
  assert.match(source, /device_branch_mismatch/);
  assert.match(source, /receipt_quantity_exceeds_remaining/);
  assert.match(source, /status IN \('draft','approved'\)/);
  assert.match(source, /UPDATE purchase_order_items[\s\S]+received_quantity = received_quantity \+ \$1/);
  assert.match(source, /SET quantity = inventory\.quantity \+ EXCLUDED\.quantity/);
  assert.match(source, /'purchase_receipt'/);
  assert.match(source, /await client\.query\("COMMIT"\)/);
});

test("procurement migration protects data from Supabase browser roles", async () => {
  const migration = await fs.readFile(new URL("../src/db/migration_procurement.sql", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE\(organization_id, receipt_reference\)/);
  assert.match(migration, /request_hash CHAR\(64\) NOT NULL/);
  assert.match(migration, /uq_suppliers_org_name_ci/);
  assert.match(migration, /suppliers_vat_number_format_check/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE[^;]+anon, authenticated/);
  assert.match(migration, /received_quantity <= ordered_quantity/);
  assert.equal(migrationFiles.includes("migration_procurement.sql"), true);
  assert.equal(migrationFiles.indexOf("migration_api_surface_security.sql") < migrationFiles.indexOf("migration_procurement.sql"), true);
});

test("inventory transfers accept unique positive whole quantities only", () => {
  assert.deepEqual(validateTransferItems([
    { partId: 4, quantity: "7" },
    { partId: 8, quantity: 1 },
  ]).items, [
    { partId: 4, quantity: 7 },
    { partId: 8, quantity: 1 },
  ]);
  assert.equal(validateTransferItems([{ partId: 4, quantity: 0 }]).error, "invalid_transfer_items");
  assert.equal(validateTransferItems([
    { partId: 4, quantity: 1 },
    { partId: 4, quantity: 2 },
  ]).error, "invalid_transfer_items");
});

test("transfer receipt lines keep good and damaged quantities separate", () => {
  assert.deepEqual(validateTransferReceiptItems([
    { transferItemId: 3, receivedQuantity: 7, damagedQuantity: 1 },
  ]).items, [{ transferItemId: 3, receivedQuantity: 7, damagedQuantity: 1 }]);
  assert.equal(validateTransferReceiptItems([
    { transferItemId: 3, receivedQuantity: -1, damagedQuantity: 0 },
  ]).error, "invalid_transfer_receipt_items");
  assert.equal(validateTransferReceiptItems([
    { transferItemId: 3, receivedQuantity: 1 },
    { transferItemId: 3, receivedQuantity: 1 },
  ]).error, "invalid_transfer_receipt_items");
});

test("transfer request and receipt idempotency hashes ignore line order", () => {
  const request = inventoryTransferRequestHash(1, 2, [
    { partId: 9, quantity: 2 }, { partId: 4, quantity: 5 },
  ]);
  const requestReordered = inventoryTransferRequestHash(1, 2, [
    { partId: 4, quantity: 5 }, { partId: 9, quantity: 2 },
  ]);
  const receipt = inventoryTransferReceiptHash(7, [
    { transferItemId: 5, receivedQuantity: 2, damagedQuantity: 0 },
    { transferItemId: 3, receivedQuantity: 4, damagedQuantity: 1 },
  ]);
  const receiptReordered = inventoryTransferReceiptHash(7, [
    { transferItemId: 3, receivedQuantity: 4, damagedQuantity: 1 },
    { transferItemId: 5, receivedQuantity: 2, damagedQuantity: 0 },
  ]);
  assert.equal(request, requestReordered);
  assert.equal(receipt, receiptReordered);
  assert.notEqual(request, inventoryTransferRequestHash(1, 2, [
    { partId: 4, quantity: 5 }, { partId: 9, quantity: 2 },
  ], "ملاحظة مختلفة"));
  assert.notEqual(receipt, inventoryTransferReceiptHash(7, [
    { transferItemId: 3, receivedQuantity: 4, damagedQuantity: 1 },
    { transferItemId: 5, receivedQuantity: 2, damagedQuantity: 0 },
  ], "سبب الفرق"));
  assert.match(request, /^[0-9a-f]{64}$/);
  assert.match(receipt, /^[0-9a-f]{64}$/);
});

test("branch transfer shipment and receipt are tenant, branch, device, and transaction scoped", async () => {
  const source = await fs.readFile(new URL("../src/routes/transfers.js", import.meta.url), "utf8");
  assert.match(source, /requireRole\("admin", "warehouse_keeper"\), deviceRequired/);
  assert.match(source, /t\.organization_id = \$1/);
  assert.match(source, /p\.organization_id = \$3/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /transfer_source_device_required/);
  assert.match(source, /transfer_destination_device_required/);
  assert.match(source, /transfer_insufficient_source_stock/);
  assert.match(source, /transfer_receipt_all_lines_required/);
  assert.match(source, /transfer_variance_note_required/);
  assert.match(source, /'transfer_out'/);
  assert.match(source, /'transfer_in'/);
  assert.match(source, /await client\.query\("COMMIT"\)/);
});

test("inventory transfer migration is append-only, protected, and ordered after procurement", async () => {
  const migration = await fs.readFile(new URL("../src/db/migration_inventory_transfers.sql", import.meta.url), "utf8");
  assert.match(migration, /CHECK \(source_branch_id <> destination_branch_id\)/);
  assert.match(migration, /UNIQUE\(organization_id, request_reference\)/);
  assert.match(migration, /receipt_hash CHAR\(64\)/);
  assert.match(migration, /received_quantity \+ damaged_quantity <= shipped_quantity/);
  assert.match(migration, /transfer_out.*transfer_in/s);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.inventory_transfers/);
  assert.equal(migrationFiles.includes("migration_inventory_transfers.sql"), true);
  assert.equal(migrationFiles.indexOf("migration_procurement.sql") < migrationFiles.indexOf("migration_inventory_transfers.sql"), true);
});

test("outbound network policy allows only exact HTTPS origins", () => {
  assert.equal(
    validateOutboundUrl("https://api.moyasar.com/v1/payments", ["https://api.moyasar.com"]).origin,
    "https://api.moyasar.com"
  );
  assert.throws(() => validateOutboundUrl("http://api.moyasar.com/v1/payments", ["https://api.moyasar.com"]));
  assert.throws(() => validateOutboundUrl("https://api.moyasar.com.evil.example/v1", ["https://api.moyasar.com"]));
  assert.throws(() => validateOutboundUrl("https://token@api.moyasar.com/v1", ["https://api.moyasar.com"]));
});

test("external catalog providers are adopted but disabled until licensed", () => {
  const providers = getCatalogProviderStatuses({});
  assert.deepEqual(providers.map(({ id, status }) => ({ id, status })), [
    { id: "7zap-levam", status: "disabled" },
    { id: "partsouq", status: "disabled" },
  ]);
  assert.equal(providers.every((provider) => provider.enabled === false), true);
  assert.equal(JSON.stringify(providers).includes("API_KEY"), false);
  assert.doesNotThrow(() => validateCatalogProviderConfiguration({}));
});

test("external catalogs fail closed without licence, credentials, and connector validation", () => {
  assert.throws(
    () => validateCatalogProviderConfiguration({ CATALOG_7ZAP_LEVAM_ENABLED: "true" }),
    /license_approval_required/
  );
  assert.throws(
    () => validateCatalogProviderConfiguration({
      CATALOG_PARTSOUQ_ENABLED: "true",
      CATALOG_PARTSOUQ_LICENSE_APPROVED: "true",
    }),
    /api_key_required/
  );
  assert.throws(
    () => validateCatalogProviderConfiguration({
      CATALOG_PARTSOUQ_ENABLED: "true",
      CATALOG_PARTSOUQ_LICENSE_APPROVED: "true",
      PARTSOUQ_API_KEY: "test-key",
    }),
    /connector_validation_required/
  );
});

test("ZATCA transport is fail-closed and never accepts a configurable host", () => {
  assert.deepEqual(getZatcaConfiguration({}), {
    enabled: false,
    environment: "simulation",
    organizationId: null,
    credentialsConfigured: false,
    productionApproved: false,
    endpoint: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/reporting/single",
    transportReady: false,
  });
  assert.throws(() => validateZatcaRuntimeConfiguration({ ZATCA_INTEGRATION_ENABLED: "true" }));
  assert.throws(() => validateZatcaRuntimeConfiguration({
    ZATCA_INTEGRATION_ENABLED: "true",
    ZATCA_ENVIRONMENT: "production",
    ZATCA_BINARY_SECURITY_TOKEN: "certificate",
    ZATCA_SECRET: "secret",
    ZATCA_ORGANIZATION_ID: "7",
  }));
  const bound = validateZatcaRuntimeConfiguration({
    ZATCA_INTEGRATION_ENABLED: "true",
    ZATCA_ENVIRONMENT: "simulation",
    ZATCA_BINARY_SECURITY_TOKEN: "certificate",
    ZATCA_SECRET: "secret",
    ZATCA_ORGANIZATION_ID: "7",
  });
  assert.equal(bound.organizationId, 7);
  assert.equal(bound.transportReady, true);
});

test("ZATCA signed document validation binds UUID and seller VAT without persisting XML", () => {
  const uuid = "760878ec-d1d3-5f72-9056-191683faa872";
  const xml = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:UUID>${uuid}</cbc:UUID><cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode><cac:AccountingSupplierParty><cac:PartyTaxScheme><cbc:CompanyID schemeID="VAT">310123456700003</cbc:CompanyID></cac:PartyTaxScheme></cac:AccountingSupplierParty></Invoice>`;
  const result = validateSignedInvoicePackage({
    invoiceUuid: uuid,
    invoiceHash: Buffer.alloc(32, 1).toString("base64"),
    invoiceBase64: Buffer.from(xml).toString("base64"),
  });
  assert.equal(result.error, undefined);
  assert.equal(signedInvoiceMatchesOrganization(result.value, "310123456700003"), true);
  assert.equal(signedInvoiceMatchesOrganization(result.value, "310123456700004"), false);
  assert.equal(validateSignedInvoicePackage({ invoiceUuid: uuid, invoiceHash: "bad", invoiceBase64: "bad" }).error, "invalid_zatca_invoice_hash");
});

test("Saudi compliance migration protects a metadata-only government audit trail", async () => {
  const migration = await fs.readFile(new URL("../src/db/migration_saudi_compliance.sql", import.meta.url), "utf8");
  const route = await fs.readFile(new URL("../src/routes/compliance.js", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS government_integration_attempts/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE government_integration_attempts/);
  assert.match(migration, /uq_government_attempts_active_invoice/);
  assert.match(migration, /status IN \('processing','reported','cleared','manual_review'\)/);
  assert.doesNotMatch(migration, /xml_payload|invoice_base64|binary_security_token|customer_name/);
  assert.match(route, /signedInvoiceMatchesOrganization/);
  assert.match(route, /configuration\.organizationId !== organizationId/);
  assert.match(route, /request_reference/);
  assert.doesNotMatch(route, /INSERT INTO government_integration_attempts[\s\S]+invoiceBase64/);
  assert.equal(migrationFiles.includes("migration_saudi_compliance.sql"), true);
  assert.equal(migrationFiles.indexOf("migration_branch_manager.sql") < migrationFiles.indexOf("migration_saudi_compliance.sql"), true);
});

test("security monitor emits aggregate counts and avoids sensitive identifiers", async () => {
  const source = await fs.readFile(new URL("../scripts/security-monitor.js", import.meta.url), "utf8");
  assert.match(source, /high_security_events_15m/);
  assert.match(source, /stuck_government_attempts/);
  assert.match(source, /government_attempts_requiring_review/);
  assert.match(source, /process\.exitCode = 2/);
  assert.doesNotMatch(source, /SELECT[^;]+organization_id|SELECT[^;]+user_id|SELECT[^;]+invoice_id|SELECT[^;]+ip_hash/is);
});
