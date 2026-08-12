BEGIN;

ALTER TABLE catalog_import_runs
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS import_mode TEXT,
  ADD COLUMN IF NOT EXISTS updated_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE catalog_import_runs DROP CONSTRAINT IF EXISTS catalog_import_runs_import_mode_check;
ALTER TABLE catalog_import_runs ADD CONSTRAINT catalog_import_runs_import_mode_check
  CHECK (import_mode IS NULL OR import_mode IN ('skip','replace','add'));

COMMIT;
