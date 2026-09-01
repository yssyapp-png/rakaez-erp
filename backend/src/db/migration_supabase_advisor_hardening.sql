BEGIN;

-- The migration ledger is an internal server table. It must never be exposed
-- through the Supabase browser roles even though it lives in public.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM anon, authenticated;

-- Pin the trigger function lookup path so objects created by other roles
-- cannot shadow names resolved by this security boundary.
ALTER FUNCTION public.prevent_security_event_mutation()
  SET search_path = pg_catalog, public;

COMMIT;
