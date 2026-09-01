BEGIN;

-- ============================================================
-- PROCUREMENT HARDENING
-- حماية المشتريات والعلاقات بين المؤسسات + Idempotency
-- ============================================================


-- ============================================================
-- 1) التأكد من عدم وجود بيانات Cross-Tenant قبل إضافة القيود
-- ============================================================

DO $$
BEGIN

  IF EXISTS (
    SELECT 1
    FROM purchase_orders po
    JOIN suppliers s
      ON s.id = po.supplier_id
    WHERE po.organization_id <> s.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_orders reference suppliers from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_orders po
    JOIN branches b
      ON b.id = po.branch_id
    WHERE po.organization_id <> b.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_orders reference branches from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_orders po
    JOIN users u
      ON u.id = po.created_by
    WHERE po.organization_id <> u.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_orders reference users from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_orders po
    JOIN users u
      ON u.id = po.approved_by
    WHERE po.approved_by IS NOT NULL
      AND po.organization_id <> u.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_orders reference approvers from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_order_items poi
    JOIN purchase_orders po
      ON po.id = poi.purchase_order_id
    JOIN parts p
      ON p.id = poi.part_id
    WHERE po.organization_id <> p.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_order_items reference parts from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_receipts pr
    JOIN purchase_orders po
      ON po.id = pr.purchase_order_id
    WHERE pr.organization_id <> po.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_receipts reference purchase_orders from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_receipts pr
    JOIN branches b
      ON b.id = pr.branch_id
    WHERE pr.organization_id <> b.organization_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_receipts reference branches from another organization';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_receipt_items pri
    JOIN purchase_receipts pr
      ON pr.id = pri.purchase_receipt_id
    JOIN purchase_order_items poi
      ON poi.id = pri.purchase_order_item_id
    WHERE poi.purchase_order_id <> pr.purchase_order_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_receipt_items reference items from another purchase order';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_receipt_items pri
    JOIN purchase_receipts pr
      ON pr.id = pri.purchase_receipt_id
    JOIN purchase_order_items poi
      ON poi.id = pri.purchase_order_item_id
    JOIN parts p
      ON p.id = pri.part_id
    WHERE p.organization_id <> pr.organization_id
       OR p.id <> poi.part_id
  ) THEN
    RAISE EXCEPTION
      'Invalid procurement data: purchase_receipt_items contain invalid part references';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM purchase_receipts
    GROUP BY organization_id, request_hash
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate purchase receipt request_hash values exist; resolve them before hardening';
  END IF;

END $$;


-- ============================================================
-- 2) إضافة organization_id إلى purchase_order_items
-- ============================================================

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS organization_id INTEGER;


UPDATE purchase_order_items poi
SET organization_id = po.organization_id
FROM purchase_orders po
WHERE po.id = poi.purchase_order_id
  AND poi.organization_id IS NULL;


ALTER TABLE purchase_order_items
  ALTER COLUMN organization_id SET NOT NULL;


-- ============================================================
-- 3) إضافة organization_id إلى purchase_receipt_items
-- ============================================================

ALTER TABLE purchase_receipt_items
  ADD COLUMN IF NOT EXISTS organization_id INTEGER;


UPDATE purchase_receipt_items pri
SET organization_id = pr.organization_id
FROM purchase_receipts pr
WHERE pr.id = pri.purchase_receipt_id
  AND pri.organization_id IS NULL;


ALTER TABLE purchase_receipt_items
  ALTER COLUMN organization_id SET NOT NULL;


-- ============================================================
-- 4) Unique indexes اللازمة للـComposite Foreign Keys
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_parts_org_id
  ON parts(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_org_id
  ON suppliers(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_org_id
  ON branches(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_org_id
  ON users(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_org_id
  ON purchase_orders(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_items_org_id
  ON purchase_order_items(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_receipts_org_id
  ON purchase_receipts(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_receipt_items_org_id
  ON purchase_receipt_items(organization_id, id);


-- ============================================================
-- 5) purchase_orders → suppliers
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_orders_supplier_org'
  ) THEN

    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_supplier_org
      FOREIGN KEY (organization_id, supplier_id)
      REFERENCES suppliers(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 6) purchase_orders → branches
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_orders_branch_org'
  ) THEN

    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_branch_org
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES branches(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 7) purchase_orders → created_by
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_orders_created_by_org'
  ) THEN

    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_created_by_org
      FOREIGN KEY (organization_id, created_by)
      REFERENCES users(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 8) purchase_orders → approved_by
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_orders_approved_by_org'
  ) THEN

    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_approved_by_org
      FOREIGN KEY (organization_id, approved_by)
      REFERENCES users(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 9) purchase_order_items → purchase_orders
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_order_items_order_org'
  ) THEN

    ALTER TABLE purchase_order_items
      ADD CONSTRAINT fk_purchase_order_items_order_org
      FOREIGN KEY (organization_id, purchase_order_id)
      REFERENCES purchase_orders(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 10) purchase_order_items → parts
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_order_items_part_org'
  ) THEN

    ALTER TABLE purchase_order_items
      ADD CONSTRAINT fk_purchase_order_items_part_org
      FOREIGN KEY (organization_id, part_id)
      REFERENCES parts(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 11) purchase_receipts → purchase_orders
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_receipts_order_org'
  ) THEN

    ALTER TABLE purchase_receipts
      ADD CONSTRAINT fk_purchase_receipts_order_org
      FOREIGN KEY (organization_id, purchase_order_id)
      REFERENCES purchase_orders(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 12) purchase_receipts → branches
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_receipts_branch_org'
  ) THEN

    ALTER TABLE purchase_receipts
      ADD CONSTRAINT fk_purchase_receipts_branch_org
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES branches(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 13) purchase_receipts → received_by
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_receipts_received_by_org'
  ) THEN

    ALTER TABLE purchase_receipts
      ADD CONSTRAINT fk_purchase_receipts_received_by_org
      FOREIGN KEY (organization_id, received_by)
      REFERENCES users(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 14) purchase_receipt_items → purchase_receipts
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_receipt_items_receipt_org'
  ) THEN

    ALTER TABLE purchase_receipt_items
      ADD CONSTRAINT fk_purchase_receipt_items_receipt_org
      FOREIGN KEY (organization_id, purchase_receipt_id)
      REFERENCES purchase_receipts(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 15) purchase_receipt_items → purchase_order_items
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_receipt_items_order_item_org'
  ) THEN

    ALTER TABLE purchase_receipt_items
      ADD CONSTRAINT fk_purchase_receipt_items_order_item_org
      FOREIGN KEY (organization_id, purchase_order_item_id)
      REFERENCES purchase_order_items(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 16) purchase_receipt_items → parts
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_receipt_items_part_org'
  ) THEN

    ALTER TABLE purchase_receipt_items
      ADD CONSTRAINT fk_purchase_receipt_items_part_org
      FOREIGN KEY (organization_id, part_id)
      REFERENCES parts(organization_id, id);

  END IF;
END $$;


-- ============================================================
-- 17) Idempotency على مستوى Database
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_receipts_org_request_hash
  ON purchase_receipts(organization_id, request_hash);


-- ============================================================
-- 18) Indexes للأداء
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_org_part
  ON purchase_order_items(organization_id, part_id);

CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_org_order_item
  ON purchase_receipt_items(organization_id, purchase_order_item_id);


COMMIT;
