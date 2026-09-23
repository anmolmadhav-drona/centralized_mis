// Column definitions — generated from the field registry (never hard-coded)
import { createElement } from 'react'
import type { ColDef, GridApi } from 'ag-grid-community'
import type { FieldDef, MisRecordDto } from '@/lib/types'
import { fmtDate, fmtNum, deliveryStatusTone, podStatusTone, loadTypeTone } from '@/lib/client/format'

/** true when a raw editor string is a formula ("=Bucket*3") */
export function isFormulaText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().startsWith('=')
}

/** Fields whose cells accept Excel-style formulas */
const FORMULA_CAPABLE = new Set(['TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL'])

/** formula metadata carried on the record DTO */
function formulaMeta(data: unknown, fieldKey: string): { formula?: string; error?: { code: string; message: string } } {
  const dto = data as MisRecordDto | undefined
  return { formula: dto?._formulas?.[fieldKey], error: dto?._formulaErrors?.[fieldKey] }
}

/** Fields rendered as colored status badges */
const BADGE_FIELDS: Record<string, (v: unknown) => string> = {
  deliveryStatus: deliveryStatusTone,
  podStatus: podStatusTone,
  loadType: loadTypeTone,
}

/** Integer fields that are identifiers — displayed without comma grouping */
const NO_GROUPING = new Set(['lrNo', 'vehicleType', 'ply'])

/**
 * Badge cell renderer — a REACT FUNCTION COMPONENT (AG Grid React passes the
 * cell params as props). Returns React elements built with createElement so
 * this stays a .ts file.
 *
 * Why not a plain function returning a string? AG Grid React v33+ feeds the
 * renderer's return value into React's tree: strings are inserted as ESCAPED
 * TEXT (the old `'<span class="badge-tone …">…</span>'` pattern showed raw
 * HTML source in every status cell).
 * Why not a DOM element? DOM nodes are not valid React children — React
 * error #31 unmounts the whole app the moment such a cell renders.
 */
function BadgeCellRenderer(props: { value?: unknown; colDef?: { field?: string } }) {
  const v = props.value
  if (v == null || v === '') {
    return createElement('span', { className: 'text-muted-foreground/40' }, '—')
  }
  const tone = BADGE_FIELDS[props.colDef?.field || '']?.(v) || 'default'
  return createElement('span', { className: `badge-tone badge-${tone}` }, String(v))
}

export function buildColumnDefs(fields: FieldDef[], opts: { canEdit: boolean }): ColDef[] {
  const cols: ColDef[] = []

  // row number column (replaces the Excel SR. NO. sequence)
  cols.push({
    colId: 'srNo',
    headerName: 'Sr. No.',
    valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
    width: 76,
    minWidth: 60,
    pinned: 'left',
    sortable: false,
    filter: false,
    editable: false,
    suppressMovable: true,
    cellClass: 'text-muted-foreground tabular-nums',
    headerClass: 'text-center',
  })

  for (const field of fields) {
    if (field.isSystem) continue
    if (!field.active) continue
    const col: ColDef = {
      colId: field.fieldKey,
      field: field.fieldKey,
      headerName: field.displayName,
      headerTooltip: field.fieldName, // exact Excel header on hover
      editable: opts.canEdit && isInlineEditable(field),
      sortable: true,
      resizable: true,
      minWidth: 90,
      width: colWidth(field),
      filter: filterFor(field),
      floatingFilter: true,
      filterParams: filterParamsFor(field),
      cellClass: [],
    }

    switch (field.dataType) {
      case 'INTEGER':
      case 'DECIMAL':
        col.cellClass = ['text-right', 'tabular-nums']
        // text editor (not the number editor) so users can type =Bucket*3
        col.cellEditor = 'agTextCellEditor'
        col.valueParser = (p) => {
          if (isFormulaText(p.newValue)) return String(p.newValue).trim() // routed to the formula engine on save
          const raw = p.newValue
          if (raw == null || String(raw).trim() === '') return null
          const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''))
          return Number.isFinite(n) ? n : String(raw).trim() // invalid text → server returns a clear error
        }
        col.valueFormatter = (p) => {
          const meta = formulaMeta(p.data, field.fieldKey)
          if (meta.error) return meta.error.code // #REF! / #DIV/0! / #CYCLE! …
          const v = p.data?.[field.fieldKey]
          if (v == null || v === '') return '—'
          return NO_GROUPING.has(field.fieldKey) ? String(v) : fmtNum(v)
        }
        break
      case 'DATE':
      case 'DATETIME':
        col.valueFormatter = (p) => (p.value ? fmtDate(p.value) : '—')
        col.cellClass = ['text-center']
        // The floating filter renders a native <input type="date"> (mm/dd/yyyy +
        // picker icon ≈ 125px). Narrower columns clip it to illegibility
        // (lrDate was 115px → 67px input showing just "mm").
        col.minWidth = 180
        col.width = Math.max(colWidth(field), 180)
        break
      case 'DROPDOWN':
        col.cellEditor = 'agTextCellEditor'
        if (BADGE_FIELDS[field.fieldKey]) {
          col.cellRenderer = BadgeCellRenderer
        }
        break
      case 'BOOLEAN':
        col.valueFormatter = (p) => (p.value == null ? '—' : p.value === true || p.value === 'true' ? 'Yes' : 'No')
        col.cellEditor = 'agSelectCellEditor'
        col.cellEditorParams = { values: ['true', 'false'] }
        break
      case 'LONG_TEXT':
        col.cellEditor = 'agLargeTextCellEditor'
        col.cellEditorParams = { rows: 4, maxLength: 2000 }
        col.tooltipField = field.fieldKey
        break
      default:
        col.cellEditor = 'agTextCellEditor'
        break
    }

    // ---- Excel formula wiring (TEXT / LONG_TEXT / INTEGER / DECIMAL) ----
    // NOTE: no valueGetter here by design — AG Grid v36's edit model commits
    // the getter output instead of the editor's typed value whenever the two
    // diverge (formula text vs computed number), silently reverting edits.
    // The formula bar (above the grid) is the formula-editing surface; typing
    // "=Bucket*3" in a cell still creates/replaces the formula via valueParser.
    if (FORMULA_CAPABLE.has(field.dataType)) {
      col.cellClassRules = {
        'mis-formula-cell': (p) => !!formulaMeta(p.data, field.fieldKey).formula,
        'mis-cell-error': (p) => !!formulaMeta(p.data, field.fieldKey).error,
      }
      col.tooltipValueGetter = (p) => formulaMeta(p.data, field.fieldKey).error?.message ?? null
      if (field.dataType === 'TEXT' || field.dataType === 'LONG_TEXT') {
        col.valueFormatter = (p) => {
          const meta = formulaMeta(p.data, field.fieldKey)
          if (meta.error) return meta.error.code
          const v = p.data?.[field.fieldKey]
          return v == null || v === '' ? '' : String(v)
        }
      }
    }

    // sensible pins
    if (field.fieldKey === 'lrNo') {
      col.pinned = 'left'
      col.cellClass = [...(Array.isArray(col.cellClass) ? col.cellClass : []), 'font-medium']
    }
    if (field.fieldKey === 'partyName') col.minWidth = 220

    cols.push(col)
  }

  // trailing metadata: version + updated info (compact, gray)
  cols.push({
    colId: 'updatedAt',
    field: 'updatedAt',
    headerName: 'Last Updated',
    width: 150,
    valueFormatter: (p) => (p.value ? `${new Date(p.value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${new Date(p.value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '—'),
    cellClass: ['text-muted-foreground', 'text-xs'],
    editable: false,
    filter: 'agTextColumnFilter',
    floatingFilter: false,
  })
  cols.push({
    colId: 'updatedBy',
    field: 'updatedBy',
    headerName: 'Updated By',
    width: 130,
    cellClass: ['text-muted-foreground', 'text-xs'],
    editable: false,
    filter: 'agTextColumnFilter',
    floatingFilter: false,
  })

  return cols
}

function isInlineEditable(field: FieldDef): boolean {
  return ['TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL', 'DROPDOWN', 'BOOLEAN'].includes(field.dataType)
}

function filterFor(field: FieldDef): string {
  switch (field.dataType) {
    case 'INTEGER':
    case 'DECIMAL':
      return 'agNumberColumnFilter'
    case 'DATE':
    case 'DATETIME':
      return 'agDateColumnFilter'
    default:
      return 'agTextColumnFilter'
  }
}

function filterParamsFor(field: FieldDef): Record<string, unknown> {
  if (field.dataType === 'DATE' || field.dataType === 'DATETIME') {
    return { comparator: undefined, maxValidYear: 2100 }
  }
  if (field.dataType === 'DROPDOWN') {
    return {
      filterOptions: ['equals', 'notEqual', 'contains', 'blank', 'notBlank'],
      defaultOption: 'equals',
    }
  }
  return { filterOptions: ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith', 'blank', 'notBlank'] }
}

function colWidth(field: FieldDef): number {
  const base = field.width || 18
  return Math.min(64, Math.max(10, base)) * 8.43 > 0 ? Math.round(Math.min(340, Math.max(110, base * 8.43))) : 150
}

/** Serialize AG Grid filterModel into human-readable chips */
export function filterChips(filterModel: Record<string, Record<string, unknown>>, fields: FieldDef[]): Array<{ key: string; label: string; value: string }> {
  const chips: Array<{ key: string; label: string; value: string }> = []
  const nameOf = (key: string) => fields.find((f) => f.fieldKey === key)?.displayName || key
  for (const [key, model] of Object.entries(filterModel || {})) {
    if (!model || typeof model !== 'object') continue
    const conditions = Array.isArray(model.conditions) ? (model.conditions as Array<Record<string, unknown>>) : [model]
    for (const c of conditions) {
      const type = String(c.type || 'contains')
      let value = ''
      if (c.filterType === 'date') {
        const from = String(c.dateFrom || '').slice(0, 10)
        const to = c.dateTo ? String(c.dateTo).slice(0, 10) : null
        value = to ? `${fmtDate(from)} → ${fmtDate(to)}` : `${type} ${fmtDate(from)}`
        if (type === 'inRange' && to) value = `${fmtDate(from)} → ${fmtDate(to)}`
      } else if (c.filterType === 'number') {
        value = type === 'inRange' ? `${fmtNum(c.filter)} → ${fmtNum(c.filterTo)}` : `${type.replace(/([A-Z])/g, ' $1').toLowerCase()} ${fmtNum(c.filter)}`
      } else {
        value = String(c.filter ?? '')
      }
      if (!value) continue
      chips.push({ key, label: nameOf(key), value })
    }
  }
  return chips
}

export type { GridApi }
