BEGIN;

CREATE TABLE IF NOT EXISTS customer_vehicles (
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

CREATE INDEX IF NOT EXISTS idx_customer_vehicles_org_vin ON customer_vehicles(organization_id, vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_applications_lookup
  ON vehicle_applications(organization_id, make, model, year_from, year_to, verification_status);

COMMIT;
