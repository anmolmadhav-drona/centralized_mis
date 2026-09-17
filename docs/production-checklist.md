# Production Configuration Checklist — NPL MIS Portal

Status legend:

* ✅ **READY** — implemented, tested in this workspace; nothing left to do
* 🔧 **REQUIRES EXTERNAL CONFIGURATION** — code/docs complete; needs values
  or services only available on your infrastructure (AWS / Coolify / SMTP)
* 🌱 **OPTIONAL / FUTURE** — deliberately deferred, documented trade-offs

> Nothing marked 🔧 has been validated against real external services from
> this workspace (no AWS, no Coolify, no SMTP available here) — see the
> "what was actually tested" notes per section.

---

## Application

- ✅ Production build: multi-stage Dockerfile, standalone output, non-root
  user, `0.0.0.0:3000`, container HEALTHCHECK
- ✅ TypeScript strict build (`ignoreBuildErrors: false`) — build fails on
  type errors
- ✅ Startup environment validation (`src/lib/env.ts` via
  `src/instrumentation.ts`) — production refuses to start without
  `DATABASE_URL` + `AUTH_SECRET`
- ✅ Request IDs (`x-request-id` UUID via middleware) on responses, logs,
  error bodies and audit rows
- ✅ Production preflight (`bun run preflight:prod` locally,
  `node scripts/preflight-prod.mjs` in the container) — validates the
  production contract (PostgreSQL `DATABASE_URL`, `AUTH_SECRET`, realtime
  wiring, forbidden dev settings) and never prints secret values
- ✅ Rate limiting: login 10/min/IP, password-reset 5/10min/IP,
  confirm 10/10min/IP (per-process — see Scaling below)
- 🔧 `APP_URL` — set only if the proxy forwards an ambiguous origin

## Database

- ✅ PostgreSQL schema, 3 committed migrations (`prisma migrate deploy`),
  verified drift-free
- ✅ PG-safe SQL everywhere (positional params, real booleans,
  case-insensitive search)
- ✅ Import transactions with SAVEPOINTs (race-safe on PostgreSQL)
- ✅ Soft deletion; audit log with request correlation
- 🔧 Coolify PostgreSQL resource: create it, use the **internal**
  connection string as `DATABASE_URL`
- 🔧 Backups: schedule + S3 destination (see below)
- 🌱 Read replicas / connection pooling (PgBouncer): not needed at current
  scale; documented future point

## Authentication

- ✅ Auth.js v5 (next-auth@5.0.0-beta.32) credentials flow — the installed
  version matches the code
- ✅ Argon2id hashing (OWASP-aligned params) + transparent legacy-bcrypt
  rehash on login
- ✅ JWT sessions: HttpOnly, SameSite=Lax, Secure in production, 7-day TTL
- ✅ Inactive accounts rejected at sign-in AND at every request
  (server-side session revalidation)
- ✅ Uniform error messages (no account enumeration); login rate limiting
- 🔧 `AUTH_SECRET` — generate per deployment:
  `bun scripts/generate-secrets.ts auth`
- 🌱 Session revocation on password change (JWT denylist) — sessions expire
  within 7 days at worst; documented in `docs/duplicate-system.md` §7 area
  and code comments

## Password reset

- ✅ Server-side foundation: single-use 30-min tokens (SHA-256 at rest),
  atomic claim, anti-enumeration request endpoint, Argon2id rehash
- ✅ Email adapter: SMTP transport (nodemailer) + DEV console sink;
  production **fails loudly** (logged) when SMTP is unset — never fakes
  delivery
- ✅ E2E test suite (`bun run test:reset`, 12 checks)
- 🔧 SMTP: set `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` /
  `SMTP_FROM` in Coolify when you want email delivery

## RBAC

- ✅ Roles ADMIN / MANAGER / USER / VIEWER with a permission registry
  (`src/lib/rbac.ts`)
- ✅ Server-side checks on every protected API route (`requirePermission`);
  the frontend is never trusted
- ✅ E2E coverage of all four roles (61-check suite)

## Duplicate protection (businessKey + lineKey)

- ✅ Preserved and tested: 46 unit + 50 import e2e checks
- ✅ Documentation: `docs/duplicate-system.md`; fixtures:
  `bun scripts/make-import-fixtures.ts`
- ✅ Database uniqueness + concurrent-import race handling (SAVEPOINTs)

## Realtime

- ✅ Separate Socket.IO service with fail-closed production config
  (no secret → refuses to start; no wildcard CORS)
- ✅ `/emit` internal endpoint: shared secret, JSON-only, 64 KB bound
- ✅ Browser endpoint served at runtime via `/api/config` (no build-time
  freezing of env vars)
- 🔧 Coolify: deploy `mini-services/realtime` as its own application;
  identical `REALTIME_SECRET` on both; `REALTIME_ALLOWED_ORIGIN` = web origin;
  publish 3003 only (3004 stays private)

## Docker

- ✅ Production Dockerfile reviewed: multi-stage, non-root, no `.env`, no
  database, no dev artifacts, no machine-specific paths
- ✅ Entrypoint: optional `prisma migrate deploy` then `node server.js`
  (stdout/stderr only)
- ✅ Development stack: `docker-compose.dev.yml` (postgres + realtime,
  named volume, loopback-only ports)
- 🔧 Build the images on the Coolify host (this workspace has no Docker
  daemon — **image build not executed here**)

## Coolify

- ✅ Step-by-step runbook matching the repository:
  `docs/coolify-deployment.md` (22 steps, placeholders only)
- 🔧 Actual deployment, domains, TLS, internal hostnames — done in the
  Coolify UI; the runbook explains where to find generated hostnames

## S3 / Backups / Restore

- ✅ AWS-side guide: `docs/aws-s3-backup.md` (bucket, IAM least-privilege,
  encryption, versioning, Object Lock, lifecycle, validation)
- ✅ Restore drill: `docs/backup-restore.md` (disposable-restore procedure)
- 🔧 Bucket + IAM user + Coolify storage destination + schedule
- 🔧 Run the restore drill **at least once** before relying on backups

## First administrator

- ✅ Safe bootstrap: `node scripts/create-admin.mjs` (env-driven password,
  Argon2id, idempotent, refuses when an admin exists — no default passwords)
- 🔧 Run it once against the production database (Coolify terminal)

## Monitoring / Logging

- ✅ stdout/stderr logging only; query logging opt-in (`QUERY_LOG=1`)
- ✅ No secrets/tokens/cookies/passwords in logs (grep-audited)
- ✅ `/api/health` (liveness) + `/api/ready` (DB readiness, 503 on failure)
- 🌱 Uptime alerting / log aggregation — plug into Coolify or your stack

## Security posture

- ✅ Secret scan of repository + git history (no credentials committed;
  historical `.env` contained only a file path, no secrets)
- ✅ Error responses never leak Prisma internals, SQL, stack traces or paths
- ✅ Proxy-aware client IP (last `X-Forwarded-For` entry — spoof-resistant)
- ✅ Import limits: 10 MB, 5,000 rows, 20 worksheets; formula limits:
  2,000 chars, 500 tokens, depth 64, 100k-cell ranges, `#CYCLE!` guard
- ✅ No `eval`/`Function` path in the formula engine (AST interpreter only)
- ✅ Dependencies: unused `jose`, `uuid`, root `socket.io` removed;
  `bcryptjs` kept for the legacy-hash migration path

## Scaling notes (documented, deliberately not built)

* Login/reset rate limiting is per-process — acceptable for a small team
  portal; move to shared storage (Redis) only with multiple replicas.
* Excel import is synchronous within the request but bounded (5k rows);
  a background queue is a future option if imports grow.
* Audit log grows unboundedly — archive on a schedule (SQL export) when it
  becomes large; indexes already exist on the hot columns.
