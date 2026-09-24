# DESIGN (actual UI, verified)

## Shell & navigation
- `src/components/portal/Portal.tsx`: session gate (LoginView ⇄ AppShell), realtime toasts + notification feed, Ctrl+Shift+C calculator. Views via zustand `view`: dashboard | mis | reports | excel | audit | settings (`src/lib/client/store.ts`).
- `src/components/portal/AppShell.tsx`: sidebar + header (search, notification bell max 30, user menu) + view container. Mobile nav + collapsible sidebar in store.
- Brand: `src/components/brand/DronaLogo.tsx` (full logo, glow, route loader/divider). Gold route dividers separate control-center sections.

## Design system
- shadcn/ui primitives in `src/components/ui/*` (button, dialog, table, tabs, select, popover, calendar, badge, skeleton, sonner/toaster, etc.), Tailwind v4, dark mode via `next-themes` (`agLightTheme`/`agDarkTheme` in `src/components/mis/gridTheme.ts`). Icons `lucide-react`; motion `framer-motion` (subtle card entrances, AnimatedNumber counters on dashboard).
- Status badges: `badge-tone badge-<tone>` spans with text always present (color never the only signal). Tones from `src/lib/client/format.ts` (deliveryStatusTone, podStatusTone, loadTypeTone).
- Feedback: `sonner` toasts (success/warn/error/info with descriptions + occasional actions like Reload); skeletons while loading; empty states (“Nothing pending — everything is delivered”); filter chips with removable X; save-state pill in MIS toolbar (Saving…/Saved/Unable to save).

## Screens
- Dashboard (`src/components/dashboard/DashboardView.tsx`): banner + 2 KPI rows + dispatch-trend area chart + Delivery Status donut + top-destinations bars + outstanding list. Tooltips custom; counts animate once via rAF.
- MIS (`src/components/mis/MisView.tsx` + `MisGrid.tsx`): context strip (“Single source of truth”), toolbar (search w/ 350ms debounce, structured filters popover, columns menu, save pill, edit/delete, export w/ Summary toggle, Add Entry), filter chips, FormulaBar, AG Grid (infinite rows, floating filters, pinned lrNo, persisted col state), footer status (totals, selection, range hints). Dialogs: RecordFormDialog (sectioned: shipment/consignee/charges/delivery/billing/remarks + suggest-as-you-type + formula support), ConflictDialog (current vs attempted), delete confirm.
- Reports (`src/components/reports/ReportsView.tsx`): 5 tabs (Pending Deliveries, Destination-wise, Vendor/Route, Party-wise, Material-wise), text filter, Export Excel button, sticky headers, age-highlighted pending rows.
- Excel (`src/components/excel/ImportWizard.tsx`, `ImportExportView.tsx`): upload → preview tables by kind (new/changed/conflict/invalid/duplicate) with resolutions → confirm; export history.
- Settings (`src/components/settings/SettingsView.tsx`): MIS Fields table (core vs custom sections, inactive rows dimmed + badge, add/edit dialog with Active switch) + Users & Roles table (role select, enable/disable, reset password; Add user dialog).
- Audit (`src/components/audit/AuditView.tsx`): filterable event table. Calculator (`src/components/calculator/Calculator.tsx`): global overlay.
- Login (`src/components/portal/LoginView.tsx`): credentials form; demo quick-login only when `NEXT_PUBLIC_DEMO_LOGIN=1` (sandbox builds only — never production).

## Conventions for operators (non-technical users)
Plain-language labels, helper text under tricky fields, confirm-before-destroy dialogs, “data preserved when deactivated” copy, Excel-hint footer (fill, Ctrl+D, Ctrl+Z, =Bucket*3), IST dates, en-IN number grouping.
