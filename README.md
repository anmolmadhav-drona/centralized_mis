# NPL MIS Portal — Drona Logitech Centralized MIS

The centralized Management Information System of Drona Logitech (NPL
logistics): one connected workspace for operational data, Excel
import/export, calculation, delivery tracking, analytics and reporting.

## What this project is

A production-grade internal portal for managing shipment records (LR,
invoice, party, material, delivery status) with:

* **Excel-first data flow** — upload → parse → preview with duplicate
  analysis → confirm → database. Nothing is written before you approve it.
* **Duplicate prevention** — every record carries a composite business
  identity (`businessKey` + `lineKey`); duplicates are caught in-file, in
  preview, and by a database unique constraint (race-safe).
* **Dynamic fields & formulas** — the field registry is data-driven
  (columns can be added without migrations) and cells support Excel-style
  formulas (`=SUM(...)`, `=Bucket*3`, `=B2*2`) evaluated by a sandboxed AST
  engine — never arbitrary JavaScript.
* **RBAC** — ADMIN / MANAGER / USER / VIEWER with server-side permission
  checks on every API route.
* **Realtime** — a separate Socket.IO service pushes live update toasts to
  every open browser.

## Architecture

```
USERS → HTTPS → reverse proxy (Coolify)
                    ├── Web app   (this repo: Next.js 16, port 3000, standalone)
                    ├── Realtime  (mini-services/realtime — Socket.IO, own image)
                    └── PostgreSQL (dedicated database resource)
                              └── Coolify scheduled backups → S3
```

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router, standalone output), React 19, TypeScript (strict), Tailwind + shadcn/ui, AG Grid |
| Database | PostgreSQL + Prisma (committed migrations) |
| Auth | Auth.js v5 (NextAuth) — credentials, Argon2id hashing, legacy-bcrypt migration, JWT sessions, rate limiting |
| Realtime | Socket.IO microservice with shared-secret internal emit endpoint |
| Excel | SheetJS (parse) + ExcelJS (export) |
| Tests | 46 business-key unit + 42 formula unit + 61 API e2e + 50 import e2e + 12 password-reset e2e checks |

## Requirements

* **Bun ≥ 1.1** — the package manager (`bun.lock` is the lockfile; do not mix npm/pnpm)
* **Node.js ≥ 22** — production runtime
* **Docker + Compose** — for the local PostgreSQL + realtime stack (optional but recommended)

## Quick local setup

```bash
git clone <repository-url> npl-mis && cd npl-mis
bun install                        # install dependencies (locked)
bun run setup:local               # tools → .env → docker stack → migrate → seed
bun run dev                        # http://localhost:3000
```

`setup:local` checks the required tools, creates `.env` with locally
generated secrets (never overwriting an existing one), starts the local
PostgreSQL + realtime stack, applies committed migrations, and seeds demo
data **only when the database is empty** (the seed is destructive — it never
runs against a database that already holds data; skip with `--skip-seed`).
No AWS, Coolify or SMTP configuration is required locally.

The equivalent manual steps, minimum `.env`, and the full walkthrough with
troubleshooting: **[docs/local-development.md](docs/local-development.md)**.

Seeded demo accounts (development only): `admin@npl.com` / `Admin@123` —
plus manager / user / viewer variants.

## Environment variables

The complete, annotated reference is **[`.env.example`](.env.example)** —
every variable the code actually consumes, marked with purpose, secret
status, requirement and format. Summary:

| Variable | Purpose | Required | Secret |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | yes (prod) | yes |
| `AUTH_SECRET` | signs JWT session cookies | yes (prod) | yes |
| `REALTIME_URL` | internal `/emit` endpoint (server→service) | prod | no |
| `REALTIME_SECRET` | shared secret web↔realtime | prod | yes |
| `REALTIME_PUBLIC_URL` | browser Socket.IO endpoint | prod | no |
| `REALTIME_PORT` / `REALTIME_ADMIN_PORT` / `REALTIME_ADMIN_BIND` / `REALTIME_ALLOWED_ORIGIN` | realtime service config | prod (service) | no |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | password-reset email | when used | password only |
| `APP_URL` | reset-link origin override | no | no |
| `MIGRATE_ON_START` | entrypoint runs `prisma migrate deploy` | no (default true) | no |
| `QUERY_LOG` | Prisma query logging (debug) | no | no |
| `NEXT_PUBLIC_DEMO_LOGIN` | demo quick-login buttons | sandbox only | no |

Startup validation (`src/lib/env.ts`) refuses to boot in production without
`DATABASE_URL` / `AUTH_SECRET` and reports misconfigurations by name —
never by value. No S3/AWS variables exist: the app does not use object
storage (backups are Coolify → S3, configured in Coolify only).

## Database

* Migrations are committed under `prisma/migrations/` — apply with
  `bun run db:deploy` (production: `prisma migrate deploy`, run by the
  container entrypoint unless `MIGRATE_ON_START=false`).
* Development schema changes: edit `prisma/schema.prisma` →
  `bun run db:migrate` (creates a migration file — commit it).
* **Never** use `prisma migrate reset` or `prisma db push
  --accept-data-loss` against production. `db:push` is intentionally
  disabled in `package.json`.
* Seeding: `bun run db:seed` (demo dataset, refuses in production).
  Destructive local resets are explicit: `bun run db:reset-local`.
* Identity model & duplicate rules: **[docs/duplicate-system.md](docs/duplicate-system.md)**.

## Authentication

Auth.js v5 (NextAuth) credentials flow:

* Argon2id password hashing (OWASP-aligned parameters, `hash-wasm`).
* Legacy bcrypt hashes are verified and transparently re-hashed to Argon2id
  on the next successful login — no forced resets.
* JWT sessions: HttpOnly cookies, SameSite=Lax, Secure in production,
  7-day TTL. Role claims are never trusted from the client — every request
  re-reads the user (deactivated accounts lose access immediately).
* Login rate limiting (10 failures/min/IP), uniform error messages (no
  account enumeration), LOGIN / LOGIN_FAILED audit events with IP + UA +
  request id.
* Password reset: single-use 30-minute tokens stored as SHA-256 hashes,
  anti-enumeration endpoints, SMTP delivery (dev console sink without SMTP —
  never fakes a send).

## Realtime

* **Local**: `bun run docker:dev` runs the service on `127.0.0.1:3003`
  (Socket.IO) + `127.0.0.1:3004` (internal `/emit`); the web app posts
  events with `REALTIME_SECRET`.
* **Coolify**: deployed as its own application from
  `mini-services/realtime/Dockerfile`; publish **3003 only** (3004 stays on
  the private network); `REALTIME_ALLOWED_ORIGIN` = the web app's public
  origin (wildcards refused); identical `REALTIME_SECRET` on both apps; the
  browser endpoint arrives at runtime via `/api/config`
  (`REALTIME_PUBLIC_URL`) — nothing is baked into the build.

## Testing

| Command | Suite | Needs |
|---|---|---|
| `bun run verify` | **typecheck · lint · unit tests · production build** in one gate | nothing |
| `bun run verify:full` | verify + all three e2e suites (manages its own production server) | local stack + seeded DB |
| `bun run test` | business-key normalization + identity (46 checks) | nothing |
| `bun run test:formula` | formula engine (42 checks) | nothing |
| `bun run lint` / `bun run typecheck` | ESLint / TypeScript | nothing |
| `bun run test:e2e` | API e2e: auth, RBAC, CRUD, concurrency, export, import, audit (61 checks) | server on :3000 |
| `bun run test:import` | import/duplicate/race/perf e2e (50 checks) | server + DB |
| `bun run test:reset` | password-reset e2e (12 checks) | server + DB |
| `bun scripts/make-import-fixtures.ts` | regenerate Excel fixtures into `tests/fixtures/` | nothing |

CI (GitHub Actions) runs install → prisma generate → typecheck → lint →
unit tests → production build against a real PostgreSQL service — no AWS,
no Coolify, no secrets. See `.github/workflows/ci.yml`.

## Production deployment

Docker-first: the root `Dockerfile` builds a multi-stage, non-root Node 22
image running the standalone server on `0.0.0.0:3000` with a
`migrate-deploy` entrypoint and container healthcheck. Deploy on **Coolify**
by following **[docs/coolify-deployment.md](docs/coolify-deployment.md)**
(23 steps: PostgreSQL resource → web app → realtime service → domains →
env vars → migrations → health checks → backups → verification).

Validate the production environment contract at any time — locally against
an env file, or inside the deployed container — without printing secrets:

```bash
bun run preflight:prod            # local (reads .env if present)
node scripts/preflight-prod.mjs   # inside the production container
```

## Coolify

Web app + realtime service + PostgreSQL resource, all created from this one
repository. Key points (full runbook in the doc above):

* use the PostgreSQL resource's **internal** hostname in `DATABASE_URL`,
* set the realtime service's **generated internal hostname** in
  `REALTIME_URL` (find it in the resource's Connect/Network section — do
  not guess),
* health check `http://localhost:3000/api/health` (liveness) —
  `/api/ready` adds database connectivity,
* single replica: `MIGRATE_ON_START=true` (default); multiple replicas:
  `false` everywhere + migrations as an explicit deploy step.

## S3 backups

PostgreSQL → Coolify scheduled backup → S3. Bucket setup, IAM
least-privilege, encryption, versioning, Object Lock, lifecycle and
connection validation: **[docs/aws-s3-backup.md](docs/aws-s3-backup.md)**.
Restore drill: **[docs/backup-restore.md](docs/backup-restore.md)**.
No AWS credentials ever enter this repository or the application
environment.

## First administrator

Production has **no default passwords**. After the first deployment, run
once (Coolify web-app terminal or locally with `DATABASE_URL` set):

```bash
ADMIN_EMAIL="ops@example.com" \
ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 24)" \
node scripts/create-admin.mjs
```

Argon2id-hashed, idempotent (refuses when an active admin exists), password
never stored in the repo. Demo users exist **only** through the
development-only seed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Environment validation failed` at startup | the error names the missing/invalid variable — see `.env.example` |
| Login fails on a fresh setup | run `bun run db:seed` (demo users are seeded, not built-in) |
| No realtime toasts | check the realtime service is running and `REALTIME_SECRET` matches on both sides |
| `P1001 Can't reach database` | PostgreSQL not up / wrong `DATABASE_URL` host |
| Excel import rejected | limits: 10 MB, 5,000 rows, 20 worksheets; malformed files are rejected with a clear error |
| Reset email never arrives | SMTP not configured — check server logs; see `.env.example` SMTP section |
| Type/lint failures block the build | intentional (`ignoreBuildErrors: false`) — fix the source, never the flag |

More: [docs/local-development.md](docs/local-development.md) ·
[docs/production-checklist.md](docs/production-checklist.md).
