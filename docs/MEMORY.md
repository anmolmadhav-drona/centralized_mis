# MEMORY (durable, high-signal)

- Source is truth: `git status` at writing showed `M ReportsView.tsx`, `M SettingsView.tsx` (dialog UI), `?? src/app/api/reports/export/`. Untracked export route is broken (bad import + Promise-executor bug) — five-sheet export is UNVERIFIED.
- `/api/fields` returns inactive rows on purpose (`getFieldsForRole(user.role, true)`); grid hides them (`gridColumns.ts:72-73`), Settings manages them. Don't “fix” the `true` without preserving Settings.
- `deliveryStatus` = user text/registry; `liveStatus` = derived DB column (no registry entry in current seed/migrate scripts). Delivery machinery (`delivery.ts`, sync/status APIs) must survive column-visibility changes.
- Identity: businessKey+lineKey UNIQUE; null businessKey exempt; P2002 = race → savepoint rollback, continue. Never fuzzy-match LR/Invoice/Party.
- Concurrency: version on every write; VERSION_CONFLICT → dialog. Import: one transaction + per-row savepoints (Postgres 25P02).
- Restricted fields: `table-access.ts` is the ONLY place to add one; UI+API+export follow automatically.
- Realtime: web fire-and-forget POST to realtime `:3004/emit`; client URL from `/api/config`; auto-refresh via `refreshEpoch`; schema changes need Reload. No polling, no page reload for data.
- Excel: parse SheetJS / write ExcelJS; single detected sheet (MIS preferred, ≥8 headers); SYS_RECORD_ID/VERSION drive round-trip; export writes values, never formulas. `excelGrid.ts` fill-handle is fragile — hands off.
- Quantity = integer liters + buckets today; never aggregate across future units without conversion.
- Env: prod fatals DATABASE_URL/AUTH_SECRET; realtime/SMTP degrade loudly. No S3 vars in app. Bun installs, Node 22 runs. `db:push` disabled.
- Validate with `bun run verify`; never commit/push unasked. Docs disagree with code → code wins; say so.
- Key paths: APIs `src/app/api/*/route.ts`; services `src/lib/services/*`; excel `src/lib/excel/*`; grid `src/components/mis/{MisGrid,MisView,gridColumns,excelGrid}`; field gate `src/lib/table-access.ts`; perms `src/lib/rbac.ts`; session `src/lib/auth.ts`; realtime svc `mini-services/realtime/index.ts`; schema `prisma/schema.prisma`.
