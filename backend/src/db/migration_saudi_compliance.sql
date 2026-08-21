BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS commercial_registration_number TEXT;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_commercial_registration_number_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_commercial_registration_number_check
  CHECK (
    commercial_registration_number IS NULL OR
    commercial_registration_number ~ '^[0-9]{10}$'
  );

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS zatca_uuid UUID,
  ADD COLUMN IF NOT EXISTS zatca_document_hash CHAR(64);

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_zatca_document_hash_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_zatca_document_hash_check
  CHECK (zatca_document_hash IS NULL OR zatca_document_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_zatca_status_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_zatca_status_check
  CHECK (zatca_status IN (
    'pending','not_integrated','generated_locally','submitted','reported','cleared','rejected','manual_review'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_org_zatca_uuid
  ON invoices(organization_id, zatca_uuid)
  WHERE zatca_uuid IS NOT NULL;

-- The integration audit trail stores no XML, invoice body, customer identity,
-- authentication certificate, or secret. Only bounded operational metadata is
-- retained so an administrator can reconcile delivery without creating a
-- second copy of sensitive invoice data.
CREATE TABLE IF NOT EXISTS government_integration_attempts (
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

CREATE INDEX IF NOT EXISTS idx_government_attempts_org_created
  ON government_integration_attempts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_government_attempts_invoice
  ON government_integration_attempts(invoice_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_government_attempts_active_invoice
  ON government_integration_attempts(organization_id, invoice_id)
  WHERE invoice_id IS NOT NULL AND status IN ('processing','reported','cleared','manual_review');

ALTER TABLE government_integration_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE government_integration_attempts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE government_integration_attempts_id_seq FROM anon, authenticated;

COMMIT;
