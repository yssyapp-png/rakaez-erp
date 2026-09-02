import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  displayNameAr: text("display_name_ar").notNull(),
  displayNameEn: text("display_name_en").notNull(),
  status: text("status", { enum: ["trial", "active", "past_due", "suspended", "cancelled"] }).notNull().default("trial"),
  createdAt,
});

export const shops = sqliteTable("shops", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  city: text("city").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt,
}, (table) => [
  uniqueIndex("shops_org_code_uq").on(table.organizationId, table.code),
  index("shops_org_idx").on(table.organizationId),
]);

export const parts = sqliteTable("parts", {
  id: text("id").primaryKey(),
  manufacturerId: text("manufacturer_id"),
  partNumberOriginal: text("part_number_original").notNull(),
  partNumberNormalized: text("part_number_normalized").notNull(),
  brandCode: text("brand_code").notNull(),
  gtin: text("gtin"),
  status: text("status", { enum: ["draft", "reviewed", "approved", "archived"] }).notNull().default("draft"),
  sourceName: text("source_name").notNull(),
  sourceVersion: text("source_version").notNull(),
  createdAt,
}, (table) => [
  uniqueIndex("parts_brand_number_uq").on(table.brandCode, table.partNumberNormalized),
  index("parts_number_idx").on(table.partNumberNormalized),
]);

export const partTranslations = sqliteTable("part_translations", {
  id: text("id").primaryKey(),
  partId: text("part_id").notNull().references(() => parts.id),
  locale: text("locale", { enum: ["ar", "en"] }).notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  reviewStatus: text("review_status", { enum: ["draft", "reviewed", "approved", "published"] }).notNull().default("draft"),
  reviewedBy: text("reviewed_by"),
  sourceVersion: text("source_version").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [uniqueIndex("part_translations_part_locale_uq").on(table.partId, table.locale)]);

export const stockLocations = sqliteTable("stock_locations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  shopId: text("shop_id").notNull().references(() => shops.id),
  code: text("code").notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  createdAt,
}, (table) => [
  uniqueIndex("stock_locations_shop_code_uq").on(table.shopId, table.code),
  index("stock_locations_org_idx").on(table.organizationId),
]);

export const inventoryItems = sqliteTable("inventory_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  shopId: text("shop_id").notNull().references(() => shops.id),
  locationId: text("location_id").notNull().references(() => stockLocations.id),
  partId: text("part_id").notNull().references(() => parts.id),
  shelfCode: text("shelf_code").notNull(),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(0),
  offlineAllocation: integer("offline_allocation").notNull().default(0),
  unitCostMinor: integer("unit_cost_minor").notNull().default(0),
  salePriceMinor: integer("sale_price_minor").notNull().default(0),
  currency: text("currency").notNull().default("SAR"),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  uniqueIndex("inventory_location_part_uq").on(table.locationId, table.partId),
  index("inventory_org_shop_idx").on(table.organizationId, table.shopId),
  check("inventory_non_negative_ck", sql`${table.onHand} >= 0 AND ${table.reserved} >= 0 AND ${table.reorderPoint} >= 0 AND ${table.offlineAllocation} >= 0`),
  check("inventory_reserved_limit_ck", sql`${table.reserved} <= ${table.onHand}`),
  check("inventory_prices_non_negative_ck", sql`${table.unitCostMinor} >= 0 AND ${table.salePriceMinor} >= 0`),
]);

export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  shopId: text("shop_id").notNull().references(() => shops.id),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItems.id),
  movementType: text("movement_type", { enum: ["receive", "reserve", "release", "sale", "return", "transfer", "stocktake", "adjustment"] }).notNull(),
  quantityDelta: integer("quantity_delta").notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId: text("reference_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  actorId: text("actor_id").notNull(),
  deviceId: text("device_id"),
  createdAt,
}, (table) => [
  uniqueIndex("stock_movements_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  index("stock_movements_item_idx").on(table.inventoryItemId, table.createdAt),
]);

export const workshopRequests = sqliteTable("workshop_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  workshopName: text("workshop_name").notNull(),
  vehicleVin: text("vehicle_vin"),
  vehicleLabel: text("vehicle_label").notNull(),
  requestedPartNumber: text("requested_part_number").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status", { enum: ["requested", "quoted", "accepted", "reserved", "picking", "ready", "dispatched", "delivered", "returned", "cancelled"] }).notNull().default("requested"),
  expiresAt: text("expires_at").notNull(),
  createdAt,
}, (table) => [
  index("workshop_requests_org_status_idx").on(table.organizationId, table.status),
  check("workshop_requests_quantity_positive_ck", sql`${table.quantity} > 0`),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt,
}, (table) => [index("audit_events_org_created_idx").on(table.organizationId, table.createdAt)]);

export const vehicleVinRecords = sqliteTable("vehicle_vin_records", {
  vin: text("vin").primaryKey(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  modelYear: text("model_year").notNull(),
  engine: text("engine").notNull().default(""),
  sourceName: text("source_name").notNull(),
  sourceVersion: text("source_version").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [index("vehicle_vin_make_model_idx").on(table.make, table.model)]);

export const salesInvoices = sqliteTable("sales_invoices", {
  id: text("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  transactionType: text("transaction_type", { enum: ["sale", "purchase"] }).notNull().default("sale"),
  invoiceType: text("invoice_type", { enum: ["simplified", "standard"] }).notNull(),
  status: text("status", { enum: ["issued", "cancelled"] }).notNull().default("issued"),
  customerName: text("customer_name").notNull(),
  customerVatNumber: text("customer_vat_number").notNull().default(""),
  sellerName: text("seller_name").notNull(),
  sellerVatNumber: text("seller_vat_number").notNull(),
  sellerAddress: text("seller_address").notNull(),
  paymentMethod: text("payment_method", { enum: ["cash", "card", "transfer"] }).notNull(),
  currency: text("currency").notNull().default("SAR"),
  subtotalMinor: integer("subtotal_minor").notNull(),
  discountMinor: integer("discount_minor").notNull().default(0),
  vatMinor: integer("vat_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  issuedAt: text("issued_at").notNull(),
  createdAt,
}, (table) => [
  uniqueIndex("sales_invoices_number_uq").on(table.invoiceNumber),
  index("sales_invoices_issued_idx").on(table.issuedAt),
  index("sales_invoices_customer_idx").on(table.customerName),
  check("sales_invoices_totals_non_negative_ck", sql`${table.subtotalMinor} >= 0 AND ${table.discountMinor} >= 0 AND ${table.vatMinor} >= 0 AND ${table.totalMinor} >= 0`),
]);

export const salesInvoiceLines = sqliteTable("sales_invoice_lines", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => salesInvoices.id),
  partNumber: text("part_number").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  discountMinor: integer("discount_minor").notNull().default(0),
  vatRateBps: integer("vat_rate_bps").notNull().default(1500),
  vatMinor: integer("vat_minor").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
}, (table) => [
  index("sales_invoice_lines_invoice_idx").on(table.invoiceId),
  check("sales_invoice_lines_values_ck", sql`${table.quantity} > 0 AND ${table.unitPriceMinor} >= 0 AND ${table.discountMinor} >= 0 AND ${table.vatMinor} >= 0 AND ${table.lineTotalMinor} >= 0`),
]);

export const cashMovements = sqliteTable("cash_movements", {
  id: text("id").primaryKey(),
  movementType: text("movement_type", { enum: ["cash_sale", "cash_purchase", "deposit", "withdrawal", "adjustment"] }).notNull(),
  amountMinor: integer("amount_minor").notNull(),
  cashierName: text("cashier_name").notNull(),
  depositReference: text("deposit_reference").notNull().default(""),
  invoiceId: text("invoice_id").references(() => salesInvoices.id),
  note: text("note").notNull().default(""),
  createdAt,
}, (table) => [
  index("cash_movements_created_idx").on(table.createdAt),
  index("cash_movements_type_idx").on(table.movementType),
  check("cash_movements_amount_positive_ck", sql`${table.amountMinor} > 0`),
]);
