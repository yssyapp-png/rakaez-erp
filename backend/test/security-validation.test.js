import test from "node:test";
import assert from "node:assert/strict";
import { isNonNegativeInteger, isNonNegativeMoney } from "../src/routes/parts.js";
import { hasValidItems } from "../src/routes/sales.js";
import { subscriptionAllowsAccess } from "../src/routes/auth.js";
import { SAUDI_STARTER_CATALOG } from "../src/routes/catalog.js";
import { normalizeVin } from "../src/routes/vehicles.js";

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
