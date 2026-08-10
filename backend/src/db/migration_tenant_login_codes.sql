BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS login_code TEXT;

UPDATE organizations
SET login_code = 'RKZ-' || lpad(id::text, 6, '0')
WHERE login_code IS NULL OR btrim(login_code) = '';

ALTER TABLE organizations ALTER COLUMN login_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_login_code_unique
  ON organizations (upper(login_code));

COMMIT;
