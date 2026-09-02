import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const app = await readFile(new URL("../app/rakaez-app.tsx", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../app/i18n.ts", import.meta.url), "utf8");
const dashboardRoute = await readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
const catalogRoute = await readFile(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8");
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true, hmr: false } });

after(async () => {
  await vite.close();
});

test("keeps Arabic and English behind one strict translation contract", async () => {
  const i18n = await vite.ssrLoadModule("/app/i18n.ts");
  assert.equal(i18n.assertTranslationParity(), true);
  assert.match(i18nSource, /satisfies Record<Locale, TranslationShape>/);
  assert.equal(Object.keys(i18n.translations.ar).length, Object.keys(i18n.translations.en).length);
  assert.doesNotMatch(JSON.stringify(i18n.translations.en), /[\u0600-\u06FF]/);
});

test("selects, persists, and applies locale direction automatically", () => {
  assert.match(app, /resolveLocale\(navigator\.language\)/);
  assert.match(app, /localStorage\.getItem\("rakaez-locale"\)/);
  assert.match(app, /localStorage\.setItem\("rakaez-locale", locale\)/);
  assert.match(app, /document\.documentElement\.dir = locale === "ar" \? "rtl" : "ltr"/);
  assert.match(app, /document\.documentElement\.lang = locale/);
});

test("keeps manufacturer identifiers left-to-right", () => {
  assert.match(app, /<code dir="ltr">\{part\.number\}<\/code>/);
  assert.match(app, /<b dir="ltr">\{part\.shelf\}<\/b>/);
});

test("routes a valid VIN from the shared header search", () => {
  assert.match(app, /const searchFromHeader = \(\) =>/);
  assert.match(app, /if \(\/\^\[A-HJ-NPR-Z0-9\]\{17\}\$\/\.test\(candidate\)\) void lookupVin\(candidate\)/);
  assert.match(app, /placeholder=\{t\.search\}/);
  assert.match(app, /className="global-search"><Search/);
  assert.doesNotMatch(app, /className="vin-panel"/);
});

test("keeps inventory identity and quantities stable when a translation is missing", () => {
  assert.match(dashboardRoute, /fallbackLocale = locale === "ar" \? "en" : "ar"/);
  assert.match(dashboardRoute, /\.leftJoin\(requestedTranslation/);
  assert.match(dashboardRoute, /\.leftJoin\(fallbackTranslation/);
  assert.match(dashboardRoute, /coalesce\(\$\{requestedTranslation\.name\}, \$\{fallbackTranslation\.name\}, \$\{parts\.partNumberOriginal\}\)/);
  assert.doesNotMatch(dashboardRoute, /\.innerJoin\(partTranslations/);
  assert.match(app, /t\.translationPending/);
});

test("searches the same catalog by identifier and either language without dropping parts", () => {
  assert.match(catalogRoute, /identifierQuery/);
  assert.match(catalogRoute, /like\(requestedTranslation\.name, textPattern\)/);
  assert.match(catalogRoute, /like\(fallbackTranslation\.name, textPattern\)/);
  assert.match(catalogRoute, /\.leftJoin\(requestedTranslation/);
  assert.match(catalogRoute, /\.leftJoin\(fallbackTranslation/);
  assert.doesNotMatch(catalogRoute, /\.innerJoin\(partTranslations/);
});
