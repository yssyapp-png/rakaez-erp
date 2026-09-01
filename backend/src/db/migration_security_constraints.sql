-- Apply after reviewing any legacy rows reported by the validation queries.
-- This migration intentionally fails instead of silently changing invalid data.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM parts WHERE price < 0 OR cost < 0) THEN
    RAISE EXCEPTION 'Negative part prices/costs must be corrected before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM inventory WHERE quantity < 0 OR min_quantity < 0) THEN
    RAISE EXCEPTION 'Negative inventory quantities must be corrected before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_items WHERE quantity <= 0 OR unit_price < 0) THEN
    RAISE EXCEPTION 'Invalid invoice items must be corrected before migration';
  END IF;
END $$;

ALTER TABLE parts
  ADD CONSTRAINT parts_price_non_negative CHECK (price >= 0),
  ADD CONSTRAINT parts_cost_non_negative CHECK (cost >= 0);

ALTER TABLE inventory
  ADD CONSTRAINT inventory_quantity_non_negative CHECK (quantity >= 0),
  ADD CONSTRAINT inventory_min_quantity_non_negative CHECK (min_quantity >= 0);

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT invoice_items_unit_price_non_negative CHECK (unit_price >= 0);

COMMIT;
