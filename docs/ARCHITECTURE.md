# ARCHITECTURE (verified against code)

## A. System overview

- Web app: Next.js 16 App Router, `output: "standalone"` (`next.config.ts`), React 19, TS strict (`ignoreBuildErrors: false`). Served on port 3000 via `.next/standalone/server.js` (`package.json` start, `Dockerfile` runtime).
- Database: PostgreSQL + Prisma 6 (`prisma/schema.prisma`, committed migrations in `prisma/migrations/`). `db:push` is disabled; migrations via `prisma migrate deploy` (entrypoint, `MIGRATE_ON_START`).
- Auth: Auth.js v5 credentials (`src/lib/auth.ts`), JWT 7 days, HttpOnly SameSite=Lax (Secure in prod), `trustHost: true`.
- Realtime: separate Socket.IO service `mini-services/realtime/index.ts` (public 3003, admin 3004). Web → service POST `/emit` with `x-rt-secret`; browsers connect to `REALTIME_PUBLIC_URL` (via `/api/config`) else same-origin fallback.
- Excel: SheetJS `xlsx` parses uploads (`src/lib/excel/import.ts`); ExcelJS builds exports (`src/lib/excel/export.ts`, `src/app/api/reports/export/route.ts` untracked — see §I).
- Client state: TanStack Query (server data) + zustand (`src/lib/client/store.ts`: view, user, `refreshEpoch`, notifications, `misSearch`).
- Env validation at boot: `src/lib/env.ts` via `src/instrumentation.ts`. Prod fatals: `DATABASE_URL`, `AUTH_SECRET`. Realtime/SMTP misconfig = loud degrade, still boots.

Real request flow:

```
Browser (AG Grid / forms / dashboard)
  → hooks (src/lib/client/hooks.ts: useFields/useRealtime) / api client (src/lib/client/api.ts)
  → Next.js route (src/app/api/*/route.ts) wrapped in route() + requirePermission()
  → service (src/lib/services/*, src/lib/excel/*)
  → Prisma (src/lib/db.ts; rawQuery rewrites ? → $n for Postgres)
  → audit (src/lib/services/audit.ts) + realtime emit (src/lib/services/realtime.ts, fire-and-forget)
  → client refresh via refreshEpoch / query invalidation
```

## B. Database (prisma/schema.prisma)

- `User`: id(cuid), email unique, name, passwordHash, role string default USER, active, timestamps. Index on role. Relations: PasswordResetToken[].
- `PasswordResetToken`: userId FK cascade, tokenHash unique (SHA-256 of raw token), expiresAt (+30 min), usedAt nullable (single use). Indexes userId, expiresAt.
- `MisField` (registry): fieldKey unique (machine key), fieldName unique (EXACT Excel header), displayName, dataType (8 values), required, defaultValue, options (JSON string), position, isCore, isSystem, active, width. Indexes position, active. Has many MisValue.
- `MisRecord`: id, version (optimistic lock), ~30 core typed columns (see §D), businessKey/lineKey nullable, trackingId/liveStatus/lastStatusUpdate, values/formulas relations, createdBy/updatedBy, deletedAt (soft delete). `@@unique([businessKey, lineKey])` — NULL businessKey exempt (SQL NULLs distinct). Indexes: lrNo, partyName, destination, deliveryStatus, lrDate, dispatchDate, vendorName, podStatus, loadType, liveStatus, trackingId, updatedAt, deletedAt.
- `MisValue` (EAV dynamic fields): recordId+fieldId unique; valueText/valueNumber/valueDate/valueBool. Indexes (fieldId,value*).
- `MisFormula`: recordId+fieldKey unique, formula text, cachedValue JSON. FK cascade.
- `AuditLog`: userId/userName, action, entity, entityId, fieldName, old/new JSON, source PORTAL|EXCEL|API, ip, userAgent, requestId. Indexes createdAt, userId, entity, action, requestId.
- `ImportJob`: userId/userName, fileName, status PREVIEW|CONFIRMED|CANCELLED, stats/result/payload JSON, createdAt/confirmedAt. Index createdAt.

## C. Auth + RBAC

- Login: `authorize()` in `src/lib/auth.ts` — rate limit 10/min/IP, email lowercase, uniform null on failure + LOGIN_FAILED audit; Argon2id verify, bcrypt legacy compare + transparent rehash; LOGIN audit. Inactive (`!user.active`) → fail.
- Session: JWT (`token.id`, `token.role`), cookie session via `auth()`; `getSessionUser()` re-reads DB every request, returns null if missing/inactive. Every API route calls `requireUser`/`requirePermission` (`src/lib/api.ts`); Zod errors → 400, ApiError → its status, else 500 with requestId (never stack).
- Roles/permissions (`src/lib/rbac.ts`): ADMIN (all + `can()` always true), MANAGER (records CRUD, dashboard, import/export, fields:view, reports, settings:view), USER (view/create/edit, import/export, fields:view), VIEWER (view + export + fields:view). Role labels/descriptions for UI.
- Field-level restriction (`src/lib/table-access.ts` RESTRICTED_TABLES, ADMIN/MANAGER only): vehicleRate, loadingCharges, unloadingCharges, rate, totalRate. Enforcement at 4 layers: `filterFieldsForRole` (schema list), `stripRestrictedFields*` (read values), `assertFieldsWritable` (403 on write), `assertQueryModelAllowed` (403 on filter/sort oracle). Single place to extend.
- Middleware: `src/middleware.ts` exists (route/page gate — verify before changing); server is still authoritative.

## D. MIS core

- Registry: `src/lib/services/fields.ts` — globalThis cache (15s TTL, shared across route bundles), `getFields(includeInactive=false)` filters `active`, `getFieldsForRole(role, includeInactive=false)` then role-filters. `mapFieldRow` coerces core DROPDOWN→TEXT display and parses options JSON. `CORE_COLUMNS` maps core keys → DB columns (no `liveStatus` entry — it is not registry-driven). `TYPE_TRAITS` drives coercion/editors/filters.
- `/api/fields` GET (`src/app/api/fields/route.ts:14`): `getFieldsForRole(user.role, true)` — intentionally returns INACTIVE rows so Settings can manage/reactivate. Grid hides them client-side; export uses active-only list.
- Grid: `src/components/mis/MisGrid.tsx` (AG Grid infinite row model) → datasource GET `/api/records?start&end&search&filter&sort`; columns from `buildColumnDefs(fields)` in `src/components/mis/gridColumns.ts:71-73` which skips `isSystem` and `!active` (generic rule — no liveStatus special-case). Row-number col; persisted col state (`npl-mis-colstate-v2`).
- Editing: cell save PATCH `/api/records/[id]` with `version`; `src/lib/services/records-mutations.ts` validates, coerces, recomputes keys + delivery patch, bumps version; stale version → VERSION_CONFLICT → `ConflictDialog`. Bulk paste via POST `/api/records/bulk` through `ExcelGridController` (`src/components/mis/excelGrid.ts` — fill-handle/clipboard/undo; do not touch casually). Suggest: `/api/records/suggest`.
- Queries: `src/lib/services/records-query.ts` — parameterized raw SQL over core+EAV (whitelisted columns, bound values, portable `?`), LOWER() LIKE for Postgres parity, formula attach (`_formulas`/`_formulaErrors`).
- Formulas: `MisFormula` + engine `src/lib/formula/*` (tokenizer→parser→AST→evaluate; resolvers for column/A1/range). Capable types TEXT/LONG_TEXT/INTEGER/DECIMAL. Export writes calculated values only.
- Identity: `businessKey`=LR|Invoice|Party (null if any part missing → exempt), `lineKey`=Material|Bucket|Qty (`src/lib/services/business-key.ts`). Import + mutations share it; DB UNIQUE pair; P2002 = concurrent race.
- Deletion: soft (`deletedAt`); every read filters `deletedAt: null`.

## E. Excel import (IMPLEMENTED: single-sheet)

Pipeline (`src/lib/excel/import.ts` 422 lines + `import-apply.ts` 574 lines):

```
Upload → size/type guard (10 MB, .xlsx, ≤20 sheets) → SheetJS parse (cellDates+formulas)
  → detectSheet: prefer 'MIS', else first sheet with ≥8 known headers in rows 0..4
  → header map (exact case-insensitive fieldName; SYS_RECORD_ID/SYS_VERSION; ignore sr.no variants)
  → row parse + formula capture (sheet-context resolvers) + coerce (src/lib/services/values.ts)
  → identity (businessKey/lineKey) → DB match → classify NEW/CHANGED/UNCHANGED/CONFLICT/INVALID/DUPLICATE
  → ImportJob PREVIEW (payload JSON) → user confirm (resolutions/new/changed/deletions)
  → ONE transaction, per-row SAVEPOINTs (Postgres 25P02 guard); P2002 → rollback-to-savepoint, count race duplicate
  → delivery re-derive + audit + realtime import_applied
```

- Role-aware mapping: `getFieldMapForRole` — restricted columns unmapped for unauthorized roles (reported ignored, values never captured).
- `DERIVED_FIELD_KEYS` (liveStatus/trackingId/lastStatusUpdate): null from file ≠ change; re-derived on write.
- Limits enforced in code: 10 MB (`MAX_UPLOAD_BYTES`), 5,000 data rows (`import.ts:153`), ≤20 worksheets (`MAX_WORKSHEETS`, rejects above); exactly ONE detected sheet is imported per file.

## F. Future import direction (NOT IMPLEMENTED)

Multi-sheet header-based detection (SONIPAT MIX / LUCKNOW MIS / BANARAS MIS with misspelled names) is an ARCHITECTURAL DIRECTION only: inspect every worksheet, match on normalized header structure + aliases + anchor fields, validate samples, keep per-sheet formula context + source sheet/row, dedupe globally by businessKey+lineKey. Current `detectSheet` returns ONE sheet — do not claim otherwise.

## G. Quantity/units

- CURRENT: `totalQuantityLtrs Int?` + `bucket Int?`. Dashboard/reports/formulas assume integer liters (`totalQuantityLtrs`, `fmtQty` L-suffix). No unit/dimension columns exist in schema.
- FUTURE REQUIREMENT: model Quantity + Unit + Dimension (e.g. 12500+LTR+VOLUME, 8500+KG+MASS, 450+PCS+COUNT). Never sum incompatible units into one total without an explicit conversion. No supported-unit list exists in repo — do not invent one.

## H. Dashboard

- Route `src/app/api/dashboard/route.ts` (perm `dashboard:view`): IST day/month windows; counts, `SUM(totalQuantityLtrs)` + `SUM(bucket)`, loadType split, deliveryStatus groupBy folded through `normalizeStatus(raw, deliveryStatus.options)` (registry options `['Delivered','In Transit','Pending']` in `scripts/seed.ts:70`, `scripts/migrate-mis-field-registry.ts:50`), case-insensitive KPI lookup; POD Received/Received By NPL; on-time/delayed raw-SQL date compare; 45-day trend; pending detail `LOWER(TRIM(deliveryStatus)) IN ('pending','in transit')`; top destinations; vendor split; pendingByParty.
- View `src/components/dashboard/DashboardView.tsx`: donut from `statusBreakdown` (NOT hard-coded), `STATUS_COLORS` with canonical `'In Transit'` key + `#8A8580` fallback; KPI cards (Total Records, Total Quantity + buckets, Delivered, Pending+In Transit, FTL/PTL, POD %, Today/Month, On-time/Delayed, Parties Served, Not Yet Delivered). NPL/liters assumptions are current-state, not multi-client design.

## I. Reports

- Route `src/app/api/reports/route.ts` (perm `reports:view`, `?type=`): pending (raw SQL `deliveryStatus IN ('Pending','In transit')`, grouped Party→Destination→LR, ageDays), destination/vendor/party/material (Prisma groupBy, qty-desc). View `src/components/reports/ReportsView.tsx` tabs `pending|destination|vendor|party|material`, TanStack query per tab + refreshEpoch, client text filter.
- Export: COMMITTED behavior = `exportReport()` POSTs `/api/export` (full MIS workbook, `MIS_Report_<tab>.xlsx`). Five-sheet `Reports_and_Summaries.xlsx` is NOT implemented in committed code. Working tree has untracked `src/app/api/reports/export/route.ts` (464 lines) + anchor-GET change in ReportsView — UNVERIFIED: imports non-existent `@/lib/services/reports-query`, misuses `new Promise(SQL string)` as executor, imports client-format into a server route. Do not treat as working.

## J. Delivery status (two different things)

- `deliveryStatus` (MisRecord column + registry TEXT field): user-facing value from Excel/manual edits; canonical options Delivered/In Transit/Pending; normalized only for aggregation via `normalizeStatus` (exact→fuzzy, token-safe, negation-guarded, threshold 0.30).
- `liveStatus` (MisRecord column, NO registry entry in current seed/migrate scripts): internal derived status from `resolveLiveStatus` priority refusal→Returned→Cancelled→Delivered→In Transit→Pending (`src/lib/services/delivery.ts:12,39-72`); `computeDeliveryPatch` also maintains trackingId (`LR-<lrNo>` default) + lastStatusUpdate; `DELIVERY_SIGNAL_KEYS` trigger recompute; `syncAllDelivery` bulk job; APIs `/api/delivery/status` (lookup) + `/api/delivery/sync`; `deliverySummary()` groups by liveStatus. Historical `scripts/migrate-delivery-fields.ts` once registered liveStatus-family rows — current canonical registry does not. Never delete this machinery when hiding a column.

## K. Realtime

- Service `mini-services/realtime/index.ts` (own image, `bun.lock`): Socket.IO path `/`, public `REALTIME_PORT` 3003, admin `REALTIME_ADMIN_PORT` 3004 bound `REALTIME_ADMIN_BIND`; POST `/emit` requires `x-rt-secret` + JSON ≤64KB, broadcasts `mis-event`; GET `/health`. Prod fail-closed: exits without REALTIME_SECRET or REALTIME_ALLOWED_ORIGIN; dev reflects origin.
- Web emitter `src/lib/services/realtime.ts`: POST `${REALTIME_URL}` (default 127.0.0.1:3004), 2s abort, silent fail. Events: records_updated/created/deleted, import_applied, field_changed, user_changed, delivery_synced.
- Client `useRealtime` (`src/lib/client/hooks.ts:45-80`): URL from `/api/config` (REALTIME_PUBLIC_URL) else `/?XTransformPort=3003`; `mis-event` → handler. `Portal.tsx:43-75`: field_changed → schema toast + Reload (no auto-refresh); import_applied + records_* → toast + `requestRefresh()` → `refreshEpoch++` → MisGrid `refreshInfiniteCache()` + report/dashboard query refresh. No polling.

## L. Deployment

- Coolify: two apps — `web` (Dockerfile: Bun build → Node 22 standalone, entrypoint runs `prisma migrate deploy` unless `MIGRATE_ON_START=false`, healthcheck `/api/health`) + `realtime` (`mini-services/realtime/Dockerfile`, healthcheck `:3004/health`). Compose `docker-compose.coolify.yml`: internal `REALTIME_URL=http://realtime:3004`, shared `REALTIME_SECRET`, public `REALTIME_PUBLIC_URL`, external `coolify` network, web depends on healthy realtime. Local: `docker-compose.dev.yml` + `bun run setup:local` (tools→.env→stack→migrate→seed-if-empty). Prod compose `docker-compose.prod.local.yml` exists — verify before use. Backups: Coolify-scheduled → S3 (app has no S3 creds by design; see docs/aws-s3-backup.md). Preflight: `node scripts/preflight-prod.mjs`.
