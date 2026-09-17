# Local Development — NPL MIS Portal

Everything needed to go from `git clone` to a running local instance.
Production deployment is covered separately in
[`docs/coolify-deployment.md`](coolify-deployment.md).

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Bun** | ≥ 1.1 | package manager + TS runner (`bun.lock` is the lockfile — do **not** mix npm/pnpm/yarn) |
| **Docker** + Compose v2 | any recent | runs the local stack: PostgreSQL 17 + the realtime service |
| **Node.js** | ≥ 22 | production runtime (only needed to run the built standalone server) |
| **Git** | any | cloning |

No AWS, no Coolify, no SMTP credentials are needed for local development.

---

## One-command setup

```bash
git clone <repository-url> npl-mis && cd npl-mis
bun install
bun run setup:local
bun run dev
```

`bun run setup:local` performs, in order:

1. **tool check** — bun ≥ 1.1, docker daemon, `docker compose` v2
2. **`.env`** — if missing, creates one with working local values
   (`DATABASE_URL` → the compose PostgreSQL, freshly generated
   `AUTH_SECRET` + `REALTIME_SECRET`, realtime URLs). An **existing** `.env`
   is validated (required keys present) and **never overwritten**
3. **local stack** — `docker compose -f docker-compose.dev.yml up -d`
   (PostgreSQL 17 with a named volume + the realtime service)
4. **wait for PostgreSQL health** — polls the container healthcheck (≤ 120 s)
5. **Prisma client** — `bun run db:generate`
6. **migrations** — `bun run db:deploy` (`prisma migrate deploy`,
   non-destructive, applies the committed migrations)
7. **seed — only when the database is completely empty** (zero users *and*
   zero records). The seed is destructive by design, so it never runs against
   a database that already holds data. Skip explicitly with `--skip-seed`
8. **final checks** + prints the next command

Ports used locally (all bound to the host's loopback):

| Port | Service | Public? |
|---|---|---|
| 3000 | Next.js app (`bun run dev`) | local |
| 5432 | PostgreSQL 17 (compose, named volume `npl_pgdata_dev`) | loopback only |
| 3003 | realtime — Socket.IO (browser connections) | loopback only |
| 3004 | realtime — internal `/emit` endpoint (server → service, secret-guarded) | loopback only |

### Seeded demo accounts (development only)

| Email | Password | Role |
|---|---|---|
| `admin@npl.com` | `Admin@123` | ADMIN |
| `manager@npl.com` | `Manager@123` | MANAGER |
| `user@npl.com` | `User@123` | USER |
| `viewer@npl.com` | `Viewer@123` | VIEWER |

These exist **only** through the development seed. Production never has
default passwords — the first admin is created explicitly with
`scripts/create-admin.mjs` (see README → “First administrator”).

---

## Manual setup (the long way)

The same steps `setup:local` automates, explicitly:

```bash
bun install                                # dependencies (locked)
cp .env.example .env                       # then edit — minimum below
bun run docker:dev                         # PostgreSQL + realtime (docker compose)
bun run db:generate                        # Prisma client
bun run db:deploy                          # apply committed migrations
bun run db:seed                            # demo data (development only, destructive)
bun run dev                                # http://localhost:3000
```

Minimum `.env` for local development:

```bash
DATABASE_URL=postgresql://npl:npl_dev_password@127.0.0.1:5432/npl_mis
AUTH_SECRET=<bun scripts/generate-secrets.ts auth>
REALTIME_SECRET=<bun scripts/generate-secrets.ts realtime>
REALTIME_URL=http://127.0.0.1:3004
REALTIME_PUBLIC_URL=http://localhost:3003
```

`generate-secrets.ts` prints cryptographically secure values (node:crypto) —
copy them straight into `.env`. Rotating `AUTH_SECRET` later invalidates all
sessions (everyone signs in again); `REALTIME_SECRET` must match the realtime
service — the compose stack reads it from the same `.env` automatically.

---

## Daily commands

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server on <http://localhost:3000> |
| `bun run docker:dev` / `docker:dev:down` | start / stop the local stack (PostgreSQL + realtime) |
| `bun run verify` | **typecheck · lint · unit tests · production build** (no services needed) |
| `bun run verify:full` | verify + the three server e2e suites (manages its own production server on :3000; needs the stack up + seeded DB) |
| `bun run test` | business identity & normalization unit tests (46 checks) |
| `bun run test:formula` | formula engine unit tests incl. injection safety (42 checks) |
| `bun run test:e2e` | API e2e — requires a server on :3000 (61 checks) |
| `bun run test:import` | Excel import/duplicate/race e2e (50 checks) |
| `bun run test:reset` | password-reset e2e (12 checks) |
| `bun run lint` / `typecheck` | ESLint / TypeScript |
| `bun run db:studio` | Prisma Studio (browse the database) |
| `bun run preflight:prod` | validate a **production-shaped** environment (see below) |

CI (`.github/workflows/ci.yml`) runs the service-free subset of `verify`
against a real PostgreSQL service on every push/PR.

> **Rate-limit note for the e2e suites:** login throttling (10/min/IP) is
> in-memory per process. Running several suites back-to-back against the same
> server can trip it — `verify:full` restarts its server between suites for
> exactly this reason. If you run suites by hand against a long-lived server
> and see uniform 429 login failures, restart the server and re-run.

---

## Environment validation

The application validates its server environment at startup
(`src/lib/env.ts`, invoked from `src/instrumentation.ts`):

* **Fatal in production**: `DATABASE_URL` (must be a PostgreSQL URL) and
  `AUTH_SECRET` (≥ 32 chars) — the app refuses to boot, naming the variable
  and the reason, never the value.
* **Loud but non-fatal in production**: realtime wiring
  (`REALTIME_URL` / `REALTIME_PUBLIC_URL` / `REALTIME_SECRET`) and SMTP — the
  app boots and the affected feature degrades with clear log lines naming the
  missing variable. Realtime events are dropped and password-reset mail is not
  sent until configured.
* **Development** never crashes on missing integrations — safe, documented
  local defaults apply (see `.env.example`).
* Optional groups (SMTP) are only validated when their primary variable is
  present.

`scripts/preflight-prod.mjs` (below) is the **stricter, pre-deployment**
variant: it fails on missing realtime wiring and forbidden dev settings.

---

## Database commands

| Command | Effect |
|---|---|
| `bun run db:generate` | generate the Prisma client (after schema edits) |
| `bun run db:migrate` | create + apply a **development** migration from schema changes (commit the generated file) |
| `bun run db:deploy` | apply committed migrations (`prisma migrate deploy`) — the production command |
| `bun run db:seed` | demo dataset (users + field registry + sample records). **Destructive reset of records/fields/audit** — development only |
| `bun run db:reset-local` | explicit destructive reset of the local database (typed confirmation; refuses production) |
| `bun run db:studio` | Prisma Studio GUI |
| `bun run admin:create` | create the first administrator (env-driven; for production) |

Never use `prisma migrate reset` or `prisma db push --accept-data-loss`
against a production database — `db:push` is intentionally disabled in
`package.json`.

The local PostgreSQL data lives in the named Docker volume
`npl_pgdata_dev` (outside the repository). It survives restarts and is wiped
only by an explicit `docker compose -f docker-compose.dev.yml down -v`.

---

## Realtime, locally

The compose stack runs the same realtime service that ships to production
(`mini-services/realtime`, built from its own Dockerfile):

* the **browser** connects to Socket.IO on `http://localhost:3003`
  (`REALTIME_PUBLIC_URL`, served to clients via `/api/config`);
* the **web app** POSTs events to the internal admin endpoint
  `http://127.0.0.1:3004/emit` (`REALTIME_URL`) with the shared
  `REALTIME_SECRET` (both read the same `.env`);
* in development the service reflects the request origin for CORS; production
  requires the explicit `REALTIME_ALLOWED_ORIGIN` allowlist.

Quick smoke test once the app is running: open it in two browser windows and
edit a record in one — the other window shows a live toast within seconds.
The service logs connections to `docker logs npl-mis-realtime-dev`.

---

## Production preflight

Before deploying (or from inside the deployed container's terminal):

```bash
bun run preflight:prod              # local: reads .env if present
node scripts/preflight-prod.mjs     # inside the production container
```

Validates the production contract — `DATABASE_URL` (PostgreSQL, not
localhost), `AUTH_SECRET`, the full realtime wiring
(`REALTIME_URL`/`REALTIME_PUBLIC_URL`/`REALTIME_SECRET`/`REALTIME_ALLOWED_ORIGIN`,
wildcards refused), SMTP consistency when present, and forbidden development
settings (`NEXT_PUBLIC_DEMO_LOGIN`, `QUERY_LOG=1`, `ALLOW_PROD_SEED`).
Fails with clear variable names; **never prints secret values** (secrets are
reported as set/not-set/length only).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup:local` — “Docker daemon is not running” | start Docker Desktop / the docker service |
| `setup:local` — “PostgreSQL did not become healthy” | `docker logs npl-mis-postgres-dev`; a stale volume from an incompatible PostgreSQL version needs `docker compose -f docker-compose.dev.yml down -v` (data loss — dev only) |
| `P1001 Can't reach database` | stack not up (`bun run docker:dev`) or `DATABASE_URL` host/port wrong |
| `Environment validation failed` at startup | the error names the variable — see `.env.example` |
| Login fails on a fresh setup | demo users come from the seed: `bun run db:seed` |
| No realtime toasts | service down, or `REALTIME_SECRET` differs between `.env` and the compose stack (it reads the same file — check for typos) |
| e2e suites fail with 429s | login rate limit is per-process — restart the server or use `bun run verify:full`, which restarts between suites |
| Excel import rejected | enforced limits: 10 MB, 5 000 rows, 20 worksheets; malformed files are rejected with a clear error |
| Port 3000 busy | stop the other process; `verify:full` refuses to start if :3000 is already serving |

---

## Resetting the local environment

```bash
bun run docker:dev:down                       # stop the stack
docker compose -f docker-compose.dev.yml down -v   # ALSO wipe the dev volume (destructive)
rm .env                                       # optional: regenerate on next setup
bun run setup:local                           # fresh database + seed
```
