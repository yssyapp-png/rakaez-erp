BEGIN;

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS oem_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cross_reference_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'piece',
  ADD COLUMN IF NOT EXISTS quality_grade TEXT,
  ADD COLUMN IF NOT EXISTS country_of_origin TEXT,
  ADD COLUMN IF NOT EXISTS warranty_months INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS catalog_source TEXT,
  ADD COLUMN IF NOT EXISTS catalog_key TEXT;

ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_warranty_months_check;
ALTER TABLE parts ADD CONSTRAINT parts_warranty_months_check CHECK (warranty_months >= 0);
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_catalog_status_check;
ALTER TABLE parts ADD CONSTRAINT parts_catalog_status_check CHECK (catalog_status IN ('draft','active','archived'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_parts_catalog_source_key
  ON parts(organization_id, catalog_source, catalog_key)
  WHERE catalog_source IS NOT NULL AND catalog_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parts_barcode ON parts(organization_id, barcode);
CREATE INDEX IF NOT EXISTS idx_parts_oem_numbers ON parts USING GIN(oem_numbers);

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

CREATE TABLE IF NOT EXISTS part_suppliers (
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_part_number TEXT,
  purchase_price NUMERIC(10,2) CHECK (purchase_price >= 0),
  lead_time_days INTEGER CHECK (lead_time_days >= 0),
  is_preferred BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (part_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS vehicle_applications (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_from INTEGER,
  year_to INTEGER,
  engine TEXT,
  trim TEXT,
  market TEXT NOT NULL DEFAULT 'SA',
  source TEXT,
  source_vehicle_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','verified','rejected')),
  CHECK (year_from IS NULL OR year_from BETWEEN 1900 AND 2200),
  CHECK (year_to IS NULL OR year_to BETWEEN 1900 AND 2200),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

CREATE TABLE IF NOT EXISTS catalog_import_runs (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP
);

COMMIT;
