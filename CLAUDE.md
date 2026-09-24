# Centralized MIS — Claude Code Entry Point

Production MIS portal for Drona Logitech (NPL logistics): shipment records (LR/invoice/party/material/delivery status), Excel-first import/export, delivery tracking, dashboard, reports, realtime collaboration, RBAC, audit.

Stack: Next.js 16 App Router (standalone) + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui + AG Grid 36 + TanStack Query v5 + zustand v5 + Auth.js v5 (NextAuth) + Prisma 6 + PostgreSQL + Socket.IO (separate service) + SheetJS (parse) + ExcelJS (export) + recharts. Package manager Bun (bun.lock); runtime Node ≥22.

## How to work here (token-efficient)

1. Read this file, then only the docs/*.md file(s) relevant to the task.
2. Locate the 1–3 source files for the change (paths in docs/ARCHITECTURE.md). Source code is the final authority — verify every assumption against it.
3. Make the smallest safe change. No unrelated refactors. No app-code changes just for exploration.
4. Validate: `bun run verify` (tsc + eslint + unit + production build). Never commit/push unless explicitly asked.

Do NOT waste tokens by: scanning node_modules/.next/.git, reading all of src/, or re-deriving what docs already state. If docs and code disagree, trust code and say so.

## Docs map

- docs/PRD.md — what the product does, roles, modules, current vs future.
- docs/ARCHITECTURE.md — system/data flows with real file paths (read this before touching APIs/services/grid/import/export/realtime).
- docs/RULES.md — inviolable business/engineering rules (RBAC, identity, concurrency, normalization, audit). Check before changing behavior.
- docs/DESIGN.md — UI shell, screens, conventions. Check before changing UI.
- docs/TASKS.md — verified roadmap: completed vs pending vs future. Do not relabel items without code proof.
- docs/MEMORY.md — durable pitfalls and decisions. Read before touching grid/import/formulas/realtime/delivery-status.

Existing operational docs (deployment, duplicates, local dev) live alongside in docs/: `coolify-deployment.md`, `duplicate-system.md`, `local-development.md`, `aws-s3-backup.md`, `backup-restore.md`, `production-checklist.md`.

## Critical do-not-break list

- Auth: server re-reads user per request (`src/lib/auth.ts` getSessionUser); inactive users rejected at sign-in AND per request. Role claims from client are never trusted.
- RBAC: `src/lib/rbac.ts` + `src/lib/table-access.ts`. Restricted financial fields (vehicleRate, loadingCharges, unloadingCharges, rate, totalRate) are ADMIN/MANAGER-only at UI + API + export. UI hiding is not security.
- Identity: `businessKey` (LR|Invoice|Party) + `lineKey` (Material|Bucket|Qty), UNIQUE pair (`src/lib/services/business-key.ts`). Null businessKey = exempt. Never fuzzy-match identity.
- Concurrency: `MisRecord.version` optimistic locking; PATCH needs version; conflicts → VERSION_CONFLICT → ConflictDialog. Import uses per-row savepoints; P2002 = race, rollback to savepoint, continue.
- Delivery status: `deliveryStatus` = user-facing registry field; `liveStatus` = internal derived DB column (`src/lib/services/delivery.ts`). Never delete internal delivery machinery because a field is hidden.
- Grid filtering: `buildColumnDefs` (`src/components/mis/gridColumns.ts`) skips `isSystem` and `!active`. `/api/fields` intentionally returns inactive rows (`getFieldsForRole(user.role, true)`) so Settings can manage them.
- Excel fill-handle/auto-scroll (`src/components/mis/excelGrid.ts`): do not touch unless the task proves it is required.
- Realtime: separate service (`mini-services/realtime`). Web emits fire-and-forget; client auto-refreshes grid on data events via `refreshEpoch`. No polling.
- Quantity today = integer liters (`totalQuantityLtrs`) + `bucket` count. Never sum incompatible units (see docs/ARCHITECTURE.md §G).
- Reports export: committed code exports the full MIS workbook via POST /api/export. Five-sheet reports workbook is NOT implemented in committed code.

## Working-tree note (verify before trusting)

`git status --short` at time of writing showed uncommitted work: `M src/components/reports/ReportsView.tsx`, `M src/components/settings/SettingsView.tsx` (dialog UI only), `?? src/app/api/reports/export/`. The untracked reports-export route imports a non-existent module and has an executor bug — treat five-sheet export as UNVERIFIED until fixed and `bun run verify` passes on a clean tree.
