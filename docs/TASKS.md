# TASKS (status verified against code; working tree noted)

## Completed / Verified (in HEAD unless noted)
- Auth.js v5 credentials + Argon2id/bcrypt-upgrade + 7-day JWT + per-request re-read + login rate limit — `src/lib/auth.ts`.
- RBAC + restricted financial fields end-to-end — `src/lib/rbac.ts`, `src/lib/table-access.ts`.
- Field registry + role/active filtering + grid hides inactive/system — `src/lib/services/fields.ts`, `src/app/api/fields/route.ts:14`, `src/components/mis/gridColumns.ts:71-73`.
- MIS grid (infinite rows, inline edit, versioning, conflicts, bulk, suggest, soft delete) — `src/components/mis/*`, `/api/records*`.
- Formula engine + bar + persistence + export-values-only — `src/lib/formula/*`, `src/components/mis/FormulaBar.tsx`.
- Single-sheet Excel import (preview→confirm, identity, savepoints, audit, realtime) — `src/lib/excel/import*.ts`, `/api/import/*`.
- Full MIS export (MIS + live Summary) — `src/lib/excel/export.ts`, POST `/api/export`.
- Delivery derivation/sync/lookup + status normalizer + dashboard canonical folding + canonical `'In Transit'` color — `src/lib/services/delivery.ts`, `status-normalizer.ts`, `/api/dashboard`, `/api/delivery/*`, `DashboardView.tsx:27-30`.
- Realtime service + auto grid refresh on data events — `mini-services/realtime`, `src/lib/services/realtime.ts`, `Portal.tsx:43-75`.
- Audit log + import jobs + password reset (hashed single-use tokens, anti-enumeration) — schema + routes.
- Coolify deployment (web + realtime apps, healthchecks, migrate-on-start, preflight) — `Dockerfile`, `docker-compose.coolify.yml`, `scripts/preflight-prod.mjs`.
- Registry options for deliveryStatus `['Delivered','In Transit','Pending']` — `scripts/seed.ts:70`, `scripts/migrate-mis-field-registry.ts:50` (committed).

## In Progress / Partially Implemented (working tree — UNVERIFIED)
- Five-sheet `Reports_and_Summaries.xlsx`: untracked `src/app/api/reports/export/route.ts` + modified `ReportsView.tsx` export handler. BLOCKED: route imports non-existent `@/lib/services/reports-query`, misuses `new Promise(SQL string)`, imports client-format into server route. Committed behavior remains full-MIS export. Fix + `bun run verify` required before relabeling.
- Settings `AddUserDialog` polish (uncommitted UI-only diff in `SettingsView.tsx`): no behavior change; safe to keep or revert.

## Pending (verified gaps)
- Reports export fix described above (make route reuse `/api/reports` semantics, ExcelJS workbook with exactly the 5 live sheets, GET download headers, frontend uses it regardless of active tab).

## Future Architecture (NOT implemented)
- Header-based multi-sheet import (inspect all sheets, alias/anchor matching, per-sheet formula context, global dedupe). Current `detectSheet` returns ONE sheet.
- Quantity + Unit + Dimension with unit-aware dashboard/reports; explicit conversions only.
- SSO (Entra ID) layering over current RBAC (role model already structured for it).
- Background import processing for larger files (job model already staged).
