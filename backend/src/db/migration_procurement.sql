BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vat_number TEXT,
  phone TEXT,
  email TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  UNIQUE(organization_id, name)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM suppliers
    GROUP BY organization_id, lower(name)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate suppliers found after case normalization; merge them before procurement migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_vat_number_format_check'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_vat_number_format_check
      CHECK (vat_number IS NULL OR vat_number ~ '^[0-9]{15}$') NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_org_name_ci
  ON suppliers(organization_id, lower(name));

CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  po_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','partially_received','received','cancelled')),
  currency CHAR(3) NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  expected_at DATE,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, po_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
  received_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  UNIQUE(purchase_order_id, part_id)
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  receipt_reference TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  received_by INTEGER NOT NULL REFERENCES users(id),
  device_id INTEGER NOT NULL REFERENCES organization_devices(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, receipt_reference)
);

CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_receipt_id BIGINT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  UNIQUE(purchase_receipt_id, purchase_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_org_status
  ON suppliers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_created
  ON purchase_orders(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_status
  ON purchase_orders(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order
  ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_order
  ON purchase_receipts(purchase_order_id, created_at DESC);

DO $$
DECLARE
  table_name TEXT;
  protected_tables TEXT[] := ARRAY[
    'suppliers', 'purchase_orders', 'purchase_order_items',
    'purchase_receipts', 'purchase_receipt_items'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

COMMIT;
