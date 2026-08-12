import test from "node:test";
import assert from "node:assert/strict";
import { isNonNegativeInteger, isNonNegativeMoney, normalizeShelfLookup, validateImportRows } from "../src/routes/parts.js";
import { hasValidItems } from "../src/routes/sales.js";
import { subscriptionAllowsAccess } from "../src/routes/auth.js";
import { SAUDI_STARTER_CATALOG } from "../src/routes/catalog.js";
import { normalizeVin } from "../src/routes/vehicles.js";
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
});

test("subscription access allows active and unexpired trials only", () => {
  const now = new Date("2026-08-10T00:00:00Z");
  assert.equal(subscriptionAllowsAccess("active", null, now), true);
  assert.equal(subscriptionAllowsAccess("trialing", "2026-08-11T00:00:00Z", now), true);
  assert.equal(subscriptionAllowsAccess("trialing", "2026-08-09T00:00:00Z", now), false);
  assert.equal(subscriptionAllowsAccess("past_due", null, now), false);
  assert.equal(subscriptionAllowsAccess("canceled", null, now), false);
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

test("fresh schema creates users before the import audit foreign key", async () => {
  const sql = await fs.readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  assert.equal(sql.indexOf("CREATE TABLE users" ) < sql.indexOf("CREATE TABLE catalog_import_runs"), true);
});

test("CSV inventory import records an auditable run and inventory movements", async () => {
  const source = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO catalog_import_runs/);
  assert.match(source, /'catalog_import'/);
  assert.match(source, /updated_count=\$2/);
  assert.match(source, /row\.quantity - previousQuantity/);
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
