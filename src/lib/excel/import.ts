// Excel import — parse + classify (preview only; nothing touches the DB
// until the user confirms and applyImport is executed in one transaction).
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import type { FieldDef, ImportPreview, ImportFieldDiff, ImportRowAnalysis, SessionUser } from '@/lib/types'
import { getFieldMapForRole } from '@/lib/services/fields'
import { coerceValue, importValuesEqual, type StoredValue } from '@/lib/services/values'
import { computeRecordKeys } from '@/lib/services/business-key'
import { DERIVED_FIELD_KEYS } from '@/lib/services/delivery'
const SYS_ID_HEADER = 'SYS_RECORD_ID'
const SYS_VERSION_HEADER = 'SYS_VERSION'

// Import size safety (documented limits — see docs/coolify-deployment.md):
//   • file size    : 10 MB
//   • rows         : 5,000 per file
//   • worksheets   : 20 per workbook
// The preview → confirm job model keeps parsing off the request hot path and
// leaves room to move to background processing for larger files later.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_WORKSHEETS = 20

export interface RawRow {
  excelRow: number
  recordId: string | null
  fileVersion: number | null
  rawValues: Record<string, unknown> // by fieldKey
  formulas: Record<string, string> // by fieldKey — cell formulas captured from the file
}

function detectSheet(wb: XLSX.WorkBook, fieldMap: Map<string, FieldDef>): { sheetName: string; rows: unknown[][]; headerRowIndex: number } | null {
  const candidates = [
    ...(wb.SheetNames.includes('MIS') ? ['MIS'] : []),
    ...wb.SheetNames.filter((n) => n !== 'MIS'),
  ]
  const knownNames = new Set([...fieldMap.values()].map((f) => f.fieldName.toLowerCase()))
  knownNames.add(SYS_ID_HEADER.toLowerCase())
  knownNames.add(SYS_VERSION_HEADER.toLowerCase())

  for (const name of candidates) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null })
    // header row: try rows 0..4, find the one matching the most known headers
    let best = { idx: -1, matches: 0 }
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const cells = (rows[i] || []).map((c) => String(c ?? '').trim().toLowerCase())
      const matches = cells.filter((c) => c && knownNames.has(c)).length
      if (matches > best.matches) best = { idx: i, matches }
    }
    if (best.idx >= 0 && best.matches >= 8) {
      return { sheetName: name, rows, headerRowIndex: best.idx }
    }
  }
  return null
}

export async function analyzeImportFile(buffer: Buffer, fileName: string, user: SessionUser): Promise<ImportPreview> {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'File is too large. Maximum upload size is 10 MB.')
  }
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { cellDates: true, type: 'buffer', cellFormula: true })
  } catch {
    throw new ApiError(400, 'This file could not be read as a valid Excel workbook (.xlsx).')
  }
  if (wb.SheetNames.length > MAX_WORKSHEETS) {
    throw new ApiError(400, `The workbook contains ${wb.SheetNames.length} worksheets — the limit is ${MAX_WORKSHEETS} per file.`)
  }

  // Field mapping (role-aware): restricted tables (Vehicle Rate, Loading
  // Charges) are not mapped for roles that may not see them — their columns
  // are reported as ignored, their values never captured. This is the ONLY
  // mapping-source change; detection / parsing / dedup logic is untouched.
  const fieldMap = await getFieldMapForRole(user.role)
  const fields = [...fieldMap.values()]
  const detected = detectSheet(wb, fieldMap)
  if (!detected) {
    throw new ApiError(400, 'No MIS sheet found. The workbook must contain a sheet with the MIS column headers (e.g. "PARTY NAME", "LR. NO." …).')
  }

  const { rows, headerRowIndex } = detected
  const headerCells = (rows[headerRowIndex] || []).map((c) => String(c ?? '').trim())

  // ---- map headers ----
  const colToField = new Map<number, FieldDef>()
  let sysIdCol = -1
  let sysVerCol = -1
  const ignoredHeaders: string[] = []
  const missingRequiredHeaders = fields
    .filter((f) => f.required && !headerCells.some((h) => h.toLowerCase() === f.fieldName.toLowerCase()))
    .map((f) => f.fieldName)
  headerCells.forEach((h, i) => {
    if (!h) return
    const lower = h.toLowerCase()
    if (lower === SYS_ID_HEADER.toLowerCase()) { sysIdCol = i; return }
    if (lower === SYS_VERSION_HEADER.toLowerCase()) { sysVerCol = i; return }
    const field = fields.find((f) => f.fieldName.toLowerCase() === lower)
    if (field) colToField.set(i, field)
    else if (!['sr. no.', 's.no', 's no', 'sr no', 'srno'].includes(lower)) ignoredHeaders.push(h)
  })

  const warnings: string[] = []
  if (ignoredHeaders.length > 0) {
    warnings.push(`Ignored ${ignoredHeaders.length} unrecognized column(s): ${ignoredHeaders.slice(0, 6).join(', ')}${ignoredHeaders.length > 6 ? ' …' : ''}`)
  }
  if (sysIdCol === -1) {
    warnings.push('No SYS_RECORD_ID column found — every row will be treated as a NEW record.')
  }
  if (missingRequiredHeaders.length > 0) {
    warnings.push(`Required column(s) missing: ${missingRequiredHeaders.join(', ')} — rows may fail validation.`)
  }

  // ---- parse data rows ----
  // capture cell formulas (Excel keeps them on cells as .f)
  const sheet = wb.Sheets[detected.sheetName]
  const formulaByCell = new Map<string, string>() // "r,c" (0-based) → formula text
  if (sheet && sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref'])
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = sheet[addr] as { f?: string; F?: string } | undefined
        if (cell && typeof cell.f === 'string' && cell.f.trim() !== '') {
          formulaByCell.set(`${r},${c}`, cell.f.startsWith('=') ? cell.f : `=${cell.f}`)
        }
      }
    }
  }

  const rawRows: RawRow[] = []
  const seenRecordIds = new Map<string, number>()
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const hasData = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (!hasData) continue
    const raw: RawRow = { excelRow: r + 1, recordId: null, fileVersion: null, rawValues: {}, formulas: {} }
    for (const [colIdx, field] of colToField) {
      raw.rawValues[field.fieldKey] = row[colIdx] ?? null
      const f = formulaByCell.get(`${r},${colIdx}`)
      if (f) raw.formulas[field.fieldKey] = f
    }
    if (sysIdCol >= 0 && row[sysIdCol] != null && String(row[sysIdCol]).trim() !== '') {
      raw.recordId = String(row[sysIdCol]).trim()
      if (sysVerCol >= 0 && row[sysVerCol] != null && String(row[sysVerCol]).trim() !== '') {
        raw.fileVersion = Number(row[sysVerCol])
      }
    }
    rawRows.push(raw)
  }
  if (rawRows.length === 0) {
    throw new ApiError(400, 'No data rows were found below the header row.')
  }
  if (rawRows.length > 5000) {
    throw new ApiError(400, `File contains ${rawRows.length} rows — the import limit is 5,000 rows per file.`)
  }

  // ---- coerce values + compute composite business identity ----
  const analyses: ImportRowAnalysis[] = []
  const rawById = new Map<string, RawRow>()
  for (const raw of rawRows) {
    const values: Record<string, unknown> = {}
    const errors: string[] = []
    for (const field of fields) {
      if (field.isSystem) continue
      const input = raw.rawValues[field.fieldKey]
      const res = coerceValue(field, input)
      if (!res.ok) {
        errors.push(res.error || `${field.displayName}: invalid value`)
        values[field.fieldKey] = input // keep raw for display
      } else {
        values[field.fieldKey] = res.value
      }
    }
    let duplicateId = false
    if (raw.recordId) {
      const prev = seenRecordIds.get(raw.recordId)
      if (prev != null) {
        errors.push(`Duplicate SYS_RECORD_ID — same record already appears at Excel row ${prev}`)
        duplicateId = true
      } else {
        seenRecordIds.set(raw.recordId, raw.excelRow)
        rawById.set(raw.recordId, raw)
      }
    }
    // composite identity: LR No + Invoice + Party (businessKey) and
    // Material + Bucket + Qty (lineKey) — normalized, case/space-insensitive
    const keys = computeRecordKeys(values)
    analyses.push({
      rowIndex: raw.excelRow,
      // transient state — refined below by dup detection / DB matching
      kind: errors.length > 0 ? 'INVALID' : 'NEW',
      recordId: raw.recordId,
      dbVersion: null,
      fileVersion: raw.fileVersion,
      values,
      formulas: raw.formulas,
      diffs: [],
      dbValues: null,
      changedBy: null,
      changedAt: null,
      errors,
      businessKey: keys.businessKey,
      lineKey: keys.lineKey,
      duplicateOfRow: null,
      duplicateConflicting: false,
    })
    void duplicateId
  }

  // ---- in-file duplicate detection (business key + line key) ----
  // The FIRST occurrence of each (businessKey, lineKey) pair is retained;
  // later rows carrying the same identity are DUPLICATEs and are never applied.
  const rowByCompositeKey = new Map<string, ImportRowAnalysis>()
  let inFileDuplicates = 0
  let conflictingDuplicates = 0
  for (const a of analyses) {
    if (a.kind === 'INVALID' || a.businessKey == null) continue
    const composite = `${a.businessKey}\u0000${a.lineKey}`
    const first = rowByCompositeKey.get(composite)
    if (!first) {
      rowByCompositeKey.set(composite, a)
      continue
    }
    a.kind = 'DUPLICATE'
    a.duplicateOfRow = first.rowIndex
    // conflicting when any importable value differs from the retained row
    a.duplicateConflicting = fields.some((f) => {
      if (f.isSystem) return false
      return !importValuesEqual(
        f.fieldKey,
        (first.values[f.fieldKey] ?? null) as StoredValue,
        (a.values[f.fieldKey] ?? null) as StoredValue,
      )
    })
    inFileDuplicates++
    if (a.duplicateConflicting) conflictingDuplicates++
  }

  // ---- fetch DB state for records referenced by SYS_RECORD_ID (single batched query) ----
  const ids = [...rawById.keys()]
  const dbRecords = ids.length > 0
    ? await db.misRecord.findMany({ where: { id: { in: ids }, deletedAt: null } })
    : []
  const dbById = new Map(dbRecords.map((r) => [r.id, r]))

  // core column mapping for DB record
  const coreKeys = new Set(fields.filter((f) => f.isCore && !f.isSystem).map((f) => f.fieldKey))

  // ---- business-key match: rows without a resolvable SYS_RECORD_ID ----
  // A row exported from another workbook (or hand-made) carries no record id;
  // it is matched against ACTIVE records by its normalized composite identity
  // (LR No + Invoice + Party + material line). A match updates the EXISTING
  // record in place — its id, createdAt and audit history are preserved.
  const keyCandidates = analyses.filter(
    (a) => a.kind === 'NEW' && !a.recordId && a.businessKey != null,
  )
  const dbByKey = new Map<string, { id: string; version: number }>()
  if (keyCandidates.length > 0) {
    const distinctKeys = [...new Set(keyCandidates.map((a) => a.businessKey!))]
    const keyMatches = await db.misRecord.findMany({
      where: { businessKey: { in: distinctKeys }, deletedAt: null },
      select: { id: true, version: true, businessKey: true, lineKey: true },
    })
    for (const rec of keyMatches) {
      dbByKey.set(`${rec.businessKey}\u0000${rec.lineKey}`, { id: rec.id, version: rec.version })
    }
    const keyHitIds = new Set<string>()
    for (const a of keyCandidates) {
      const hit = dbByKey.get(`${a.businessKey}\u0000${a.lineKey}`)
      if (hit) {
        a.recordId = hit.id
        // adopt the current DB version so apply-time optimistic locking works
        a.fileVersion = hit.version
        keyHitIds.add(hit.id)
      }
    }
    // fetch full rows for key-matched records not already loaded (single batch)
    const extraIds = [...keyHitIds].filter((id) => !dbById.has(id))
    if (extraIds.length > 0) {
      const extra = await db.misRecord.findMany({ where: { id: { in: extraIds }, deletedAt: null } })
      for (const rec of extra) dbById.set(rec.id, rec)
    }
  }

  // ---- fetch dynamic (EAV) values for every resolved record (single batch) ----
  const dbDynamic = new Map<string, Record<string, StoredValue>>()
  const allIds = [...dbById.keys()]
  if (allIds.length > 0) {
    const vals = await db.misValue.findMany({ where: { recordId: { in: allIds } } })
    const fieldById = new Map(fields.map((f) => [f.id, f]))
    for (const v of vals) {
      const field = fieldById.get(v.fieldId)
      if (!field) continue
      let m = dbDynamic.get(v.recordId)
      if (!m) { m = {}; dbDynamic.set(v.recordId, m) }
      m[field.fieldKey] = (v.valueText ?? v.valueNumber ?? v.valueDate ?? v.valueBool ?? null) as StoredValue
    }
  }

  // ---- classify rows ----
  for (const a of analyses) {
    if (a.kind === 'INVALID' || a.kind === 'DUPLICATE') continue
    if (!a.recordId) { a.kind = 'NEW'; continue }
    const dbRec = dbById.get(a.recordId)
    if (!dbRec) {
      // unknown SYS id (deleted or foreign file) with no key match → new record
      a.kind = 'NEW'
      a.recordId = null
      continue
    }
    // build DB values map
    const dbValues: Record<string, unknown> = {}
    for (const field of fields) {
      if (field.isSystem) continue
      if (coreKeys.has(field.fieldKey)) {
        dbValues[field.fieldKey] = (dbRec as unknown as Record<string, unknown>)[field.fieldKey] ?? null
      } else {
        dbValues[field.fieldKey] = dbDynamic.get(a.recordId)?.[field.fieldKey] ?? null
      }
    }
    a.dbVersion = dbRec.version
    a.dbValues = dbValues
    a.changedBy = dbRec.updatedBy
    a.changedAt = dbRec.updatedAt.toISOString()

    // diff
    const diffs: ImportFieldDiff[] = []
    for (const field of fields) {
      if (field.isSystem) continue
      const fileV = a.values[field.fieldKey] as StoredValue
      // system-derived columns (live status / tracking / last status update):
      // absent from the file ≠ changed — they are re-derived on every write
      if (DERIVED_FIELD_KEYS.has(field.fieldKey) && fileV == null) continue
      const dbV = dbValues[field.fieldKey] as StoredValue
      if (!importValuesEqual(field.fieldKey, dbV ?? null, fileV ?? null)) {
        diffs.push({ fieldKey: field.fieldKey, fieldName: field.displayName, oldValue: dbV ?? null, newValue: fileV ?? null })
      }
    }
    a.diffs = diffs

    if (a.fileVersion == null || dbRec.version !== a.fileVersion) {
      a.kind = 'CONFLICT'
    } else if (diffs.length > 0) {
      a.kind = 'CHANGED'
    } else {
      a.kind = 'UNCHANGED'
    }
  }

  // ---- missing-from-file (potential deletes) — only for near-full snapshots ----
  // Coverage counts records matched by SYS_RECORD_ID OR by business key.
  const activeRecords = await db.misRecord.findMany({
    where: { deletedAt: null },
    select: { id: true, lrNo: true, partyName: true, destination: true },
  })
  const fileIds = new Set(
    analyses
      .filter((a) => a.recordId && dbById.has(a.recordId))
      .map((a) => a.recordId!),
  )
  const coverage = activeRecords.length > 0 ? fileIds.size / activeRecords.length : 0
  const missing: ImportPreview['missing'] = []
  if (coverage >= 0.5) {
    for (const rec of activeRecords) {
      if (!fileIds.has(rec.id)) {
        missing.push({ recordId: rec.id, lrNo: rec.lrNo, partyName: rec.partyName, destination: rec.destination })
      }
    }
    if (missing.length > 0) {
      warnings.push(`${missing.length} record(s) exist in the database but are missing from this file (it covers ${Math.round(coverage * 100)}% of active records). They are proposed as deletions — review carefully.`)
    }
  }

  // ---- duplicate / identity transparency ----
  if (inFileDuplicates > 0) {
    warnings.push(`${inFileDuplicates} row(s) repeat an earlier row's shipment identity (LR No + Invoice + Party + material line) — only the first occurrence is imported.${conflictingDuplicates > 0 ? ` ${conflictingDuplicates} of them carry different values.` : ''}`)
  }
  const noIdentity = analyses.filter((a) => a.kind !== 'INVALID' && a.businessKey == null).length
  if (noIdentity > 0) {
    warnings.push(`${noIdentity} row(s) have an incomplete identity (missing LR No, Invoice or Party) — they cannot be checked for duplicates.`)
  }

  const stats = {
    detected: analyses.length,
    new: analyses.filter((a) => a.kind === 'NEW').length,
    changed: analyses.filter((a) => a.kind === 'CHANGED').length,
    unchanged: analyses.filter((a) => a.kind === 'UNCHANGED').length,
    conflicts: analyses.filter((a) => a.kind === 'CONFLICT').length,
    invalid: analyses.filter((a) => a.kind === 'INVALID').length,
    missing: missing.length,
    duplicates: inFileDuplicates,
  }

  // ---- persist job for the confirm step ----
  const job = await db.importJob.create({
    data: {
      userId: user.id,
      userName: user.name,
      fileName,
      status: 'PREVIEW',
      stats: JSON.stringify(stats),
      payload: JSON.stringify({
        sheetName: detected.sheetName,
        rows: analyses,
        missing,
        sheetCtx: {
          headerRowIndex,
          colToField: [...colToField.entries()].map(([colIdx, f]) => [colIdx, f.fieldKey]),
        },
      }),
    },
  })

  return {
    jobId: job.id,
    fileName,
    stats,
    rows: analyses,
    missing,
    warnings,
  }
}
