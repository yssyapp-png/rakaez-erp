BEGIN;

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_hash CHAR(64) NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash CHAR(64) NOT NULL CHECK (user_agent_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR revoked_reason IN (
    'logout','user_revoked','admin_revoked','credentials_changed','security_response'
  )),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_org_created
  ON user_sessions(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_login_guards (
  subject_hash CHAR(64) PRIMARY KEY CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  organization_id INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at TIMESTAMPTZ,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_login_guards_blocked
  ON auth_login_guards(blocked_until) WHERE blocked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_events (
  id BIGSERIAL PRIMARY KEY,
  -- Store immutable evidence identifiers without cascading FK updates.
  organization_id INTEGER,
  user_id INTEGER,
  session_id UUID,
  subject_hash CHAR(64) CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$'),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'account_registered','invitation_accepted','login_succeeded','login_failed','login_blocked',
    'session_revoked','all_sessions_revoked','profile_changed','authorization_denied'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','blocked')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  request_id TEXT,
  ip_hash CHAR(64) NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash CHAR(64) NOT NULL CHECK (user_agent_hash ~ '^[0-9a-f]{64}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_org_time
  ON security_events(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type_time
  ON security_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_subject_time
  ON security_events(subject_hash, occurred_at DESC) WHERE subject_hash IS NOT NULL;

-- Audit events are evidence, not editable business records. A correction must
-- be represented by a new event instead of overwriting or deleting history.
CREATE OR REPLACE FUNCTION prevent_security_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS security_events_append_only ON security_events;
CREATE TRIGGER security_events_append_only
BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION prevent_security_event_mutation();

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_login_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.user_sessions, public.auth_login_guards, public.security_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.security_events_id_seq FROM anon, authenticated;

COMMIT;
