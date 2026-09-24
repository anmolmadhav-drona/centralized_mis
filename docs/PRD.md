# PRD — Centralized MIS (verified)

## Purpose
Single connected workspace for Drona Logitech (NPL logistics) shipment data: replace stale spreadsheet copies with one live database that stays Excel-compatible.

## Business problem
Operational truth lived in emailed workbooks (filter-hidden rows, stale pivot caches, casing/typo variants, concurrent edits, no audit). The portal keeps Excel as the I/O format while the database becomes the system of record.

## Users & roles (IMPLEMENTED — `src/lib/rbac.ts`)
- ADMIN: full access (users, fields, records, import/export, dashboard, reports, audit, settings). `can()` short-circuits true.
- MANAGER: records CRUD, import/export, dashboard, reports, view fields/settings.
- USER (Operator): view/create/edit records, import/export, view fields.
- VIEWER: read-only view + export + view fields.
- Inactive users: rejected at login AND per request (`src/lib/auth.ts`).

## Modules (IMPLEMENTED)
- MIS sheet: AG Grid, server-side paging/filter/sort, inline edit, formulas, add/edit dialog, conflicts, column visibility, bulk delete. (`src/components/mis/MisGrid.tsx`, `MisView.tsx`)
- Excel import: upload → parse → preview (new/changed/conflict/invalid/duplicate) → confirm → transactional apply + audit + realtime. (`src/components/excel/ImportWizard.tsx`, `src/lib/excel/import*.ts`)
- Excel export: full MIS workbook (MIS + live Summary sheets) via POST /api/export. (`src/lib/excel/export.ts`)
- Delivery tracking: derived live status + trackingId + lastStatusUpdate, sync job, lookup API. (`src/lib/services/delivery.ts`, `/api/delivery/*`)
- Dashboard: live KPIs + trend + status donut + destinations + outstanding list. (`src/components/dashboard/DashboardView.tsx`, `/api/dashboard`)
- Reports: 5 live tabs (pending, destination, vendor, party, material). (`src/components/reports/ReportsView.tsx`, `/api/reports`)
- Settings: MIS field registry manager + user management. (`src/components/settings/SettingsView.tsx`, `/api/fields`, `/api/users`)
- Audit log: record/field/import/export/auth events with request correlation. (`src/components/audit/AuditView.tsx`, `/api/audit`)
- Realtime: toasts + notification feed + auto grid refresh on data events. (`src/components/portal/Portal.tsx`, `mini-services/realtime`)

## Core workflows
1. Excel in: upload workbook → preview diffs/duplicates → resolve conflicts → confirm → records versioned, audited, broadcast.
2. Daily ops: search/filter grid → inline edit or dialog → version guard → audit + realtime.
3. Oversight: dashboard/reports → export → decisions. Restricted financial fields never reach unauthorized roles at any layer.

## Operational goals
No silent data loss (preview-before-write, soft delete, audit); no phantom duplicates (businessKey+lineKey + DB UNIQUE + race savepoints); no stale numbers (live aggregations, no cached pivots); every privileged action attributable (audit + realtime by-user).

## Current limitations (IMPLEMENTED constraints)
- Import processes exactly ONE detected worksheet per file (prefers `MIS`, else first sheet with ≥8 known headers); >20 sheets rejected.
- Quantity = integer liters + bucket count only; no unit dimension.
- Reports export (committed) = full MIS workbook, not a five-sheet reports workbook.
- Realtime needs correctly wired REALTIME_* env or events silently drop (loud log in prod).

## Future (PLANNED, not implemented — see TASKS)
- Header-based multi-sheet import (SONIPAT MIX / LUCKNOW MIS / BANARAS MIS).
- Quantity + Unit + Dimension with unit-aware aggregation.
- One-workbook five-sheet Reports & Summaries export.
