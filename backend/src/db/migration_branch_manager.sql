BEGIN;

-- Branch managers are read-only staff assigned to one branch, but may view
-- positive inventory availability across branches in their own organization.
-- The composite keys below also stop a branch id from another tenant being
-- attached to a user or invitation at the database boundary.
ALTER TABLE branches
  ADD CONSTRAINT branches_organization_id_id_key UNIQUE (organization_id, id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer','seller','warehouse_keeper','branch_manager','admin'));

ALTER TABLE organization_invites DROP CONSTRAINT IF EXISTS organization_invites_role_check;
ALTER TABLE organization_invites ADD CONSTRAINT organization_invites_role_check
  CHECK (role IN ('customer','seller','warehouse_keeper','branch_manager'));

-- Do not hide or rewrite legacy corruption. Stop safely before adding the
-- constraints so an operator can review the affected records without loss.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users u
    LEFT JOIN branches b ON b.id = u.branch_id AND b.organization_id = u.organization_id
    WHERE (u.role IN ('seller','warehouse_keeper','branch_manager') AND u.branch_id IS NULL)
       OR (u.branch_id IS NOT NULL AND b.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Invalid user branch assignment detected; review before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM organization_invites i
    LEFT JOIN branches b ON b.id = i.branch_id AND b.organization_id = i.organization_id
    WHERE (i.role IN ('seller','warehouse_keeper','branch_manager') AND i.branch_id IS NULL)
       OR (i.branch_id IS NOT NULL AND b.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Invalid invitation branch assignment detected; review before migration';
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT users_staff_branch_required
  CHECK (role NOT IN ('seller','warehouse_keeper','branch_manager') OR branch_id IS NOT NULL);
ALTER TABLE organization_invites ADD CONSTRAINT organization_invites_staff_branch_required
  CHECK (role NOT IN ('seller','warehouse_keeper','branch_manager') OR branch_id IS NOT NULL);

ALTER TABLE users ADD CONSTRAINT users_organization_branch_fkey
  FOREIGN KEY (organization_id, branch_id)
  REFERENCES branches(organization_id, id);
ALTER TABLE organization_invites ADD CONSTRAINT organization_invites_organization_branch_fkey
  FOREIGN KEY (organization_id, branch_id)
  REFERENCES branches(organization_id, id);

COMMIT;
