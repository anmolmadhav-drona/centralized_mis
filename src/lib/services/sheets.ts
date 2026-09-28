// Application MIS Sheets (datasets) — identity + per-sheet business-module
// (column) configuration. NPL is the system sheet and keeps using the global
// MisField registry; other sheets own independent SheetColumn rows.
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import type { SessionUser, SheetDto, SheetColumnDto, SheetRecordDto } from '@/lib/types'

/** Machine key from a human column name (unique within a sheet). */
function slugify(s: string): string {
  const base = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || 'col'
}

export interface CreateSheetInput {
  name: string
  mode: 'scratch' | 'import'
  columns: Array<{ name: string }>
  sourceSheetId?: string
}

interface NewColumn {
  fieldKey: string
  fieldName: string
  displayName: string
  dataType: string
  required: boolean
  defaultValue: string | null
  options: string | null
  position: number
  width: number | null
  active: boolean
}

/** List every application sheet (NPL first), with a column count. */
export async function listSheets(): Promise<SheetDto[]> {
  const sheets = await db.sheet.findMany({
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { columns: true } } },
  })
  return sheets.map((s) => ({
    id: s.id,
    name: s.name,
    isSystem: s.isSystem,
    source: s.source,
    // NPL's business module is the global MisField registry, not SheetColumn rows
    columnCount: s.isSystem ? 0 : s._count.columns,
    createdAt: s.createdAt.toISOString(),
  }))
}

/** Build the column set for a from-scratch sheet (unique slugged keys). */
function columnsFromScratch(input: CreateSheetInput): NewColumn[] {
  const used = new Set<string>()
  return input.columns.map((c, i) => {
    let key = slugify(c.name)
    let n = 2
    while (used.has(key)) key = `${slugify(c.name)}_${n++}`
    used.add(key)
    return {
      fieldKey: key,
      fieldName: c.name.trim(),
      displayName: c.name.trim(),
      dataType: 'TEXT',
      required: false,
      defaultValue: null,
      options: null,
      position: i,
      width: null,
      active: true,
    }
  })
}

/** Clone a source sheet's business module into an independent column set. */
async function columnsFromImport(sourceSheetId: string): Promise<NewColumn[]> {
  const source = await db.sheet.findUnique({ where: { id: sourceSheetId } })
  if (!source) throw new ApiError(400, 'The selected source business module no longer exists.')

  if (source.isSystem) {
    // NPL — copy the global MisField registry (skip generated system fields).
    const fields = await db.misField.findMany({
      where: { isSystem: false },
      orderBy: { position: 'asc' },
    })
    return fields.map((f, i) => ({
      fieldKey: f.fieldKey,
      fieldName: f.fieldName,
      displayName: f.displayName,
      dataType: f.dataType,
      required: f.required,
      defaultValue: f.defaultValue,
      options: f.options,
      position: f.position ?? i,
      width: f.width,
      active: f.active,
    }))
  }

  // Another in-app sheet — copy its own SheetColumn rows into new, independent rows.
  const cols = await db.sheetColumn.findMany({ where: { sheetId: sourceSheetId }, orderBy: { position: 'asc' } })
  return cols.map((c, i) => ({
    fieldKey: c.fieldKey,
    fieldName: c.fieldName,
    displayName: c.displayName,
    dataType: c.dataType,
    required: c.required,
    defaultValue: c.defaultValue,
    options: c.options,
    position: c.position ?? i,
    width: c.width,
    active: c.active,
  }))
}

/**
 * Create a new application sheet. ADMIN-only (enforced at the route). Copies
 * only business-module CONFIGURATION on import — never records, values,
 * formulas, audit, jobs or users.
 */
export async function createSheet(input: CreateSheetInput, user: SessionUser): Promise<SheetDto> {
  const name = input.name.trim()

  // duplicate application-sheet name (case-insensitive) → reject
  const existing = await db.sheet.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
  if (existing) throw new ApiError(409, `A sheet named "${name}" already exists.`)

  const columns = input.mode === 'import'
    ? await columnsFromImport(input.sourceSheetId!)
    : columnsFromScratch(input)

  const created = await db.$transaction(async (tx) => {
    const sheet = await tx.sheet.create({
      data: { name, isSystem: false, source: input.mode, createdBy: user.name },
    })
    if (columns.length > 0) {
      await tx.sheetColumn.createMany({
        data: columns.map((c) => ({ ...c, sheetId: sheet.id })),
      })
    }
    return sheet
  })

  return {
    id: created.id,
    name: created.name,
    isSystem: created.isSystem,
    source: created.source,
    columnCount: columns.length,
    createdAt: created.createdAt.toISOString(),
  }
}

// ------------------------------------------------------------------
// Generic Sheet runtime: columns + record CRUD (JSON-per-record store)
// ------------------------------------------------------------------

/** Light, dataType-driven coercion for a single cell value. */
function coerceCell(dataType: string, v: unknown): unknown {
  if (v == null || v === '') return null
  switch (dataType) {
    case 'INTEGER': {
      const n = Number(String(v).replace(/[, ]/g, ''))
      return Number.isFinite(n) ? Math.round(n) : null
    }
    case 'DECIMAL': {
      const n = Number(String(v).replace(/[, ]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    case 'BOOLEAN': {
      if (typeof v === 'boolean') return v
      const s = String(v).trim().toLowerCase()
      if (['true', 'yes', '1', 'y'].includes(s)) return true
      if (['false', 'no', '0', 'n'].includes(s)) return false
      return null
    }
    default:
      return String(v)
  }
}

/** Coerce an incoming data map against the sheet's columns (unknown keys dropped). */
function coerceData(cols: Array<{ fieldKey: string; dataType: string }>, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of cols) {
    if (Object.prototype.hasOwnProperty.call(data, c.fieldKey)) {
      out[c.fieldKey] = coerceCell(c.dataType, data[c.fieldKey])
    }
  }
  return out
}

function parseData(json: string): Record<string, unknown> {
  try { return JSON.parse(json || '{}') as Record<string, unknown> } catch { return {} }
}

/** Sheet meta + its active column definitions (the runtime's source of truth). */
export async function getSheetWithColumns(
  id: string,
): Promise<{ sheet: SheetDto; columns: SheetColumnDto[] }> {
  const sheet = await db.sheet.findUnique({ where: { id }, include: { _count: { select: { columns: true } } } })
  if (!sheet) throw new ApiError(404, 'Sheet not found.')
  const cols = await db.sheetColumn.findMany({
    where: { sheetId: id, active: true },
    orderBy: { position: 'asc' },
  })
  return {
    sheet: {
      id: sheet.id,
      name: sheet.name,
      isSystem: sheet.isSystem,
      source: sheet.source,
      columnCount: sheet.isSystem ? 0 : sheet._count.columns,
      createdAt: sheet.createdAt.toISOString(),
    },
    columns: cols.map((c) => ({
      id: c.id,
      fieldKey: c.fieldKey,
      fieldName: c.fieldName,
      displayName: c.displayName,
      dataType: c.dataType,
      required: c.required,
      defaultValue: c.defaultValue,
      options: c.options ? (JSON.parse(c.options) as string[]) : null,
      position: c.position,
      width: c.width,
      active: c.active,
    })),
  }
}

async function requireNonSystemSheet(sheetId: string): Promise<void> {
  const sheet = await db.sheet.findUnique({ where: { id: sheetId }, select: { id: true, isSystem: true } })
  if (!sheet) throw new ApiError(404, 'Sheet not found.')
  if (sheet.isSystem) throw new ApiError(400, 'NPL records are managed in the main MIS workspace.')
}

async function activeColumns(sheetId: string): Promise<Array<{ fieldKey: string; dataType: string }>> {
  return db.sheetColumn.findMany({ where: { sheetId, active: true }, select: { fieldKey: true, dataType: true } })
}

const toRecordDto = (r: { id: string; version: number; data: string; createdAt: Date; updatedAt: Date; updatedBy: string | null }): SheetRecordDto => ({
  id: r.id,
  version: r.version,
  data: parseData(r.data),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  updatedBy: r.updatedBy,
})

export async function listSheetRecords(sheetId: string): Promise<SheetRecordDto[]> {
  const rows = await db.sheetRecord.findMany({
    where: { sheetId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toRecordDto)
}

export async function createSheetRecord(sheetId: string, data: Record<string, unknown>, user: SessionUser): Promise<SheetRecordDto> {
  await requireNonSystemSheet(sheetId)
  const cols = await activeColumns(sheetId)
  const rec = await db.sheetRecord.create({
    data: { sheetId, data: JSON.stringify(coerceData(cols, data)), createdBy: user.name, updatedBy: user.name },
  })
  return toRecordDto(rec)
}

export async function updateSheetRecord(
  sheetId: string,
  recordId: string,
  version: number,
  data: Record<string, unknown>,
  user: SessionUser,
): Promise<SheetRecordDto> {
  await requireNonSystemSheet(sheetId)
  const existing = await db.sheetRecord.findFirst({ where: { id: recordId, sheetId, deletedAt: null } })
  if (!existing) throw new ApiError(404, 'Record not found.')
  const cols = await activeColumns(sheetId)
  const merged = { ...parseData(existing.data), ...coerceData(cols, data) }
  const updated = await db.sheetRecord.updateMany({
    where: { id: recordId, sheetId, version, deletedAt: null },
    data: { data: JSON.stringify(merged), version: version + 1, updatedBy: user.name },
  })
  if (updated.count === 0) {
    throw new ApiError(409, 'This record was changed by someone else. Refresh and try again.', 'VERSION_CONFLICT')
  }
  const rec = await db.sheetRecord.findUnique({ where: { id: recordId } })
  return toRecordDto(rec!)
}

export async function deleteSheetRecord(sheetId: string, recordId: string, user: SessionUser): Promise<void> {
  await requireNonSystemSheet(sheetId)
  const existing = await db.sheetRecord.findFirst({ where: { id: recordId, sheetId, deletedAt: null } })
  if (!existing) throw new ApiError(404, 'Record not found.')
  await db.sheetRecord.update({ where: { id: recordId }, data: { deletedAt: new Date(), updatedBy: user.name } })
}
