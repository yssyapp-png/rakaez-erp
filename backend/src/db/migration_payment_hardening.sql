BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE payment_reference IS NOT NULL
    GROUP BY payment_reference
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot harden payments: duplicate invoices.payment_reference values exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_reference_unique
  ON invoices(payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_payments (
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

CREATE TABLE IF NOT EXISTS billing_renewal_attempts (
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

CREATE INDEX IF NOT EXISTS idx_subscription_payments_org_created
  ON subscription_payments(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_renewal_attempts_status
  ON billing_renewal_attempts(status, scheduled_for);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_renewal_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE subscription_payments, billing_renewal_attempts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE subscription_payments_id_seq, billing_renewal_attempts_id_seq FROM anon, authenticated;

COMMIT;
