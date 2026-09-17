# Backup & Restore — NPL MIS Portal (PostgreSQL on Coolify)

The application intentionally contains **no backup subsystem**. Backups are
handled by Coolify's PostgreSQL backup feature with an S3-compatible
destination, which keeps credentials out of the web application and its
container.

---

## Recommended backup policy (starting point — adjust to business needs)

| Schedule | Retention |
|---|---|
| Daily | 7 daily |
| Weekly | 4 weekly |
| Monthly | per business requirement |

These are recommended initial values, not mandatory ones.

## S3 bucket setup (AWS or S3-compatible)

1. **Create a private bucket** (e.g. `npl-mis-backups`), block public access.
2. Pick the **region** (and a custom **endpoint** if using an S3-compatible
   provider other than AWS).
3. Create **least-privilege credentials** — an IAM user/policy restricted to
   the single bucket with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`
   (Coolify needs to write and verify backups):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
       "Resource": ["arn:aws:s3:::npl-mis-backups", "arn:aws:s3:::npl-mis-backups/*"]
     }]
   }
   ```
4. Enable **versioning** on the bucket (protects against overwrite/rollback
   of backups).
5. Configure a **lifecycle rule** to expire objects per your retention
   strategy (align with the Coolify retention settings or let Coolify manage
   deletion — pick one mechanism).
6. Enable **encryption** (SSE-S3 default, or SSE-KMS).
7. Optional but recommended for ransomware resilience: **S3 Object Lock**
   (compliance mode) on the backup prefix.

**Credential separation (important):** these backup credentials are entered
directly in Coolify and are *never* placed in the web application, its
environment variables, or the Docker image. The Next.js app has no AWS SDK
dependency and no runtime S3 usage — backup credentials and any future
runtime storage credentials must remain separate accounts/policies.

---

## Configure in Coolify

1. *Servers → Storage* (or your server's S3 destinations): add the bucket,
   region, endpoint and the credentials from above. Coolify validates the
   storage before saving.
2. Open the **PostgreSQL resource → Backups**: enable **scheduled backups**,
   choose the frequency, retention, and select the S3 destination.
3. Press **Backup Now** and confirm the object appears in the bucket.

## Restore procedure (test in a disposable environment)

> A backup that has never been restored is only a hope. Run this full drill
> at least once after initial deployment, and periodically afterwards.

### 1. Run / locate a manual backup

Trigger *Backup Now* on the PostgreSQL resource (or use the most recent
scheduled backup object in S3).

### 2. Verify successful execution

The PostgreSQL resource's backup history shows a completed entry with size
and timestamp.

### 3. Verify the S3 upload

The bucket contains a fresh object (e.g. `backups/<timestamp>_<db>.sql.gz`).

### 4. Restore into a disposable PostgreSQL instance

Spin up a temporary PostgreSQL (another Coolify resource or a local Docker
container) — never the production one — then:

```bash
# download the backup object from S3, then:
gunzip -c <timestamp>_<db>.sql.gz | psql "postgresql://<user>:<password>@<disposable-host>:5432/npl_mis_restore"
```

### 5. Run Prisma / application checks

Point a copy of the application (or a local checkout) at the restored
database with `DATABASE_URL`, then:

```bash
bunx prisma migrate status   # expected: all migrations applied, no drift
bun scripts/check-db-task20.ts
```

### 6. Verify important MIS data

* record count matches expectations (`SELECT COUNT(*) FROM "MisRecord";` —
  minus soft-deleted rows where applicable),
* spot-check known shipments by LR No. / invoice / party,
* dynamic (EAV) fields render values.

### 7. Verify login / users

```bash
ADMIN_EMAIL=... ADMIN_INITIAL_PASSWORD=... node scripts/create-admin.mjs
```
→ should report that an administrator already exists (restored). Sign in
with a known restored account.

### 8. Verify duplicate constraints

```sql
SELECT "businessKey", "lineKey", COUNT(*) FROM "MisRecord"
WHERE "deletedAt" IS NULL AND "businessKey" IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) > 1;   -- expected: 0 rows
```
Re-importing an already-present Excel file must classify rows as duplicates
/ unchanged — never insert a second copy.

### 9. Verify formulas

Open records with formulas — cached values must display, and the formula
engine must recalculate on edit (spot-check `MisFormula.cachedValue`).

### 10. Verify audit history

`SELECT action, COUNT(*) FROM "AuditLog" GROUP BY action;` — LOGIN, imports,
record changes etc. must be present with timestamps, IPs and request IDs.

### 11. Tear down the disposable environment

Delete the temporary database and any local copies of the backup file once
the drill passes.
