import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateInvoiceTotals } from "../app/invoice-math.ts";

const app = await readFile(new URL("../app/rakaez-app.tsx",import.meta.url),"utf8");
const view = await readFile(new URL("../app/invoice-view.tsx",import.meta.url),"utf8");
const route = await readFile(new URL("../app/api/invoices/route.ts",import.meta.url),"utf8");
const cashRoute = await readFile(new URL("../app/api/cash/route.ts",import.meta.url),"utf8");
const migration = await readFile(new URL("../drizzle/0002_overjoyed_cyclops.sql",import.meta.url),"utf8");
const cashMigration = await readFile(new URL("../drizzle/0003_robust_lady_deathstrike.sql",import.meta.url),"utf8");

test("calculates Saudi 15% VAT after line discounts in integer halalas",()=>{
  const total = calculateInvoiceTotals([{ quantity:2, unitPrice:100, discount:20 }]);
  assert.deepEqual({ subtotal:total.subtotalMinor, discount:total.discountMinor, vat:total.vatMinor, total:total.totalMinor },{ subtotal:20000, discount:2000, vat:2700, total:20700 });
});

test("adds a bilingual operational invoice workspace",()=>{
  assert.match(app,/"invoices"/);
  assert.match(view,/الفوترة الإلكترونية/);
  assert.match(view,/Electronic invoicing/);
  assert.match(view,/window\.print\(\)/);
  assert.match(view,/\/api\/invoices/);
});

test("validates VAT identities and persists invoice headers and lines atomically",()=>{
  assert.match(route,/\^3\\d\{13\}3\$/);
  assert.match(route,/env\.DB\.batch/);
  assert.match(route,/calculateInvoiceTotals/);
  assert.match(migration,/CREATE TABLE `sales_invoices`/);
  assert.match(migration,/CREATE TABLE `sales_invoice_lines`/);
  assert.match(migration,/sales_invoices_number_uq/);
});

test("records cash sales and deposits as an append-only audit trail",()=>{
  assert.match(app,/CashControlView/);
  assert.match(app,/"cash"/);
  assert.match(cashRoute,/INSERT INTO cash_movements/);
  assert.match(cashRoute,/ORDER BY created_at DESC LIMIT 100/);
  assert.match(cashRoute,/depositReference/);
  assert.match(cashRoute,/purchasesMinor/);
  assert.match(cashMigration,/CREATE TABLE `cash_movements`/);
  assert.match(cashMigration,/cash_movements_amount_positive_ck/);
});

test("links sale and purchase invoices to cash or network payment method",()=>{
  assert.match(view,/transactionType/);
  assert.match(view,/value="purchase"/);
  assert.match(view,/value="card"/);
  assert.match(route,/transaction_type/);
  assert.match(route,/cash_purchase/);
});
