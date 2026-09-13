import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("catalog management exposes vehicle compatibility through authenticated API functions", async () => {
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");

  assert.equal(api.includes("getPartApplications"), true);
  assert.equal(api.includes("createPartApplication"), true);
  assert.equal(api.includes("updatePartApplicationStatus"), true);
  assert.equal(api.includes("deletePartApplication"), true);
  assert.equal(api.includes("/catalog/parts/${partId}/applications"), true);
});

test("new catalog controls remain bilingual and keyboard accessible", async () => {
  const view = await fs.readFile(new URL("../src/pages/PartsManagementView.jsx", import.meta.url), "utf8");
  const strings = await fs.readFile(new URL("../src/i18n/LanguageContext.jsx", import.meta.url), "utf8");

  assert.equal(view.includes('t("catalog_vehicle_compatibility")'), true);
  assert.equal(view.includes('t("catalog_oem_numbers")'), true);
  assert.equal(view.includes('t("catalog_cross_references")'), true);
  assert.equal(view.includes('event.key === "Escape"'), true);
  assert.equal((strings.match(/catalog_vehicle_compatibility:/g) || []).length, 2);
  assert.equal((strings.match(/catalog_verified:/g) || []).length, 2);
});

test("catalog form exposes OEM, manufacturer, barcode and compatibility review", async () => {
  const view = await fs.readFile(new URL("../src/pages/PartsManagementView.jsx", import.meta.url), "utf8");

  assert.equal(view.includes("oemNumbers"), true);
  assert.equal(view.includes("crossReferenceNumbers"), true);
  assert.equal(view.includes("manufacturer"), true);
  assert.equal(view.includes("barcode"), true);
  assert.equal(view.includes("VehicleApplicationsPanel"), true);
});
