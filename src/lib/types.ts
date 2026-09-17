// Shared types — NPL MIS Portal

export type Role = 'ADMIN' | 'MANAGER' | 'USER' | 'VIEWER'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}

export type FieldDataType =
  | 'TEXT'
  | 'LONG_TEXT'
  | 'INTEGER'
  | 'DECIMAL'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'DROPDOWN'

export interface FieldDef {
  id: string
  fieldKey: string
  fieldName: string // exact Excel header
  displayName: string
  dataType: FieldDataType
  required: boolean
  defaultValue: string | null
  options: string[] | null
  position: number
  isCore: boolean
  isSystem: boolean
  active: boolean
  width: number | null
}

/** A MIS record as consumed by the client: core + dynamic merged by fieldKey */
export interface MisRecordDto {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
  /** cell formulas on this record: fieldKey → formula text (starts with '=') */
  _formulas?: Record<string, string>
  /** formula evaluation errors: fieldKey → { code, message } */
  _formulaErrors?: Record<string, { code: string; message: string }>
  [fieldKey: string]: unknown
}

export interface RecordsResponse {
  rows: MisRecordDto[]
  total: number
}

/** Canonical sort item */
export interface SortItem {
  colId: string
  sort: 'asc' | 'desc'
}

/**
 * AG Grid filter model (subset we support), e.g.
 * { partyName: { filterType: 'text', type: 'contains', filter: 'Motors' } }
 * { lrDate: { filterType: 'date', type: 'inRange', dateFrom: '2026-08-01', dateTo: '2026-08-31' } }
 */
export type AgFilterModel = Record<string, Record<string, unknown>>

// ------------------------------------------------------------------
// Import analysis types
// ------------------------------------------------------------------
export type ImportRowKind = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'CONFLICT' | 'INVALID' | 'DUPLICATE'

export interface ImportFieldDiff {
  fieldKey: string
  fieldName: string
  oldValue: unknown
  newValue: unknown
}

export interface ImportRowAnalysis {
  rowIndex: number // Excel row number (1-based)
  kind: ImportRowKind
  recordId: string | null
  dbVersion: number | null
  fileVersion: number | null
  values: Record<string, unknown> // coerced file values by fieldKey
  formulas?: Record<string, string> // cell formulas captured from the file (by fieldKey)
  diffs: ImportFieldDiff[] // for CHANGED / CONFLICT
  dbValues: Record<string, unknown> | null // current DB values for CONFLICT
  changedBy: string | null
  changedAt: string | null
  errors: string[] // INVALID
  /** normalized "LR|Invoice|Party" composite — null when identity is incomplete */
  businessKey: string | null
  /** normalized "material|bucket|qty" line discriminator (PTL multi-line shipments) */
  lineKey: string | null
  /** DUPLICATE: Excel row number of the retained first occurrence */
  duplicateOfRow: number | null
  /** DUPLICATE: true when the duplicate row carries different values than the retained one */
  duplicateConflicting: boolean
  resolution?: 'mine' | 'theirs' // chosen for CONFLICT
}

export interface ImportPreview {
  jobId: string
  fileName: string
  stats: {
    detected: number
    new: number
    changed: number
    unchanged: number
    conflicts: number
    invalid: number
    missing: number
    /** rows skipped because the same business key + line appears earlier in the file */
    duplicates: number
  }
  rows: ImportRowAnalysis[]
  missing: Array<{ recordId: string; lrNo: number | null; partyName: string | null; destination: string | null }>
  warnings: string[]
}

/** A problematic row reported after apply — enough context to find it in the file. */
export interface ImportFailedRow {
  rowIndex: number
  lrNo: number | string | null
  invoiceNumber: string | null
  partyName: string | null
  reason: string
}

export interface ImportApplyResult {
  applied: number
  created: number
  updated: number
  /** rows whose importable values already matched the database — no write performed */
  unchanged: number
  deleted: number
  skipped: number
  /** in-file duplicates + concurrent-import duplicates — no second record created */
  duplicates: number
  /** row-level write failures (validation / concurrency / identity guard) */
  failed: number
  failedRows: ImportFailedRow[]
  conflictsResolvedMine: number
  conflictsResolvedTheirs: number
}

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
export interface DashboardData {
  totalRecords: number
  totalQuantityLtrs: number
  totalBuckets: number
  deliveredCount: number
  deliveredQty: number
  pendingCount: number
  pendingQty: number
  inTransitCount: number
  ftlCount: number
  ptlCount: number
  todayEntries: number
  monthEntries: number
  podReceivedCount: number
  onTimeCount: number
  delayedCount: number
  undeliveredCount: number
  statusBreakdown: Array<{ status: string; count: number; qty: number }>
  podBreakdown: Array<{ status: string; count: number }>
  dailyTrend: Array<{ date: string; qty: number; count: number }>
  topDestinations: Array<{ destination: string; qty: number; count: number }>
  vendorBreakdown: Array<{ vendor: string; qty: number; count: number }>
  pendingByParty: Array<{ party: string; destination: string; lrNo: number; qty: number; ageDays: number; expected: string | null }>
}
