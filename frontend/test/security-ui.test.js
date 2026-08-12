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
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /on_initiating/);
  assert.match(source, /metadata: paymentMetadata/);
  assert.match(source, /window\.location\.origin/);
  assert.match(source, /credit_card: \{ save_card: true \}/);
  assert.match(source, /on_failure/);
  assert.match(html, /moyasar-payment-form@2\.2\.10/);
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
  assert.match(api, /removeItem\("rakaez_pending_payment"\)/);
  assert.match(app, /removeItem\("rakaez_pending_payment"\)/);
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
