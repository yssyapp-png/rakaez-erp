BEGIN;

CREATE TABLE IF NOT EXISTS organization_invites (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','seller')),
  branch_id INTEGER REFERENCES branches(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_invites_org_email ON organization_invites(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

COMMIT;
