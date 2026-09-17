# AWS S3 Backup Setup — Coolify → PostgreSQL → S3

This document covers **only the AWS side** of the backup architecture.
The Coolify-side configuration and the restore drill live in
[`docs/backup-restore.md`](backup-restore.md) and
[`docs/coolify-deployment.md`](coolify-deployment.md) (steps 18–22).

> **Nothing here is needed to run the application.** The app itself does not
> use S3 — backups are executed by Coolify against the PostgreSQL resource.
> No AWS credentials ever enter this repository or the web app's environment.

---

## Architecture

```
PostgreSQL (Coolify resource)
   └── Coolify scheduled backup (pg_dump)
          └── uploads to S3 bucket (least-privilege IAM user)
```

## 1. Bucket setup

| Setting | Recommended | Notes |
|---|---|---|
| **Name** | `npl-mis-postgres-backups-<org>` | globally unique, lowercase |
| **Region** | the one closest to your Coolify server (e.g. `ap-south-1` Mumbai) | keep backup region ≠ pointless cross-region latency unless intentional |
| **Block Public Access** | **ALL FOUR options ON** (default) | never disable for backup buckets |
| **Encryption** | SSE-S3 (`AES256`) default, or SSE-KMS for stricter key control | server-side, zero app changes |
| **Versioning** | **Enabled** | protects backup objects from overwrite/accidental deletion |
| **Object Lock (optional)** | Compliance mode, e.g. 30 days | write-once retention; test lifecycle implications before enabling |

Optional lifecycle rule (bucket → Management → Lifecycle):

* Transition to infrequent-access after 30 days,
* Expire noncurrent versions after 90 days (works with versioning).

## 2. IAM — least privilege

Create a **dedicated IAM user** (or role) for Coolify backups — never the
account root, never a shared admin. Attach an inline policy scoped to the
one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CoolifyBackupReadWrite",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:AbortMultipartUpload"],
      "Resource": [
        "arn:aws:s3:::npl-mis-postgres-backups-<org>",
        "arn:aws:s3:::npl-mis-postgres-backups-<org>/*"
      ]
    }
  ]
}
```

Notes:

* No `s3:DeleteObject` — Coolify does not need it for scheduled backups;
  retention is enforced by versioning/lifecycle on the bucket, not by the
  writer. (Add it only if you also want Coolify to prune old backups in the
  bucket.)
* Create an **access key** for this user only when the storage destination
  requires static credentials (Coolify's S3 destination does).
* If your backups target an S3-compatible provider instead (Wasabi, MinIO,
  R2 …), the same policy shape applies with their ARN syntax and an
  `S3_ENDPOINT` override in Coolify.

## 3. Where credentials are entered

**Coolify → Servers → Storage / S3 destinations** (naming varies slightly
by Coolify version; the backup destination selector on the PostgreSQL
resource leads to the same screen):

| Field | Value |
|---|---|
| Endpoint | `https://s3.<region>.amazonaws.com` (or provider endpoint) |
| Region | `ap-south-1` (your bucket's region) |
| Bucket | `npl-mis-postgres-backups-<org>` |
| Access key | the IAM user's access key id |
| Secret key | the IAM user's secret access key |

Coolify validates the connection and lists the bucket when the credentials
and policy are correct.

## 4. Validating the connection

1. Save the storage destination in Coolify (it runs a connectivity check —
   a failure here means endpoint/region/policy issues, not Coolify bugs).
2. PostgreSQL resource → Backups → **Backup Now**.
3. Confirm a fresh object in the bucket (AWS console → S3 → bucket → the
   new `*.sql.gz` with a current timestamp).
4. Perform the **restore drill** in `docs/backup-restore.md` at least once
   before relying on the schedule.

## 5. Separation of concerns (what NOT to do)

* **No AWS credentials in this repository** — not in `.env`, not in the
  Docker image, not in CI. The app never talks to S3.
* Backup credentials ≠ application credentials. Even if the backup IAM user
  leaks, it cannot touch the application, and vice versa.
* The `.env.example` in this repo intentionally contains **no S3 variables**
  — the app does not consume any.
