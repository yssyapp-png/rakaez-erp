BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer','seller','warehouse_keeper','admin'));

ALTER TABLE organization_invites DROP CONSTRAINT IF EXISTS organization_invites_role_check;
ALTER TABLE organization_invites ADD CONSTRAINT organization_invites_role_check
  CHECK (role IN ('customer','seller','warehouse_keeper'));

CREATE TABLE IF NOT EXISTS organization_devices (
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

CREATE TABLE IF NOT EXISTS device_pairing_codes (
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

CREATE TABLE IF NOT EXISTS inventory_movements (
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

CREATE INDEX IF NOT EXISTS idx_devices_org_branch ON organization_devices(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_org_created
  ON inventory_movements(organization_id, created_at DESC);

COMMIT;
