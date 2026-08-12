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
CORS_ALLOWED_ORIGINS=https://your-web-domain.example
TRUST_PROXY=true
ENFORCE_HTTPS=true
PAYMENTS_ENABLED=false
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
```

When payment testing is explicitly enabled, also provide
`VITE_MOYASAR_PUBLISHABLE_KEY` to the frontend and `MOYASAR_SECRET_KEY` to
the backend. Never put the secret key in the frontend or repository.

## Release gates

- Database backup completed before migrations.
- `sh scripts/security-check.sh` passes.
- Use Node 20 or 22; Node 23+ is outside the supported release range.
- If npm's old cache fails, run `sh scripts/repair-npm-cache.sh`; do not delete
  the global cache. The command requires access to `registry.npmjs.org`.
- `npm test` passes in both `backend/` and `frontend/`.
- `npm run build` passes in `frontend/`.
- `npm audit` passes for backend and frontend.
- `/api/ready` returns HTTP 200.
- HTTPS is active on the web and API domains.
- Admin creates the first tenant; staff join using one-time invitations.
- Device pairing and inventory issue are tested in one branch.
- Payments remain disabled until the verified Moyasar callback/idempotency flow, 3DS return, refund, and renewal scenarios pass in the test environment.
