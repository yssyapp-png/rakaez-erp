BEGIN;

-- Device tokens created before this migration used a different one-way
-- derivation. Revoke them deliberately so no legacy credential bypasses the
-- keyed HMAC and lifetime controls below; administrators can re-pair safely.
ALTER TABLE organization_devices
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE organization_devices
SET status = 'revoked', expires_at = COALESCE(expires_at, now())
WHERE expires_at IS NULL;
ALTER TABLE organization_devices
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devices_active_expiry
  ON organization_devices(organization_id, expires_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS device_pairing_guards (
  source_hash CHAR(64) PRIMARY KEY CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at TIMESTAMPTZ,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_pairing_guards_blocked
  ON device_pairing_guards(blocked_until) WHERE blocked_until IS NOT NULL;

ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_event_type_check;
ALTER TABLE security_events ADD CONSTRAINT security_events_event_type_check CHECK (event_type IN (
  'account_registered','invitation_accepted','login_succeeded','login_failed','login_blocked',
  'session_revoked','all_sessions_revoked','profile_changed','authorization_denied',
  'password_changed','password_change_failed',
  'device_pairing_code_created','device_pairing_succeeded','device_pairing_failed',
  'device_pairing_blocked','device_revoked'
));

ALTER TABLE public.device_pairing_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.device_pairing_guards FROM anon, authenticated;

COMMIT;
