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
  commercial_registration_number TEXT CHECK (
    commercial_registration_number IS NULL OR commercial_registration_number ~ '^[0-9]{10}$'
  ),
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
  city TEXT,
  UNIQUE(organization_id, id)
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
  vat_number TEXT CHECK (vat_number IS NULL OR vat_number ~ '^[0-9]{15}$'),
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
  role TEXT NOT NULL CHECK (role IN ('customer','seller','warehouse_keeper','branch_manager','admin')),
  branch_id INTEGER REFERENCES branches(id),
  email TEXT NOT NULL,
  password_hash TEXT,
  -- the same email could belong to different people at two different shops,
  -- but must be unique WITHIN a shop's own account list
  UNIQUE(organization_id, email),
  CHECK (role NOT IN ('seller','warehouse_keeper','branch_manager') OR branch_id IS NOT NULL),
  FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

-- Server-enforced sessions make logout and emergency revocation effective
-- immediately instead of waiting for a signed JWT to expire.
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_hash CHAR(64) NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash CHAR(64) NOT NULL CHECK (user_agent_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR revoked_reason IN (
    'logout','user_revoked','admin_revoked','credentials_changed','security_response'
  )),
  CHECK (expires_at > created_at)
);

-- The login key is a keyed digest of tenant code + email. No email address or
-- source network address is stored in the abuse-control and audit tables.
CREATE TABLE auth_login_guards (
  subject_hash CHAR(64) PRIMARY KEY CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  organization_id INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at TIMESTAMPTZ,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE security_events (
  id BIGSERIAL PRIMARY KEY,
  -- Evidence keeps immutable identifiers without cascading FK updates. This
  -- preserves the append-only record even after an account/session lifecycle ends.
  organization_id INTEGER,
  user_id INTEGER,
  session_id UUID,
  subject_hash CHAR(64) CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$'),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'account_registered','invitation_accepted','login_succeeded','login_failed','login_blocked',
    'session_revoked','all_sessions_revoked','profile_changed','authorization_denied',
    'password_changed','password_change_failed',
    'device_pairing_code_created','device_pairing_succeeded','device_pairing_failed',
    'device_pairing_blocked','device_revoked'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','blocked')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  request_id TEXT,
  ip_hash CHAR(64) NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash CHAR(64) NOT NULL CHECK (user_agent_hash ~ '^[0-9a-f]{64}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_security_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security_events are append-only';
END;
$$;

CREATE TRIGGER security_events_append_only
BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION prevent_security_event_mutation();

-- Procurement documents deliberately precede stock changes. A purchase order
-- must be approved, and every receipt has a tenant-unique idempotency
-- reference so a browser retry cannot add the same stock twice.
CREATE TABLE purchase_orders (
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

CREATE TABLE purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
  received_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  UNIQUE(purchase_order_id, part_id)
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
  role TEXT NOT NULL CHECK (role IN ('customer','seller','warehouse_keeper','branch_manager')),
  branch_id INTEGER REFERENCES branches(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (role NOT IN ('seller','warehouse_keeper','branch_manager') OR branch_id IS NOT NULL),
  FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
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
  last_seen_at TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE TABLE purchase_receipts (
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

CREATE TABLE purchase_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_receipt_id BIGINT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  UNIQUE(purchase_receipt_id, purchase_order_item_id)
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

CREATE TABLE device_pairing_guards (
  source_hash CHAR(64) PRIMARY KEY CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at TIMESTAMPTZ,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  device_id INTEGER REFERENCES organization_devices(id),
  performed_by INTEGER NOT NULL REFERENCES users(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'sale','warehouse_issue','receipt','adjustment','return','transfer_out','transfer_in'
  )),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE inventory_transfers (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transfer_number TEXT NOT NULL,
  source_branch_id INTEGER NOT NULL REFERENCES branches(id),
  destination_branch_id INTEGER NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','in_transit','received','received_with_variance','cancelled')),
  request_reference UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  shipment_reference UUID,
  receipt_reference UUID,
  receipt_hash CHAR(64) CHECK (receipt_hash IS NULL OR receipt_hash ~ '^[0-9a-f]{64}$'),
  notes TEXT,
  receipt_note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  shipped_by INTEGER REFERENCES users(id),
  shipped_device_id INTEGER REFERENCES organization_devices(id),
  received_by INTEGER REFERENCES users(id),
  received_device_id INTEGER REFERENCES organization_devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_branch_id <> destination_branch_id),
  UNIQUE(organization_id, transfer_number),
  UNIQUE(organization_id, request_reference),
  UNIQUE(organization_id, shipment_reference),
  UNIQUE(organization_id, receipt_reference)
);

CREATE TABLE inventory_transfer_items (
  id BIGSERIAL PRIMARY KEY,
  inventory_transfer_id BIGINT NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  shipped_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (shipped_quantity >= 0 AND shipped_quantity <= requested_quantity),
  received_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= shipped_quantity),
  damaged_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (damaged_quantity >= 0 AND damaged_quantity <= shipped_quantity),
  CHECK (received_quantity + damaged_quantity <= shipped_quantity),
  UNIQUE(inventory_transfer_id, part_id)
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
  zatca_status TEXT DEFAULT 'pending' CHECK (zatca_status IN (
    'pending','not_integrated','generated_locally','submitted','reported','cleared','rejected','manual_review'
  )),
  zatca_qr TEXT,                       -- base64 TLV payload for the ZATCA Phase 1 QR code
  zatca_uuid UUID,
  zatca_document_hash CHAR(64) CHECK (zatca_document_hash IS NULL OR zatca_document_hash ~ '^[0-9a-f]{64}$'),
  payment_status TEXT DEFAULT 'unpaid', -- unpaid | paid | pos
  payment_reference TEXT,               -- Moyasar payment id, when paid online
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(organization_id, invoice_number)
);

CREATE UNIQUE INDEX uq_invoices_org_zatca_uuid
  ON invoices(organization_id, zatca_uuid) WHERE zatca_uuid IS NOT NULL;

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

CREATE TABLE government_integration_attempts (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider = 'zatca'),
  environment TEXT NOT NULL CHECK (environment IN ('simulation','production')),
  operation TEXT NOT NULL CHECK (operation IN ('reporting','clearance','compliance')),
  request_reference UUID NOT NULL,
  document_hash CHAR(64) NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  document_bytes INTEGER NOT NULL CHECK (document_bytes > 0 AND document_bytes <= 1500000),
  status TEXT NOT NULL CHECK (status IN ('processing','reported','cleared','rejected','transport_failed','manual_review')),
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  provider_status TEXT CHECK (provider_status IS NULL OR length(provider_status) <= 80),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_:-]{1,100}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(organization_id, provider, request_reference)
);

CREATE INDEX idx_branches_org ON branches(organization_id);
CREATE INDEX idx_parts_org ON parts(organization_id);
CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions_org_created ON user_sessions(organization_id, created_at DESC);
CREATE INDEX idx_auth_login_guards_blocked ON auth_login_guards(blocked_until) WHERE blocked_until IS NOT NULL;
CREATE INDEX idx_security_events_org_time ON security_events(organization_id, occurred_at DESC);
CREATE INDEX idx_security_events_type_time ON security_events(event_type, occurred_at DESC);
CREATE INDEX idx_security_events_subject_time ON security_events(subject_hash, occurred_at DESC) WHERE subject_hash IS NOT NULL;
CREATE INDEX idx_customer_vehicles_org_vin ON customer_vehicles(organization_id, vin);
CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invites_org_email ON organization_invites(organization_id, email);
CREATE INDEX idx_devices_org_branch ON organization_devices(organization_id, branch_id);
CREATE INDEX idx_devices_active_expiry ON organization_devices(organization_id, expires_at) WHERE status = 'active';
CREATE INDEX idx_device_pairing_guards_blocked ON device_pairing_guards(blocked_until) WHERE blocked_until IS NOT NULL;
CREATE INDEX idx_inventory_movements_org_created ON inventory_movements(organization_id, created_at DESC);
CREATE INDEX idx_subscription_payments_org_created ON subscription_payments(organization_id, created_at DESC);
CREATE INDEX idx_billing_renewal_attempts_status ON billing_renewal_attempts(status, scheduled_for);
CREATE INDEX idx_suppliers_org_status ON suppliers(organization_id, status);
CREATE UNIQUE INDEX uq_suppliers_org_name_ci ON suppliers(organization_id, lower(name));
CREATE INDEX idx_purchase_orders_org_created ON purchase_orders(organization_id, created_at DESC);
CREATE INDEX idx_purchase_orders_org_status ON purchase_orders(organization_id, status);
CREATE INDEX idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_receipts_order ON purchase_receipts(purchase_order_id, created_at DESC);
CREATE INDEX idx_inventory_transfers_org_created ON inventory_transfers(organization_id, created_at DESC);
CREATE INDEX idx_inventory_transfers_org_status ON inventory_transfers(organization_id, status);
CREATE INDEX idx_inventory_transfers_source_status ON inventory_transfers(source_branch_id, status);
CREATE INDEX idx_inventory_transfers_destination_status ON inventory_transfers(destination_branch_id, status);
CREATE INDEX idx_inventory_transfer_items_transfer ON inventory_transfer_items(inventory_transfer_id);
CREATE INDEX idx_government_attempts_org_created ON government_integration_attempts(organization_id, created_at DESC);
CREATE INDEX idx_government_attempts_invoice ON government_integration_attempts(invoice_id, created_at DESC);
CREATE UNIQUE INDEX uq_government_attempts_active_invoice
  ON government_integration_attempts(organization_id, invoice_id)
  WHERE invoice_id IS NOT NULL AND status IN ('processing','reported','cleared','manual_review');

-- Supabase exposes the public schema through PostgREST. Rakaez uses only its
-- server-side API, so browser roles must never access these tables directly.
DO $$
DECLARE
  table_name TEXT;
  protected_tables TEXT[] := ARRAY[
    'organizations', 'branches', 'parts', 'suppliers', 'part_suppliers',
    'vehicle_applications', 'catalog_import_runs', 'inventory', 'vin_map',
    'users', 'user_sessions', 'auth_login_guards', 'security_events',
    'customer_vehicles', 'organization_invites',
    'organization_devices', 'device_pairing_codes', 'device_pairing_guards', 'inventory_movements',
    'invoices', 'invoice_items', 'subscription_payments', 'billing_renewal_attempts',
    'government_integration_attempts',
    'purchase_orders', 'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items',
    'inventory_transfers', 'inventory_transfer_items'
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
