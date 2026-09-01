# Rakaez web beta launch

The full Arabic readiness review and launch blockers are documented in
`PRE_LAUNCH_READINESS_AR.md`. Do not treat this runbook as approval for a
public or paid launch.

The first web release is a private beta with online payments disabled.

## Services

1. Managed PostgreSQL database.
2. One production image built from the repository root using `backend/Dockerfile`.
3. The image builds React, copies only `frontend/dist` into the Node service,
   and serves the web app and `/api` from one HTTPS origin. Source, SQL, `.env`,
   tests, and repository metadata are excluded by `.dockerignore`.

## Backend release command

Run database migrations once for every release, then start the API. The Docker
build context must be the repository root, not `backend/`:

```text
npm ci --ignore-scripts
npm run migrate
npm start
```

Required production environment variables:

```text
NODE_ENV=production
PORT=4000
DATABASE_URL=<managed-postgresql-connection-string>
DB_SSL=true
DB_POOL_MAX=10
JWT_SECRET=<random-secret-at-least-32-characters>
JWT_EXPIRES_IN=12h
SESSION_TTL_HOURS=12
SECURITY_EVENT_PEPPER=<different-random-secret-at-least-32-characters>
CORS_ALLOWED_ORIGINS=https://your-web-domain.example
TRUST_PROXY=true
ENFORCE_HTTPS=true
PAYMENTS_ENABLED=false
PUBLIC_REGISTRATION_ENABLED=false
MOYASAR_CALLBACK_URL=https://your-web-domain.example
MOYASAR_TIMEOUT_MS=15000
```

Do not configure Moyasar live keys during the private beta.

Health checks:

```text
GET /api/health
GET /api/ready
```

## Frontend release

Build command:

```text
npm ci --ignore-scripts
npm run build
```

Publish directory: `dist`

The recommended and tested configuration is the combined production image.
If the frontend is hosted on a separate domain, that host must set an equivalent
CSP whose `connect-src` explicitly allows the API origin, and the API CORS list
must allow only the web origin. The server exposes compiled assets only; never
publish the repository directory.

Environment variables when the API uses a separate domain:

```text
VITE_API_BASE_URL=https://your-api-domain.example/api
VITE_PAYMENTS_ENABLED=false
VITE_PUBLIC_REGISTRATION_ENABLED=false
```

When payment testing is explicitly enabled, also provide
`VITE_MOYASAR_PUBLISHABLE_KEY` to the frontend and `MOYASAR_SECRET_KEY` to
the backend. The exact official Moyasar 2.2.10 JavaScript and CSS files must
also be independently downloaded from the documented source, verified, and
their SHA-384 SRI values supplied as `VITE_MOYASAR_SCRIPT_INTEGRITY` and
`VITE_MOYASAR_STYLE_INTEGRITY`. Never put the secret key in the frontend or
repository, and never bypass the SRI failure to make payments appear enabled.

## Release gates

- Database backup completed before migrations.
- Apply `migration_session_security.sql` on Staging first. Its deployment invalidates
  pre-existing stateless JWTs because every accepted token must now reference an
  active server session; plan a controlled sign-in restart for beta users.
- Apply `migration_device_security.sql` on Staging after the session migration.
  It intentionally revokes legacy paired-device tokens; administrators must
  re-pair each approved device, and new device identities expire after 90 days.
- Web authentication now uses a `Secure`, `HttpOnly`, `SameSite=Strict` cookie.
  The recommended combined web/API origin avoids cross-site cookie ambiguity;
  any split-domain deployment must be tested for cookie, CORS, Origin, and Fetch
  Metadata behavior before launch.
- Keep `SECURITY_EVENT_PEPPER` separate from `JWT_SECRET` in the hosting secret
  manager and confirm neither value appears in application logs.
- `sh scripts/security-check.sh` passes.
- Use Node 24 across development, CI, and the production container. Keep its
  patch release current and review the runtime gate before moving to a newer
  major release.
- If npm's old cache fails, run `sh scripts/repair-npm-cache.sh`; do not delete
  the global cache. The command requires access to `registry.npmjs.org`.
- `npm test` passes in both `backend/` and `frontend/`.
- `npm run build` passes in `frontend/`.
- `npm audit` passes for backend and frontend.
- `/api/ready` returns HTTP 200.
- Sign in, list sessions, revoke another session, and verify its next API request
  returns 401. Trigger five failed logins on a test account and verify HTTP 429
  plus a `login_blocked` event without raw email or IP data.
- HTTPS is active on the web and API domains.
- `PUBLIC_REGISTRATION_ENABLED=false` unless an explicitly monitored onboarding
  window has been approved.
- Admin creates the first tenant; staff join using one-time invitations.
- Device pairing and inventory issue are tested in one branch.
- Payments remain disabled until the verified Moyasar callback/idempotency flow, 3DS return, refund, and renewal scenarios pass in the test environment.
