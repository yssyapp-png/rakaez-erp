-- Optional local demonstration data for the current multi-tenant schema.
-- No user or password is seeded: create the administrator through the normal
-- new-shop registration flow so password policy and bcrypt are never bypassed.

INSERT INTO organizations
  (name, login_code, plan, subscription_status, trial_ends_at)
VALUES
  ('متجر ركائز التجريبي', 'RKZ-DEMO001', 'professional', 'trialing', now() + interval '14 days')
ON CONFLICT (login_code) DO NOTHING;

INSERT INTO branches (organization_id, name, city)
SELECT o.id, data.name, data.city
FROM organizations o
CROSS JOIN (VALUES
  ('فرع الرياض - الصناعية', 'الرياض'),
  ('فرع جدة - الصناعية', 'جدة'),
  ('المستودع المركزي - الدمام', 'الدمام')
) AS data(name, city)
WHERE o.login_code = 'RKZ-DEMO001'
  AND NOT EXISTS (
    SELECT 1 FROM branches b WHERE b.organization_id = o.id AND b.name = data.name
  );

INSERT INTO parts (organization_id, part_number, name, brand, category, price, cost)
SELECT o.id, data.part_number, data.name, data.brand, data.category, data.price, data.cost
FROM organizations o
CROSS JOIN (VALUES
  ('P-1001','طقم تيل فرامل أمامي - تويوتا كامري 2018-2022','Toyota','فرامل',185::numeric,120::numeric),
  ('P-1002','فلتر زيت المحرك - هوندا أكورد 2016-2021','Honda','فلاتر',35::numeric,18::numeric),
  ('P-1003','بطارية سيارة 70 أمبير - عام','AC Delco','كهرباء',420::numeric,310::numeric),
  ('P-1004','مساعد أمامي يمين - هيونداي النترا 2017-2020','Hyundai','تعليق',310::numeric,210::numeric),
  ('P-1005','طرمبة بنزين - نيسان التيما 2013-2018','Nissan','وقود',265::numeric,170::numeric),
  ('P-1006','رديتر تبريد - فورد F150 2015-2020','Ford','تبريد',540::numeric,400::numeric)
) AS data(part_number, name, brand, category, price, cost)
WHERE o.login_code = 'RKZ-DEMO001'
ON CONFLICT (organization_id, part_number) DO NOTHING;

INSERT INTO inventory
  (part_id, branch_id, shelf_section, shelf_number, shelf_level, quantity, min_quantity)
SELECT p.id, b.id, data.shelf_section, data.shelf_number, data.shelf_level, data.quantity, data.min_quantity
FROM organizations o
JOIN parts p ON p.organization_id = o.id
JOIN (VALUES
  ('P-1001','فرع الرياض - الصناعية','A','5','دور 2',42,15),
  ('P-1002','فرع الرياض - الصناعية','B','2','دور 1',8,20),
  ('P-1003','فرع جدة - الصناعية','D','1','أرضي',5,10),
  ('P-1004','فرع الرياض - الصناعية','C','7','دور 3',24,8),
  ('P-1005','المستودع المركزي - الدمام','E','4','دور 1',0,6),
  ('P-1006','المستودع المركزي - الدمام','F','9','أرضي',12,5)
) AS data(part_number, branch_name, shelf_section, shelf_number, shelf_level, quantity, min_quantity)
  ON data.part_number = p.part_number
JOIN branches b ON b.organization_id = o.id AND b.name = data.branch_name
WHERE o.login_code = 'RKZ-DEMO001'
ON CONFLICT (part_id, branch_id) DO UPDATE SET
  shelf_section = EXCLUDED.shelf_section,
  shelf_number = EXCLUDED.shelf_number,
  shelf_level = EXCLUDED.shelf_level,
  quantity = EXCLUDED.quantity,
  min_quantity = EXCLUDED.min_quantity;

INSERT INTO vin_map (part_id, vin_pattern, vehicle_model, vehicle_year_from, vehicle_year_to)
SELECT p.id, data.vin_pattern, data.vehicle_model, data.year_from, data.year_to
FROM organizations o
JOIN parts p ON p.organization_id = o.id
JOIN (VALUES
  ('P-1001','JTNBE46K','Toyota Camry',2018,2022),
  ('P-1002','1HGCV1F','Honda Accord',2016,2021),
  ('P-1004','KMHD84L','Hyundai Elantra',2017,2020),
  ('P-1005','1N4AL3AP','Nissan Altima',2013,2018),
  ('P-1006','1FTEW1EP','Ford F150',2015,2020)
) AS data(part_number, vin_pattern, vehicle_model, year_from, year_to)
  ON data.part_number = p.part_number
WHERE o.login_code = 'RKZ-DEMO001'
  AND NOT EXISTS (
    SELECT 1 FROM vin_map vm WHERE vm.part_id = p.id AND vm.vin_pattern = data.vin_pattern
  );
