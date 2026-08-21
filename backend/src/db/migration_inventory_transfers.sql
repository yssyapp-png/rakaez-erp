BEGIN;

-- A transfer is a controlled document, not a direct inventory edit. Stock
-- leaves the source only when a paired source device ships the transfer and
-- reaches the destination only when a paired destination device receives it.
CREATE TABLE IF NOT EXISTS inventory_transfers (
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

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory_transfers t
    JOIN branches source ON source.id = t.source_branch_id
    JOIN branches destination ON destination.id = t.destination_branch_id
    WHERE source.organization_id <> t.organization_id
       OR destination.organization_id <> t.organization_id
  ) OR EXISTS (
    SELECT 1 FROM inventory_transfer_items ti
    JOIN inventory_transfers t ON t.id = ti.inventory_transfer_id
    JOIN parts p ON p.id = ti.part_id
    WHERE p.organization_id <> t.organization_id
  ) THEN
    RAISE EXCEPTION 'Cross-tenant transfer references must be corrected before migration';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_org_created
  ON inventory_transfers(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_org_status
  ON inventory_transfers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_source_status
  ON inventory_transfers(source_branch_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_destination_status
  ON inventory_transfers(destination_branch_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_items_transfer
  ON inventory_transfer_items(inventory_transfer_id);

-- Extend the append-only movement ledger with explicit transfer directions.
ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (movement_type IN (
    'sale','warehouse_issue','receipt','adjustment','return','transfer_out','transfer_in'
  ));

ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.inventory_transfers FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.inventory_transfer_items FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

COMMIT;
