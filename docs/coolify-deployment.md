# Coolify Deployment — NPL MIS Portal (Drona Logitech Centralized MIS)

This guide takes the repository to a production deployment on Coolify with a
dedicated PostgreSQL resource, a separate realtime service, and scheduled
PostgreSQL backups uploaded to Amazon S3.

**Architecture**

```
USERS → HTTPS → Coolify Reverse Proxy
                    ├── Web application  (Next.js, port 3000, this repo's Dockerfile)
                    ├── Realtime service (Socket.IO, mini-services/realtime)
                    └── PostgreSQL resource (dedicated Coolify database)
                              └── Coolify scheduled backups → Amazon S3
```

Coolify handles the public domain, HTTPS/TLS, reverse proxying and routing.
The web container contains no database, no secrets and no `.env` file — all
configuration is injected through environment variables.

---

## Deployment order (follow exactly)

### 1. Create the PostgreSQL resource in Coolify

*Resources → New → PostgreSQL.* Choose a strong admin password (or keep the
generated one) and a database name, e.g. `npl_mis`. Do **not** enable a public
port — the database must only be reachable inside Coolify's private network.

### 2. Verify PostgreSQL is healthy

Wait until the resource status is *running*; check its logs for
`database system is ready to accept connections`.

### 3. Create the web application from the Git repository

*Resources → New → App* → point it at this repository (the branch you want
to deploy). Coolify builds it with the root `Dockerfile`
(multi-stage: deps → build → minimal Node.js runtime).

### 4. Build using the production Dockerfile

The root `Dockerfile` is picked up automatically. The build:

* installs dependencies with Bun (locked),
* generates the Prisma client and runs `next build`
  (TypeScript errors **fail** the build),
* produces a minimal Node 22 runtime image on `/app`, running as a non-root
  user, listening on `0.0.0.0:3000`.

No `.env`, SQLite file, logs or development artifacts enter the image
(enforced by `.dockerignore`).

### 5. Configure the application port

*Application → Configuration → Ports*: expose port **3000** (the container's
`Dockerfile` already listens on `0.0.0.0:3000`).

### 6. Configure the domain

*Application → Configuration → Domains*: add your domain, e.g.
`https://mis.example.com`, and let Coolify issue the TLS certificate.

### 7. Configure environment variables

*Application → Environment Variables* — see `.env.example` for the full
reference. Minimum set for the web app:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://<user>:<password>@<postgres-resource-host>:5432/npl_mis` (use the Coolify-internal hostname) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `REALTIME_URL` | `http://<realtime-service-host>:3004` (set after step 9; can be added later) |
| `REALTIME_SECRET` | `openssl rand -hex 24` (same value as the realtime service) |
| `REALTIME_PUBLIC_URL` | `https://rt.example.com` (the realtime service's public domain) |

Optional: `MIGRATE_ON_START=false` if you prefer running migrations as an
explicit step (see step 8).

### 8. Deploy database migrations (`prisma migrate deploy`)

By default the container entrypoint runs `prisma migrate deploy` on start
(`MIGRATE_ON_START=true`). For explicit control:

* set `MIGRATE_ON_START=false` in the web app's environment, and
* run once per deploy (Coolify terminal or one-off command):
  `node node_modules/prisma/build/index.js migrate deploy`

Never use `prisma db push --accept-data-loss` or `prisma migrate reset`
against production.

### 9. Create the realtime service

Create a **second** Coolify application from the same repository with
**Build Pack: Dockerfile** and **Dockerfile location:**
`/mini-services/realtime/Dockerfile`. Expose port **3003** and give it a
domain, e.g. `https://rt.example.com`.

Environment variables for the realtime service:

| Variable | Value |
|---|---|
| `REALTIME_SECRET` | same value as the web app's |
| `REALTIME_ALLOWED_ORIGIN` | `https://mis.example.com` |
| `REALTIME_ADMIN_BIND` | `0.0.0.0` (so the web app can reach it over the private network) |

Ports `3004` (admin/`/emit`) must never be published publicly — only
reachable inside Coolify's private network.

### 10. Configure the internal realtime URL

Back in the **web app**, set `REALTIME_URL` to the realtime service's
*internal* address (Coolify shows the container hostname, e.g.
`http://realtime-svc:3004`), and `REALTIME_PUBLIC_URL` to
`https://rt.example.com`.

### 11. Configure the health check

*Web application → Health check*: use `http://localhost:3000/api/health`
(liveness). `/api/ready` additionally verifies database connectivity and
returns 503 when PostgreSQL is unreachable. (The Dockerfile also ships a
container-level HEALTHCHECK against `/api/health`.)

### 12. Deploy the web application

Press **Deploy**. The first build takes a few minutes.

Optional but recommended immediately after the first deploy: open the web
application's **terminal** (Coolify → web app → Terminal) and run the
production preflight —

```bash
node scripts/preflight-prod.mjs
```

It validates the full production contract (`DATABASE_URL` is a real
PostgreSQL service, `AUTH_SECRET`, realtime wiring incl.
`REALTIME_ALLOWED_ORIGIN`, forbidden development settings such as
`NEXT_PUBLIC_DEMO_LOGIN`) and **never prints secret values**. Any ✗ item is
a misconfiguration to fix before trusting the deployment.

### 13. Verify `/api/health`

`curl https://mis.example.com/api/health` → `{"ok":true}`

### 14. Verify `/api/ready`

`curl https://mis.example.com/api/ready` → `{"ok":true,"database":"up"}`
(if this fails, check `DATABASE_URL` and network access to the PostgreSQL resource)

### 15. Create the production administrator and verify login

Run once — in the **web app container terminal** (Coolify → web application →
Terminal), or locally with `DATABASE_URL` pointing at the database:

```bash
ADMIN_EMAIL="ops@example.com" \
ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 24)" \
ADMIN_NAME="Operations Admin" \
node scripts/create-admin.mjs
```

(The script ships in the image and runs with plain `node` — no bun/TypeScript
needed inside the container. Locally, `bun scripts/create-admin.mjs` works
too.) It is idempotent: if an active admin already exists it does nothing.

Then sign in at `https://mis.example.com` with that account. **There are no
default production passwords** — the demo quick-login buttons only exist in
evaluation builds (`NEXT_PUBLIC_DEMO_LOGIN` is never set in production).

### 16. Verify MIS operations

Sign in and check: records grid loads, create/edit a record, run the Excel
import (preview → duplicate analysis → confirm), export, formulas, delivery
status sync, reports/dashboard.

### 17. Verify realtime

Open the MIS in two browser windows; edit a record in one — the other should
show the live update toast within a couple of seconds. The realtime service
logs the Socket.IO connections; the login page badge/status indicator in the
app reflects connectivity.

### 18. Configure PostgreSQL scheduled backups

*PostgreSQL resource → Backups*: enable scheduled backups.
Recommended starting policy (adjust to business needs):

* **Daily** backups, retain **7 daily**
* **Weekly** backups, retain **4 weekly**
* Monthly retention per business requirement

### 19. Connect the backup schedule to S3

*Coolify → Servers → Storage/S3 destinations* (or the backup destination
selector on the database resource): add your S3 bucket, region, endpoint and
least-privilege credentials (see **`docs/aws-s3-backup.md`** for bucket/IAM
setup; `docs/backup-restore.md` for the restore drill). Coolify validates
the storage before use.

### 20. Run "Backup Now"

Trigger a manual backup from the PostgreSQL resource and confirm it succeeds.

### 21. Verify the S3 upload

Check the bucket: a new backup object must exist with a fresh timestamp.

### 22. Test a restore in a disposable database

A successful backup is not proof of recoverability. Follow the restore-test
procedure in **`docs/backup-restore.md`** (restore into a disposable
PostgreSQL instance, run the application checks, verify MIS data, logins,
duplicate constraints, formulas and audit history) at least once before
relying on the schedule.

### 23. (Optional) Enable password-reset email (SMTP)

The password-reset foundation is built in (single-use 30-minute tokens,
anti-enumeration endpoints, Argon2id rehash — see
`docs/production-checklist.md`). Without SMTP it stays dormant: reset
requests are accepted but nothing is sent, and the server logs a clear
error. To enable delivery, set on the **web application**:

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp.example.com` |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS) |
| `SMTP_USER` / `SMTP_PASSWORD` | your SMTP credentials (set together) |
| `SMTP_FROM` | `no-reply@example.com` |

Then redeploy and use *Forgot password?* on the sign-in page. The reset
link points at the app's public origin (set `APP_URL` explicitly if your
proxy forwards an ambiguous origin).

---

## Operational notes

* **Logs** — both containers log to stdout/stderr; view them in Coolify's
  log viewer. Prisma query logging is off by default (`QUERY_LOG=1` to enable
  temporarily).
* **Preflight** — `node scripts/preflight-prod.mjs` runs in the web
  container at any time to re-validate the environment contract after
  changes (no secrets printed).
* **Scaling** — for multiple web replicas set `MIGRATE_ON_START=false` and
  run migrations as an explicit deploy step.
* **Import limits** (documented, enforced): 10 MB file size, 5,000 rows per
  file, 20 worksheets per workbook.
* **In-memory rate limiting** — login throttling is per-process; with
  multiple replicas the effective limit multiplies.
