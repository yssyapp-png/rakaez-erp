BEGIN;

-- Rakaez authenticates and authorizes through the Node.js backend. Supabase's
-- anon/authenticated PostgREST roles therefore receive no direct table access.
-- The backend connection role remains responsible for tenant-scoped queries.
DO $$
DECLARE
  table_name TEXT;
  protected_tables TEXT[] := ARRAY[
    'organizations', 'branches', 'parts', 'suppliers', 'part_suppliers',
    'vehicle_applications', 'catalog_import_runs', 'inventory', 'vin_map',
    'users', 'customer_vehicles', 'organization_invites',
    'organization_devices', 'device_pairing_codes', 'inventory_movements',
    'invoices', 'invoice_items'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

COMMIT;
