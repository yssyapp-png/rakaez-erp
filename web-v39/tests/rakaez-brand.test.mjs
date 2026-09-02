import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../app/rakaez-app.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../app/i18n.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
const projectScope = await readFile(new URL("../docs/PROJECT-SCOPE.md", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("uses Rakaez production metadata without temporary branding", () => {
  assert.match(layout, /ركائز لقطع غيار السيارات/);
  assert.doesNotMatch(`${layout}\n${app}\n${i18n}\n${projectScope}`, /chatgpt|yssyapp|codex-preview/i);
});

test("uses the approved gold Rakaez logo in the sidebar and command center", () => {
  assert.equal((app.match(/\/rakaez-logo-gold\.png/g) || []).length, 2);
  assert.doesNotMatch(app, /\/rakaez-new-logo\.png/);
});

test("keeps the command-center logo right, copy centered, and date left", () => {
  assert.match(styles, /\.welcome-emblem[^}]*right:30px[^}]*left:auto/);
  assert.match(styles, /\.welcome-copy[^}]*margin-inline:auto[^}]*text-align:center/);
  assert.match(styles, /\.date-block[^}]*left:30px/);
});

test("shows the merged operational capabilities in both languages", () => {
  assert.match(i18n, /مشتريات واستلام آمن/);
  assert.match(i18n, /Secure purchasing and receiving/);
  assert.match(i18n, /تحويلات موثقة بين الفروع/);
  assert.match(i18n, /Audited transfers between branches/);
  assert.match(i18n, /امتثال سعودي ومراقبة مستمرة/);
  assert.match(i18n, /Saudi compliance and continuous monitoring/);
});

test("labels vehicle make, model, year, and engine above their values in both languages", () => {
  assert.match(i18n, /make: "الشركة المصنعة"/);
  assert.match(i18n, /model: "الموديل"/);
  assert.match(i18n, /year: "سنة الموديل"/);
  assert.match(i18n, /engine: "المحرك"/);
  assert.match(i18n, /make: "Make"/);
  assert.match(i18n, /model: "Model"/);
  assert.match(i18n, /year: "Model Year"/);
  assert.match(i18n, /engine: "Engine"/);
  assert.doesNotMatch(i18n, /مثال:|Example:/);
  assert.doesNotMatch(app, /vehicle-field-help/);
  assert.match(app, /className="vehicle-field"><label>/);
  assert.match(app, /aria-label=\{t\.vehicle\.engine\}/);
  assert.match(app, /key=\{vehicleMake \|\| "model-disabled"\}/);
  assert.match(app, /disabled=\{!vehicleModel\}/);
  assert.match(app, /disabled=\{!vehicleYear\}/);
  assert.match(app, /vehicleModelYears\.map/);
  assert.match(app, /vehicleEngines\.map/);
  assert.match(app, /className=\{`vehicle-selected-value/);
});

test("searches Saudi-market makes by the first Arabic or English letter and loads models", () => {
  assert.match(app, /vehicleBrandArabic/);
  assert.match(app, /startsWith\(search\)/);
  assert.match(app, /id="vehicle-make-search"/);
  assert.match(app, /className="vehicle-make-suggestions"/);
  assert.match(app, /selectVehicleMake\(matchingVehicleMakes\[0\]\)/);
  assert.match(app, /setVehicleModel\(""\)/);
  assert.match(app, /Toyota: \["Camry", "Corolla"/);
  assert.match(app, /Jetour: \["X50", "X70"/);
});

test("provides a compact dedicated VIN search in both languages", () => {
  assert.match(app, /className="compact-vin-search"/);
  assert.match(app, /id="vehicle-vin"/);
  assert.match(app, /maxLength=\{17\}/);
  assert.match(app, /lookupVin\(vinQuery\)/);
  assert.match(i18n, /vin: "رقم الهيكل VIN"/);
  assert.match(i18n, /vin: "Vehicle VIN"/);
  assert.match(app, /normalizeIdentifierInput\(event\.target\.value\)/);
  assert.match(app, /unoptimized/);
  assert.match(app, /replace\(\/\[٠-٩\]\/g/);
  assert.match(app, /replace\(\/\[۰-۹\]\/g/);
});

test("provides persistent light and dark themes", () => {
  assert.match(app, /data-theme=\{theme\}/);
  assert.match(app, /rakaez-theme-mode/);
  assert.match(app, /hour >= 18 \|\| hour < 6/);
  assert.match(app, /value="auto"/);
  assert.match(styles, /linear-gradient\(145deg,#f4ebde,#eadbc6 62%,#efe3d2\)/);
  assert.match(styles, /data-theme="dark"[\s\S]*linear-gradient\(145deg,#160e0a,#21140e 62%,#1a100b\)/);
  assert.match(styles, /same beige-and-bronze design translated into deep brown/);
});

test("updates Gregorian, Hijri, parts, and inventory data dynamically", () => {
  assert.match(app, /islamic-umalqura/);
  assert.match(app, /u-ca-gregory/);
  assert.match(app, /setInterval\(refresh, 60_000\)/);
  assert.match(dashboard, /Cache-Control.*no-store/);
  assert.match(dashboard, /inventoryItems/);
});
