// Records query engine — server-side search / filter / sort / pagination
// over core columns AND dynamic EAV fields, via parameterized raw SQL.
//
// SAFETY: every column name comes from the DB-backed field registry
// (validated via CORE_COLUMNS whitelist); every value is a bound parameter.
// This is SQL-injection safe by construction. Portable SQLite ↔ PostgreSQL
// (Date parameters are bound as proper temporal values by Prisma in both).
import { db, rawQuery } from '@/lib/db'
import type { AgFilterModel, FieldDef, MisRecordDto, SortItem } from '@/lib/types'
import { getFieldMap, sqlColumnFor, TYPE_TRAITS } from '@/lib/services/fields'
import { serializeValue, type StoredValue } from '@/lib/services/values'

export interface FormulaMeta {
  formula: string
  error?: { code: string; message: string }
}

/** Attach MisFormula rows to DTOs as `_formulas` / `_formulaErrors`. */
async function attachFormulas(recordIds: string[], dtos: MisRecordDto[]): Promise<void> {
  if (recordIds.length === 0) return
  const rows = await db.misFormula.findMany({ where: { recordId: { in: recordIds } } })
  if (rows.length === 0) return
  const byRecord = new Map<string, typeof rows>()
  for (const f of rows) {
    const list = byRecord.get(f.recordId) ?? []
    list.push(f)
    byRecord.set(f.recordId, list)
  }
  for (const dto of dtos) {
    const list = byRecord.get(dto.id)
    if (!list) continue
    const formulas: Record<string, string> = {}
    const errors: Record<string, { code: string; message: string }> = {}
    for (const f of list) {
      formulas[f.fieldKey] = f.formula
      try {
        const cached = f.cachedValue ? JSON.parse(f.cachedValue) : null
        if (cached && cached.ok === false && cached.e) errors[f.fieldKey] = cached.e
      } catch { /* ignore corrupt cache */ }
    }
    dto._formulas = formulas
    if (Object.keys(errors).length > 0) dto._formulaErrors = errors
  }
}

export interface ListParams {
  start: number
  end: number
  search?: string
  filterModel?: AgFilterModel
  sortModel?: SortItem[]
}

interface SqlPart {
  sql: string
  params: unknown[]
}

const CORE_SELECT_COLS = [
  'id', 'version', 'pickupLocation', 'partyName', 'destination', 'invoiceNumber',
  'lrNo', 'lrDate', 'routeCode', 'materialDetails', 'transporterName', 'bucket',
  'totalQuantity', 'measurement', 'loadType', 'expectedDeliveryDate', 'actualDeliveryDate',
  'deliveryStatus', 'trackingId', 'liveStatus', 'lastStatusUpdate', 'lrStatus', 'damage',
  'loadingCharges', 'unloadingCharges',
  'vehicleNumber', 'vehicleType', 'ply', 'remark', 'remarks1', 'dispatchDate',
  'dispatchFrom', 'dispatchVehicle', 'vendorName', 'vehicleRate', 'podStatus',
  'km', 'rate', 'totalRate', 'routeCode2',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
] as const

const DATE_KEYS = new Set(['createdAt', 'updatedAt'])
const DATE_FIELD_KEYS = new Set(['lrDate', 'expectedDeliveryDate', 'actualDeliveryDate', 'dispatchDate', 'lastStatusUpdate'])

/** Escape LIKE wildcards in user input */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/**
 * Portable case-insensitive LIKE left-hand side.
 * SQLite LIKE is ASCII-case-insensitive by default; PostgreSQL LIKE is
 * case-sensitive — LOWER() on both sides keeps the grid UX identical on
 * PostgreSQL. Non-text columns are CAST to text (SQLite tolerated implicit
 * casts; PostgreSQL does not).
 */
function likeLhs(expr: string, isText: boolean): string {
  return isText ? `LOWER(${expr})` : `CAST(${expr} AS TEXT)`
}

/** Bound LIKE pattern (lowercased — matches the LOWER() left-hand side). */
function likePatternOf(pattern: string): string {
  return pattern.toLowerCase()
}

function parseGridDate(v: unknown): Date | null {
  if (v == null) return null
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
}

/**
 * Build a condition for one field. Core fields reference the record column
 * directly; dynamic fields become EXISTS subqueries on the EAV tables.
 */
function fieldCondition(field: FieldDef, op: string, value: unknown, value2?: unknown): SqlPart | null {
  const col = sqlColumnFor(field)
  const t = TYPE_TRAITS[field.dataType]

  // ---------- dynamic (EAV) ----------
  if (!col) {
    const valueCol = t.numeric ? 'v."valueNumber"' : t.date ? 'v."valueDate"' : t.boolean ? 'v."valueBool"' : 'v."valueText"'
    const ex = `EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND `
    const nex = `NOT EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND ${valueCol} IS NOT NULL AND ${valueCol} != `
    const nexLike = `NOT EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND ${valueCol} IS NOT NULL AND `
    switch (op) {
      case 'blank':
        return { sql: `NOT EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND ${valueCol} IS NOT NULL)`, params: [field.fieldKey] }
      case 'notBlank':
        return { sql: `EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND ${valueCol} IS NOT NULL)`, params: [field.fieldKey] }
      case 'contains':
        return { sql: `${ex}${likeLhs(valueCol, t.text)} LIKE ? ESCAPE '\\')`, params: [field.fieldKey, likePatternOf(`%${likeEscape(String(value))}%`)] }
      case 'notContains':
        return { sql: `${nexLike}${likeLhs(valueCol, t.text)} LIKE ? ESCAPE '\\')`, params: [field.fieldKey, likePatternOf(`%${likeEscape(String(value))}%`)] }
      case 'equals':
        if (t.boolean) return { sql: `${ex}${valueCol} = ?)`, params: [field.fieldKey, value === true || value === 'true'] }
        // text equals is case-insensitive (Excel / AG Grid semantics)
        if (!t.numeric && !t.date) return { sql: `${ex}LOWER(${valueCol}) = LOWER(?))`, params: [field.fieldKey, value] }
        return { sql: `${ex}${valueCol} = ?)`, params: [field.fieldKey, value] }
      case 'notEqual':
        if (t.boolean) return { sql: `${nex}?)`, params: [field.fieldKey, value === true || value === 'true'] }
        // text not-equals is case-insensitive (Excel / AG Grid semantics)
        if (!t.numeric && !t.date) {
          const ci = `NOT EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND ${valueCol} IS NOT NULL AND LOWER(${valueCol}) != `
          return { sql: `${ci}LOWER(?))`, params: [field.fieldKey, value] }
        }
        return { sql: `${nex}?)`, params: [field.fieldKey, value] }
      case 'startsWith':
        return { sql: `${ex}${valueCol} LIKE ? ESCAPE '\\')`, params: [field.fieldKey, `${likeEscape(String(value))}%`] }
      case 'endsWith':
        return { sql: `${ex}${valueCol} LIKE ? ESCAPE '\\')`, params: [field.fieldKey, `%${likeEscape(String(value))}`] }
      case 'inRange': {
        if (t.date) {
          return { sql: `${ex}${valueCol} >= ? AND ${valueCol} <= ?)`, params: [field.fieldKey, value, value2] }
        }
        return { sql: `${ex}${valueCol} >= ? AND ${valueCol} <= ?)`, params: [field.fieldKey, value, value2] }
      }
      default: {
        const numOps: Record<string, string> = {
          lessThan: '<', lessThanOrEqual: '<=', greaterThan: '>', greaterThanOrEqual: '>=',
        }
        if (numOps[op] && (t.numeric || t.date)) {
          return { sql: `${ex}${valueCol} ${numOps[op]} ?)`, params: [field.fieldKey, value] }
        }
        return null // unsupported op — ignore safely
      }
    }
  }

  // ---------- core column ----------
  const c = `r."${col}"`
  const isDateCol = t.date || DATE_FIELD_KEYS.has(field.fieldKey)
  switch (op) {
    case 'blank':
      return { sql: `(${c} IS NULL OR ${c} = '')`, params: [] }
    case 'notBlank':
      return { sql: `(${c} IS NOT NULL AND ${c} != '')`, params: [] }
    case 'contains':
      return { sql: `${likeLhs(c, t.text)} LIKE ? ESCAPE '\\'`, params: [likePatternOf(`%${likeEscape(String(value))}%`)] }
    case 'notContains':
      return { sql: `${likeLhs(c, t.text)} NOT LIKE ? ESCAPE '\\'`, params: [likePatternOf(`%${likeEscape(String(value))}%`)] }
    case 'equals':
      if (t.boolean) return { sql: `${c} = ?`, params: [value === true || value === 'true'] }
      // text equals is case-insensitive (Excel / AG Grid semantics)
      if (!t.numeric && !t.date) return { sql: `LOWER(${c}) = LOWER(?)`, params: [value] }
      return { sql: `${c} = ?`, params: [value] }
    case 'notEqual':
      if (t.boolean) return { sql: `${c} != ?`, params: [value === true || value === 'true'] }
      if (!t.numeric && !t.date) return { sql: `LOWER(${c}) != LOWER(?)`, params: [value] }
      return { sql: `${c} != ?`, params: [value] }
    case 'startsWith':
      return { sql: `${likeLhs(c, t.text)} LIKE ? ESCAPE '\\'`, params: [likePatternOf(`${likeEscape(String(value))}%`)] }
    case 'endsWith':
      return { sql: `${likeLhs(c, t.text)} LIKE ? ESCAPE '\\'`, params: [likePatternOf(`%${likeEscape(String(value))}`)] }
    case 'inRange':
      if (isDateCol) {
        return { sql: `(${c} >= ? AND ${c} <= ?)`, params: [value, value2] }
      }
      return { sql: `(${c} >= ? AND ${c} <= ?)`, params: [value, value2] }
    default: {
      const numOps: Record<string, string> = {
        lessThan: '<', lessThanOrEqual: '<=', greaterThan: '>', greaterThanOrEqual: '>=',
      }
      if (numOps[op]) return { sql: `${c} ${numOps[op]} ?`, params: [value] }
      return null
    }
  }
}

/** Translate one AG Grid filter-model entry (incl. condition groups) */
function translateFilter(fieldKey: string, model: Record<string, unknown>, fieldMap: Map<string, FieldDef>): SqlPart | null {
  const field = fieldMap.get(fieldKey)
  if (!field || field.isSystem) return null
  const filterType = String(model.filterType || 'text')

  if (Array.isArray(model.conditions) && model.conditions.length > 0) {
    const operator = String(model.operator || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    const parts = (model.conditions as Array<Record<string, unknown>>)
      .map((c) => translateFilter(fieldKey, c, fieldMap))
      .filter((p): p is SqlPart => !!p)
    if (parts.length === 0) return null
    const sql = `(${parts.map((p) => p.sql).join(` ${operator} `)})`
    return { sql, params: parts.flatMap((p) => p.params) }
  }

  const op = String(model.type || 'contains')
  const t = TYPE_TRAITS[field.dataType]

  if (filterType === 'date') {
    const from = parseGridDate(model.dateFrom)
    const to = parseGridDate(model.dateTo)
    if (op === 'inRange') {
      if (!from && !to) return null
      if (from && to) return fieldCondition(field, 'inRange', from, to)
      if (from) return fieldCondition(field, 'greaterThanOrEqual', from)
      return fieldCondition(field, 'lessThanOrEqual', to)
    }
    if (op === 'blank' || op === 'notBlank') return fieldCondition(field, op, null)
    if (!from) return null
    if (op === 'equals') {
      const dayEnd = new Date(from.getTime() + 86_400_000)
      return fieldCondition(field, 'inRange', from, dayEnd)
    }
    const map: Record<string, string> = {
      lessThan: 'lessThan', lessThanOrEqual: 'lessThanOrEqual',
      greaterThan: 'greaterThan', greaterThanOrEqual: 'greaterThanOrEqual',
      notEqual: 'notEqual',
    }
    return fieldCondition(field, map[op] || 'greaterThanOrEqual', from)
  }

  if (filterType === 'number') {
    const num = Number(model.filter)
    const numTo = model.filterTo != null ? Number(model.filterTo) : null
    if (op === 'blank' || op === 'notBlank') return fieldCondition(field, op, null)
    if (op === 'inRange') {
      if (Number.isFinite(num) && Number.isFinite(numTo as number)) {
        return fieldCondition(field, 'inRange', num, numTo)
      }
      return null
    }
    if (!Number.isFinite(num)) return null
    return fieldCondition(field, op, num)
  }

  // text / boolean filter
  if (op === 'blank' || op === 'notBlank') return fieldCondition(field, op, null)
  const v = model.filter
  if (v == null || v === '') return null
  return fieldCondition(field, op, t.boolean ? v : String(v))
}

/** Global search — OR across searchable core text columns + dynamic text values */
function buildSearch(search: string, fieldMap: Map<string, FieldDef>): SqlPart | null {
  const q = search.trim()
  if (!q) return null
  const like = `%${likeEscape(q)}%`
  const parts: SqlPart[] = []
  for (const field of fieldMap.values()) {
    if (!TYPE_TRAITS[field.dataType].searchable || field.isSystem) continue
    const col = sqlColumnFor(field)
    if (col) {
      // searchable ⇒ text trait — LOWER keeps SQLite's case-insensitive search
      parts.push({ sql: `LOWER(r."${col}") LIKE ? ESCAPE '\\'`, params: [like.toLowerCase()] })
    } else {
      parts.push({
        sql: `EXISTS (SELECT 1 FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"=? AND LOWER(v."valueText") LIKE ? ESCAPE '\\')`,
        params: [field.fieldKey, like.toLowerCase()],
      })
    }
  }
  if (parts.length === 0) return null
  return { sql: `(${parts.map((p) => p.sql).join(' OR ')})`, params: parts.flatMap((p) => p.params) }
}

function buildSort(sortModel: SortItem[] | undefined, fieldMap: Map<string, FieldDef>): string {
  const clauses: string[] = []
  for (const s of sortModel || []) {
    const field = fieldMap.get(s.colId)
    if (!field || field.isSystem) continue
    const dir = s.sort === 'desc' ? 'DESC' : 'ASC'
    const col = sqlColumnFor(field)
    if (col) {
      clauses.push(`r."${col}" ${dir} NULLS LAST`)
    } else {
      const t = TYPE_TRAITS[field.dataType]
      const valueCol = t.numeric ? 'v."valueNumber"' : t.date ? 'v."valueDate"' : t.boolean ? 'v."valueBool"' : 'v."valueText"'
      const sub = `(SELECT ${valueCol} FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id" WHERE v."recordId"=r."id" AND f."fieldKey"='${field.fieldKey.replace(/'/g, "''")}')`
      clauses.push(`${sub} ${dir} NULLS LAST`)
    }
  }
  // deterministic tiebreakers (stable pagination)
  clauses.push('r."lrDate" DESC NULLS LAST')
  clauses.push('r."id" DESC')
  return `ORDER BY ${clauses.join(', ')}`
}

function buildWhere(params: ListParams, fieldMap: Map<string, FieldDef>): SqlPart {
  const parts: SqlPart[] = [{ sql: 'r."deletedAt" IS NULL', params: [] }]
  for (const [key, model] of Object.entries(params.filterModel || {})) {
    if (!model || typeof model !== 'object') continue
    const cond = translateFilter(key, model as Record<string, unknown>, fieldMap)
    if (cond) parts.push(cond)
  }
  const search = buildSearch(params.search || '', fieldMap)
  if (search) parts.push(search)
  return { sql: `WHERE ${parts.map((p) => p.sql).join(' AND ')}`, params: parts.flatMap((p) => p.params) }
}

function rowToDto(row: Record<string, unknown>, dynamic: Map<string, Map<string, StoredValue>>, fieldMap: Map<string, FieldDef>): MisRecordDto {
  const dto: MisRecordDto = {
    id: row.id as string,
    version: Number(row.version),
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
    createdBy: (row.createdBy as string) ?? null,
    updatedBy: (row.updatedBy as string) ?? null,
  }
  for (const field of fieldMap.values()) {
    if (field.isSystem) continue
    const col = sqlColumnFor(field)
    if (col) {
      const v = row[col] as StoredValue
      dto[field.fieldKey] = v instanceof Date ? serializeValue(field, v) : (v as unknown)
    }
  }
  const recDyn = dynamic.get(row.id as string)
  if (recDyn) {
    for (const field of fieldMap.values()) {
      if (field.isSystem || sqlColumnFor(field)) continue
      dto[field.fieldKey] = serializeValue(field, recDyn.get(field.fieldKey) ?? null)
    }
  }
  return dto
}

export async function listRecords(params: ListParams): Promise<{ rows: MisRecordDto[]; total: number }> {
  const fieldMap = await getFieldMap()
  const where = buildWhere(params, fieldMap)
  const take = Math.max(0, Math.min(params.end - params.start, 1000))
  const skip = Math.max(0, params.start)

  const countRows = await rawQuery<{ c: number | bigint }[]>(
    `SELECT COUNT(*) as c FROM "MisRecord" r ${where.sql}`,
    ...where.params
  )
  const total = Number(countRows[0]?.c ?? 0)

  const order = buildSort(params.sortModel, fieldMap)
  const selectCols = CORE_SELECT_COLS.map((c) => (DATE_KEYS.has(c) || DATE_FIELD_KEYS.has(c) ? `r."${c}"` : `r."${c}"`)).join(', ')
  const rows = await rawQuery<Record<string, unknown>[]>(
    `SELECT ${selectCols} FROM "MisRecord" r ${where.sql} ${order} LIMIT ? OFFSET ?`,
    ...where.params, take, skip
  )

  // fetch dynamic values for the page
  const dynamic = new Map<string, Map<string, StoredValue>>()
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id as string)
    const placeholders = ids.map(() => '?').join(',')
    const vals = await rawQuery<Array<{
      recordId: string; fieldKey: string; valueText: string | null
      valueNumber: number | null; valueDate: Date | null; valueBool: number | boolean | null
    }>>(
      `SELECT v."recordId", f."fieldKey", v."valueText", v."valueNumber", v."valueDate", v."valueBool"
       FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id"
       WHERE v."recordId" IN (${placeholders}) AND f."active"=true`,
      ...ids
    )
    for (const v of vals) {
      let m = dynamic.get(v.recordId)
      if (!m) { m = new Map(); dynamic.set(v.recordId, m) }
      const field = fieldMap.get(v.fieldKey)
      const stored: StoredValue = field && TYPE_TRAITS[field.dataType].numeric
        ? v.valueNumber
        : field && TYPE_TRAITS[field.dataType].date
          ? v.valueDate
          : field && TYPE_TRAITS[field.dataType].boolean
            ? (v.valueBool === 1 || v.valueBool === true ? true : v.valueBool === 0 || v.valueBool === false ? false : null)
            : v.valueText
      m.set(v.fieldKey, stored)
    }
  }

  const result = { rows: rows.map((r) => rowToDto(r, dynamic, fieldMap)), total }
  await attachFormulas(rows.map((r) => r.id as string), result.rows)
  return result
}

/** Get a single record with merged core + dynamic values. */
export async function getRecordDto(id: string): Promise<MisRecordDto | null> {
  const fieldMap = await getFieldMap()
  const rowsDirect = await rawQuery<Record<string, unknown>[]>(
    `SELECT ${CORE_SELECT_COLS.map((c) => `r."${c}"`).join(', ')} FROM "MisRecord" r WHERE r."id"=? AND r."deletedAt" IS NULL`,
    id
  )
  if (rowsDirect.length === 0) return null
  const dynamic = new Map<string, Map<string, StoredValue>>()
  const vals = await rawQuery<Array<{ recordId: string; fieldKey: string; valueText: string | null; valueNumber: number | null; valueDate: Date | null; valueBool: number | boolean | null }>>(
    `SELECT v."recordId", f."fieldKey", v."valueText", v."valueNumber", v."valueDate", v."valueBool"
     FROM "MisValue" v JOIN "MisField" f ON v."fieldId"=f."id"
     WHERE v."recordId"=? AND f."active"=true`,
    id
  )
  const m = new Map<string, StoredValue>()
  for (const v of vals) {
    const field = fieldMap.get(v.fieldKey)
    const stored: StoredValue = field && TYPE_TRAITS[field.dataType].numeric
      ? v.valueNumber
      : field && TYPE_TRAITS[field.dataType].date
        ? v.valueDate
        : field && TYPE_TRAITS[field.dataType].boolean
          ? (v.valueBool === 1 || v.valueBool === true ? true : v.valueBool === 0 || v.valueBool === false ? false : null)
          : v.valueText
    m.set(v.fieldKey, stored)
  }
  dynamic.set(id, m)
  const dto = rowToDto(rowsDirect[0], dynamic, fieldMap)
  await attachFormulas([id], [dto])
  return dto
}
