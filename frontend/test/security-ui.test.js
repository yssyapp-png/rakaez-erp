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

test("logout clears user, device, and pending-payment state", async () => {
  const api = await fs.readFile(new URL("../src/api/client.js", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(api, /removeItem\("deviceToken"\)/);
  assert.match(api, /sessionStorage\.removeItem\("token"\)/);
  assert.match(api, /localStorage\.removeItem\("token"\)/);
  assert.match(api, /removeItem\("rakaez_pending_payment"\)/);
  assert.match(app, /removeItem\("rakaez_pending_payment"\)/);
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

test("public web experience is bilingual, responsive, and connected to authentication", async () => {
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const landing = await fs.readFile(new URL("../src/components/LandingPage.jsx", import.meta.url), "utf8");
  const i18n = await fs.readFile(new URL("../src/i18n/LanguageContext.jsx", import.meta.url), "utf8");
  const theme = await fs.readFile(new URL("../src/theme.css", import.meta.url), "utf8");

  assert.match(app, /LandingPage/);
  assert.match(app, /onCreateShop=\{\(\) => openAuth\("new-shop"\)\}/);
  assert.match(landing, /id="capabilities"/);
  assert.match(landing, /landing_feature_vehicle_title/);
  assert.match(i18n, /شغّل محل قطع الغيار من منصة واحدة/);
  assert.match(i18n, /Run your auto-parts business from one platform/);
  assert.match(i18n, /document\.documentElement\.dir/);
  assert.match(theme, /@media \(max-width: 680px\)/);
  assert.match(theme, /prefers-reduced-motion/);
});

test("web page publishes secure bilingual social metadata", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /ركائز \| Rakaez/);
  assert.match(html, /property="og:image" content="\/og\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
});
