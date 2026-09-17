// Centralized management-sensitive table access — single source of truth.
//
// The Centralized MIS is a field-registry-driven application: every
// "table/option" the business thinks of (Vehicle Rate, Loading Charges, …)
// is a field in the registry powering the grid, forms, filters, Excel
// import/export and the APIs. Restricting a table therefore means restricting
// its field(s) — at the UI level (field list never returned) AND at the
// server level (values stripped from responses, writes rejected with 403).
//
// Every enforcement point imports from HERE — no scattered
// `if (role === 'ADMIN' || role === 'MANAGER')` checks in components.
// Extending later (e.g. Unloading Charges, Transport Charges, Financial
// Reports, Profit/Margin) is ONE entry below; UI + API enforcement follows
// automatically.
//
//   ── table registry (conceptual) ──────────────────────────────
//   id            fieldKey    — stable registry key (the table's id/slug)
//   name          tableName   — business name shown to humans
//   excelHeaders  headers     — the Excel headers that map onto this table
//   route         view        — where the data surfaces (Centralized MIS)
//   permission    (implicit)  — existing RBAC permissions still apply first
//   allowedRoles  allowedRoles— roles that may SEE and WRITE the table
//   ──────────────────────────────────────────────────────────────
import { ApiError } from '@/lib/api'
import type { Role } from '@/lib/types'

export interface RestrictedTable {
  /** Stable field-registry key — the table's id. */
  fieldKey: string
  /** Business name of the table/option (used in 403 messages). */
  tableName: string
  /** Excel headers that map onto this table. */
  excelHeaders: string[]
  /** Where this table's data surfaces. */
  view: 'Centralized MIS'
  /** Roles allowed to see AND write this table. Others get nothing: no
   *  schema, no values, no counts — the table simply does not exist. */
  allowedRoles: readonly Role[]
  /** Operator-facing rationale (audit-friendly). */
  reason: string
}

/** Management-sensitive Centralized MIS tables. ADMIN and MANAGER only. */
export const RESTRICTED_TABLES: readonly RestrictedTable[] = [
  {
    fieldKey: 'vehicleRate',
    tableName: 'Vehicle Rate',
    excelHeaders: ['Vehicle Rate'],
    view: 'Centralized MIS',
    allowedRoles: ['ADMIN', 'MANAGER'],
    reason: 'Vendor vehicle rates are management-sensitive financial data.',
  },
  {
    fieldKey: 'loadingCharges',
    tableName: 'Loading Charges',
    excelHeaders: ['LOADING CHARGES'],
    view: 'Centralized MIS',
    allowedRoles: ['ADMIN', 'MANAGER'],
    reason: 'Loading charges are management-sensitive financial data.',
  },
]

const BY_FIELD_KEY = new Map(RESTRICTED_TABLES.map((t) => [t.fieldKey, t]))

/** May this role SEE this table/field anywhere (grid, form, API, export)? */
export function tableVisibleTo(fieldKey: string, role: Role | null | undefined): boolean {
  const t = BY_FIELD_KEY.get(fieldKey)
  if (!t) return true // not a restricted table
  if (!role) return false // no session → nothing restricted is visible
  return t.allowedRoles.includes(role)
}

/** All restricted field keys (regardless of role). */
export function restrictedFieldKeys(): string[] {
  return RESTRICTED_TABLES.map((t) => t.fieldKey)
}

/** Is this fieldKey a restricted table at all (role-independent)? */
export function isRestrictedField(fieldKey: string): boolean {
  return BY_FIELD_KEY.has(fieldKey)
}

/** Filter a field list down to what the role may see (UI + /api/fields). */
export function filterFieldsForRole<T extends { fieldKey: string }>(fields: T[], role: Role | null | undefined): T[] {
  const restricted = restrictedFieldKeys()
  if (restricted.length === 0) return fields
  return fields.filter((f) => !restricted.includes(f.fieldKey) || tableVisibleTo(f.fieldKey, role))
}

/** Restricted field keys present in a values payload this role may NOT write. */
export function restrictedKeysIn(keys: Iterable<string>, role: Role | null | undefined): string[] {
  const out: string[] = []
  for (const k of keys) {
    if (BY_FIELD_KEY.has(k) && !tableVisibleTo(k, role)) out.push(k)
  }
  return out
}

/**
 * Server-side write guard — throws 403 Forbidden when a role that cannot see
 * a restricted table attempts to write it (portal form, bulk paste, API).
 * Authenticated-but-unauthorized: exactly the contract of PART 12.
 */
export function assertFieldsWritable(keys: Iterable<string>, role: Role | null | undefined): void {
  const banned = restrictedKeysIn(keys, role)
  if (banned.length === 0) return
  const names = banned
    .map((k) => BY_FIELD_KEY.get(k)?.tableName ?? k)
    .join(', ')
  throw new ApiError(403, `You do not have permission to modify ${names}.`)
}

/**
 * Server-side query guard — throws 403 when a role that cannot see a
 * restricted table filters or sorts on it (a filter/sort model referencing a
 * hidden column would otherwise act as a value oracle through row selection).
 */
export function assertQueryModelAllowed(
  filterModel: Record<string, unknown> | undefined,
  sortModel: Array<{ colId?: string }> | undefined,
  role: Role | null | undefined,
): void {
  const keys: string[] = [
    ...Object.keys(filterModel || {}),
    ...(sortModel || []).map((s) => s.colId ?? '').filter(Boolean),
  ]
  assertFieldsWritable(keys, role)
}

/** In-place removal of restricted values from a record DTO (read paths). */
export function stripRestrictedFields<T extends Record<string, unknown>>(dto: T, role: Role | null | undefined): T {
  for (const k of restrictedFieldKeys()) {
    if (!tableVisibleTo(k, role)) delete dto[k]
  }
  return dto
}

/** In-place removal of restricted values from many record DTOs. */
export function stripRestrictedFieldsFromRows<T extends Record<string, unknown>>(rows: T[], role: Role | null | undefined): T[] {
  for (const r of rows) stripRestrictedFields(r, role)
  return rows
}
