# RULES (must stay true — each with source)

### Server re-reads identity per request
RULE: Never trust role/status from the client; every API call re-loads the user and rejects inactive accounts.
WHY: Stale or forged sessions must lose access immediately.
SOURCE: `src/lib/auth.ts` getSessionUser; `src/lib/api.ts` requireUser/requirePermission.

### RBAC is server-enforced, UI is only a mirror
RULE: Every permission check exists in the API layer; frontend `can()` gating never grants access.
WHY: UI hiding is not security.
SOURCE: `src/lib/rbac.ts`, `src/lib/api.ts`, per-route `requirePermission(...)`.

### Restricted financial fields are invisible end-to-end for USER/VIEWER
RULE: vehicleRate, loadingCharges, unloadingCharges, rate, totalRate vanish from schema, values, writes, filters/sorts, and exports for unauthorized roles (403 on attempt).
WHY: Management-sensitive data must not leak via schema, oracle filters, or files.
SOURCE: `src/lib/table-access.ts` (filter/strip/assert); `src/app/api/export/route.ts:17`; import mapping in `src/lib/excel/import.ts`.

### Identity is exact, never fuzzy
RULE: businessKey = LR|Invoice|Party; lineKey = Material|Bucket|Qty; DB UNIQUE pair. Null businessKey = exempt. Comparisons are normalized-exact (case/space), never fuzzy.
WHY: Prevents phantom duplicates while allowing legitimate PTL multi-line shipments.
SOURCE: `src/lib/services/business-key.ts`; `prisma/schema.prisma` MisRecord; `src/lib/excel/import*.ts`.

### Optimistic concurrency on every write
RULE: PATCH/bulk carry `version`; stale writes fail VERSION_CONFLICT (dialog), never overwrite. Import races (P2002) roll back to the row savepoint and continue.
WHY: Concurrent editors/imports must not silently clobber each other.
SOURCE: `src/lib/services/records-mutations.ts`; `src/lib/excel/import-apply.ts:48-67`; `src/components/mis/ConflictDialog.tsx`.

### Delivery normalization is data-driven and negation-safe
RULE: Status folding uses live registry options via `normalizeStatus` (exact first, token-covered fuzzy ≤ threshold, negation tokens block). `Not Delivered` never becomes `Delivered`.
WHY: Typos collapse; meaning never does.
SOURCE: `src/lib/services/status-normalizer.ts`; `src/app/api/dashboard/route.ts:64-81`; registry options in `scripts/seed.ts:70`, `scripts/migrate-mis-field-registry.ts:50`.

### liveStatus is internal derivation, not a user column
RULE: `liveStatus` (DB column) is recomputed from signals on every write/sync; file nulls for derived keys are ignored, never nulled. Do not delete it because it is hidden in the grid.
WHY: Tracking, lookup, and sync depend on it.
SOURCE: `src/lib/services/delivery.ts` (LIVE_STATUSES, resolveLiveStatus, DERIVED_FIELD_KEYS, computeDeliveryPatch, syncAllDelivery); `/api/delivery/*`.

### Grid shows only active, Settings manages all
RULE: `buildColumnDefs` skips `isSystem` and `!active`; `/api/fields` returns inactive rows so Settings can reactivate. Inactive data is preserved, never deleted by deactivation.
WHY: Operators see a clean sheet; admins keep control.
SOURCE: `src/components/mis/gridColumns.ts:71-73`; `src/app/api/fields/route.ts:14`; `src/lib/services/fields.ts:20-29`.

### Preview-before-write + full audit
RULE: Imports write nothing until confirmed, in one transaction; every record/field/import/export/auth event is audit-logged with actor, source, IP, requestId.
WHY: Traceability and safe Excel round-trips (SYS_RECORD_ID/SYS_VERSION).
SOURCE: `src/lib/excel/import*.ts`; `src/lib/services/audit.ts`; `prisma/schema.prisma` AuditLog/ImportJob.

### Export writes values, never formulas
RULE: Exported cells contain calculated values only — formula text is never emitted.
WHY: Files must open correctly anywhere and re-import deterministically.
SOURCE: `src/lib/excel/export.ts` (formula branch).

### Realtime is fire-and-forget, never load-bearing
RULE: Emit failures never fail business ops; clients auto-refresh data events via `refreshEpoch` (no polling); schema changes require Reload, not silent merge.
WHY: Collaboration without coupling availability to the socket service.
SOURCE: `src/lib/services/realtime.ts`; `mini-services/realtime/index.ts`; `src/components/portal/Portal.tsx:43-75`.

### Quantities never mix incompatible units
RULE: Today only integer liters + bucket counts exist; do not sum across future units without an explicit conversion.
WHY: 10,000 LTR + 5,000 KG must never become 15,000.
SOURCE: `prisma/schema.prisma` (totalQuantityLtrs Int?, bucket Int?); `src/app/api/dashboard/route.ts`.
