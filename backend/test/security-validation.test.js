import test from "node:test";
import assert from "node:assert/strict";
import { isNonNegativeInteger, isNonNegativeMoney, normalizeShelfLookup, normalizeWarehouseLookup, validateImportRows } from "../src/routes/parts.js";
import { hasValidItems } from "../src/routes/sales.js";
import { isAcceptablePassword, subscriptionAllowsAccess } from "../src/routes/auth.js";
import { isUuid, paymentMatches, refundableAmount } from "../src/utils/moyasar.js";
import { SAUDI_STARTER_CATALOG } from "../src/routes/catalog.js";
import { normalizeVin } from "../src/routes/vehicles.js";
import { asyncHandler } from "../src/utils/safe-router.js";
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

test("tenant login requires an organization code and never selects the first matching email", async () => {
  const source = await fs.readFile(new URL("../src/routes/auth.js", import.meta.url), "utf8");
  assert.match(source, /missing_login_fields/);
  assert.match(source, /upper\(o\.login_code\) = \$2/);
  assert.doesNotMatch(source, /ORDER BY id LIMIT 1/);
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
  assert.match(index, /Retry-After/);
  assert.match(index, /dotfiles: "deny"/);
  assert.match(index, /sendFile\(path\.join\(publicDirectory, "index\.html"\)/);
  assert.match(docker, /FROM node:22-alpine AS web-dependencies/);
  assert.match(docker, /COPY --from=web-build \/web\/dist \.\/public/);
});
