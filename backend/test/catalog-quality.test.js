import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";

test("catalog compatibility review remains administrator and tenant scoped", async () => {
  const catalog = await fs.readFile(new URL("../src/routes/catalog.js", import.meta.url), "utf8");
  const index = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8");

  assert.equal(index.includes('app.use("/api/catalog", authRequired, requireRole("admin"), catalogRouter)'), true);
  assert.equal(catalog.includes('router.patch("/applications/:applicationId/status"'), true);
  assert.equal(catalog.includes('["unverified", "verified", "rejected"].includes(status)'), true);
  assert.equal(catalog.includes("AND organization_id = $3"), true);
  assert.equal(catalog.includes('router.delete("/applications/:applicationId"'), true);
  assert.equal(catalog.includes("AND organization_id = $2"), true);
});

test("manual compatibility stays unverified until administrator review", async () => {
  const catalog = await fs.readFile(new URL("../src/routes/catalog.js", import.meta.url), "utf8");
  const parts = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");

  assert.equal(catalog.includes("'SA','manual','unverified'"), true);
  assert.equal(catalog.includes("'SA','manual','verified'"), false);
  assert.equal(parts.includes("va.verification_status = 'verified'"), true);
});


test("new catalog parts persist searchable catalog metadata", () => {
  const source = readFileSync(new URL("../src/routes/parts.js", import.meta.url), "utf8");

  assert.match(source, /INSERT INTO parts \([\s\S]*barcode,[\s\S]*manufacturer,[\s\S]*oem_numbers,[\s\S]*cross_reference_numbers/);
  assert.match(source, /quality_grade/);
  assert.match(source, /country_of_origin/);
  assert.match(source, /warranty_months/);
  assert.match(source, /catalog_status/);
  assert.match(source, /normalizeCatalogCodes\(oemNumbers\)/);
  assert.match(source, /normalizeCatalogCodes\(crossReferenceNumbers\)/);
  assert.match(source, /normalizeCatalogText\(barcode,\s*120\)/);
  assert.match(source, /normalizeCatalogText\(manufacturer,\s*120\)/);
  assert.match(source, /catalogStatus \|\| "active"/);
});

test("catalog metadata validates OEM references and warranty bounds", async () => {
  const parts = await fs.readFile(new URL("../src/routes/parts.js", import.meta.url), "utf8");

  assert.equal(parts.includes("function normalizeCatalogCodes"), true);
  assert.equal(parts.includes("items.length > 50"), true);
  assert.equal(parts.includes("item.length > 120"), true);
  assert.equal(parts.includes("invalid_oem_numbers"), true);
  assert.equal(parts.includes("invalid_cross_reference_numbers"), true);
  assert.equal(parts.includes("Number(warrantyMonths) > 240"), true);
  assert.equal(parts.includes("oem_numbers = COALESCE"), true);
  assert.equal(parts.includes("cross_reference_numbers = COALESCE"), true);
});
