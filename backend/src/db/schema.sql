-- ركائز — schema (multi-tenant SaaS)
--
-- Every subscribing shop is a separate "organization" (tenant). All
-- business data (branches, parts, inventory, users, invoices) is scoped to
-- one organization_id so two shops' data never mix, even though they share
-- the same database and application. This is the minimum viable isolation
-- model for a SaaS launch — sufficient for dozens to low hundreds of
-- tenants; if the customer base grows much larger, per-tenant database
-- sharding becomes worth revisiting, but organization_id scoping is the
-- right starting point and avoids premature complexity.

CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                 -- shop/company display name
  login_code TEXT NOT NULL UNIQUE,    -- required at login to select the tenant safely
  vat_number TEXT,                    -- needed on every ZATCA invoice QR
  plan TEXT NOT NULL DEFAULT 'professional', -- basic | professional | business — see PLAN_PRICES in billing.js
  plan_price_sar NUMERIC(10,2) NOT NULL DEFAULT 349,
  trial_ends_at TIMESTAMP,
  subscription_status TEXT NOT NULL DEFAULT 'trialing', -- trialing | active | past_due | canceled
  -- Reusable Moyasar card token saved once (with the customer present, via
  -- the hosted card form + save_card:true) so every renewal after that can
  -- charge automatically with NO customer action — this is what makes
  -- "بدون حضور" (unattended recurring billing) possible.
  moyasar_card_token TEXT,
  next_billing_at TIMESTAMP,
  -- 'monthly' | 'yearly' — set when the admin activates billing, read by
  -- billing-cron.js to know both the renewal amount and how far to push
  -- next_billing_at forward on each successful charge.
  billing_interval TEXT NOT NULL DEFAULT 'monthly',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE branches (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT
);

CREATE TABLE parts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_number TEXT NOT NULL,          -- shop-facing part number, e.g. P-1001 (unique PER shop, not globally)
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  barcode TEXT,
  manufacturer TEXT,
  oem_numbers TEXT[] NOT NULL DEFAULT '{}',
  cross_reference_numbers TEXT[] NOT NULL DEFAULT '{}',
  unit TEXT NOT NULL DEFAULT 'piece',
  quality_grade TEXT,
  country_of_origin TEXT,
  warranty_months INTEGER NOT NULL DEFAULT 0 CHECK (warranty_months >= 0),
  catalog_status TEXT NOT NULL DEFAULT 'active' CHECK (catalog_status IN ('draft','active','archived')),
  catalog_source TEXT,
  catalog_key TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  UNIQUE(organization_id, part_number),
  UNIQUE(organization_id, catalog_source, catalog_key)
);

CREATE TABLE suppliers (
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

CREATE TABLE part_suppliers (
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_part_number TEXT,
  purchase_price NUMERIC(10,2) CHECK (purchase_price >= 0),
  lead_time_days INTEGER CHECK (lead_time_days >= 0),
  is_preferred BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (part_id, supplier_id)
);

CREATE TABLE vehicle_applications (
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

-- inventory: quantity of a part at a specific branch + shelf location
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  part_id INTEGER REFERENCES parts(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  shelf_section TEXT,           -- e.g. 'A'
  shelf_number TEXT,            -- e.g. '5'
  shelf_level TEXT,             -- e.g. 'الدور 2'
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity INTEGER NOT NULL DEFAULT 5 CHECK (min_quantity >= 0),
  UNIQUE(part_id, branch_id)
);

-- VIN compatibility mapping (which parts fit which VIN prefixes / vehicle models)
CREATE TABLE vin_map (
  id SERIAL PRIMARY KEY,
  part_id INTEGER REFERENCES parts(id) ON DELETE CASCADE,
  vin_pattern TEXT NOT NULL,     -- can store a VIN or a VIN prefix pattern
  vehicle_model TEXT,
  vehicle_year_from INT,
  vehicle_year_to INT
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','seller','warehouse_keeper','admin')),
  branch_id INTEGER REFERENCES branches(id),
  email TEXT NOT NULL,
  password_hash TEXT,
  -- the same email could belong to different people at two different shops,
  -- but must be unique WITHIN a shop's own account list
  UNIQUE(organization_id, email)
);

CREATE TABLE catalog_import_runs (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  import_mode TEXT CHECK (import_mode IN ('skip','replace','add')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP
);

CREATE TABLE customer_vehicles (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin CHAR(17) NOT NULL,
  nickname TEXT,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  model_year INTEGER NOT NULL CHECK (model_year BETWEEN 1900 AND 2200),
  engine TEXT,
  trim TEXT,
  plate_number TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(user_id, vin),
  CHECK (vin = upper(vin)),
  CHECK (vin !~ '[IOQ]')
);

CREATE TABLE organization_invites (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','seller','warehouse_keeper')),
  branch_id INTEGER REFERENCES branches(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE organization_devices (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  paired_by INTEGER NOT NULL REFERENCES users(id),
  paired_at TIMESTAMP NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP
);

CREATE TABLE device_pairing_codes (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  device_name TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  device_id INTEGER REFERENCES organization_devices(id),
  performed_by INTEGER NOT NULL REFERENCES users(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale','warehouse_issue','receipt','adjustment','return')),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  seller_id INTEGER REFERENCES users(id),
  customer_id INTEGER REFERENCES users(id),
  subtotal NUMERIC(10,2) NOT NULL,
  vat NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  zatca_status TEXT DEFAULT 'pending', -- pending | submitted | not_integrated | generated_locally
  zatca_qr TEXT,                       -- base64 TLV payload for the ZATCA Phase 1 QR code
  payment_status TEXT DEFAULT 'unpaid', -- unpaid | paid | pos
  payment_reference TEXT,               -- Moyasar payment id, when paid online
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(organization_id, invoice_number)
);

CREATE TABLE invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE UNIQUE INDEX idx_invoices_payment_reference_unique
  ON invoices(payment_reference) WHERE payment_reference IS NOT NULL;

CREATE TABLE subscription_payments (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_reference TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('activation','renewal')),
  amount_halalas INTEGER NOT NULL CHECK (amount_halalas > 0),
  currency TEXT NOT NULL DEFAULT 'SAR',
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('monthly','yearly')),
  status TEXT NOT NULL CHECK (status IN ('paid','refunded','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_renewal_attempts (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMP NOT NULL,
  given_id UUID NOT NULL UNIQUE,
  payment_reference TEXT UNIQUE,
  amount_halalas INTEGER NOT NULL CHECK (amount_halalas > 0),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('monthly','yearly')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, scheduled_for)
);

CREATE INDEX idx_branches_org ON branches(organization_id);
CREATE INDEX idx_parts_org ON parts(organization_id);
CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_customer_vehicles_org_vin ON customer_vehicles(organization_id, vin);
CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invites_org_email ON organization_invites(organization_id, email);
CREATE INDEX idx_devices_org_branch ON organization_devices(organization_id, branch_id);
CREATE INDEX idx_inventory_movements_org_created ON inventory_movements(organization_id, created_at DESC);
CREATE INDEX idx_subscription_payments_org_created ON subscription_payments(organization_id, created_at DESC);
CREATE INDEX idx_billing_renewal_attempts_status ON billing_renewal_attempts(status, scheduled_for);

-- Supabase exposes the public schema through PostgREST. Rakaez uses only its
-- server-side API, so browser roles must never access these tables directly.
DO $$
DECLARE
  table_name TEXT;
  protected_tables TEXT[] := ARRAY[
    'organizations', 'branches', 'parts', 'suppliers', 'part_suppliers',
    'vehicle_applications', 'catalog_import_runs', 'inventory', 'vin_map',
    'users', 'customer_vehicles', 'organization_invites',
    'organization_devices', 'device_pairing_codes', 'inventory_movements',
    'invoices', 'invoice_items', 'subscription_payments', 'billing_renewal_attempts'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
CREATE INDEX idx_inventory_part ON inventory(part_id);
CREATE INDEX idx_vin_map_pattern ON vin_map(vin_pattern);
