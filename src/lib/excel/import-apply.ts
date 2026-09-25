// Import confirm — applies a previewed import in a SINGLE transaction:
// validate → create/update/delete → audit → version bumps all-or-nothing.
// Cell formulas captured from the file are evaluated in SHEET context and
// persisted; delivery statuses are re-derived automatically.
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import type { ImportApplyResult, ImportRowAnalysis, SessionUser, FieldDef } from '@/lib/types'
import { getFieldMapForRole, sqlColumnFor } from '@/lib/services/fields'
import { coerceValue, valuesEqual, importValuesEqual, type StoredValue } from '@/lib/services/values'
import { computeRecordKeys } from '@/lib/services/business-key'
import { normalizeMeasurement } from '@/lib/services/measurement'
import { writeAudit, type AuditEntryInput } from '@/lib/services/audit'
import { emitRealtime } from '@/lib/services/realtime'
import { computeDeliveryPatch, DERIVED_FIELD_KEYS } from '@/lib/services/delivery'
import {
  compileFormula, evalCompiled, isErr, type RefResolver, type EvalResult, type EvalValue, type CellAddr, type CellError, cellError,
} from '@/lib/formula'

export interface ConfirmInput {
  jobId: string
  resolutions: Record<string, 'mine' | 'theirs'>
  newRows: number[]
  changedRows: number[]
  deletions: string[]
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

/**
 * A shipment line that lost a uniqueness race inside the import transaction
 * (the database constraint is the final guard). Thrown so the caller can
 * ROLLBACK TO its SAVEPOINT and continue with the remaining rows.
 */
class ConcurrentDuplicateError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ConcurrentDuplicateError'
  }
}

/**
 * Run one row's writes inside a SAVEPOINT.
 *
 * PostgreSQL (unlike SQLite) poisons the whole transaction after a failed
 * statement (25P02) — the catch-and-continue pattern used for the import
 * race guard needs an explicit rollback point so the remaining rows and the
 * summary audit can still be written.
 */
async function savepointWork(tx: Tx, name: string, work: () => Promise<unknown>): Promise<void> {
  const safe = name.replace(/[^A-Za-z0-9_]/g, '_')
  await tx.$executeRawUnsafe(`SAVEPOINT ${safe}`)
  try {
    await work()
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${safe}`)
  } catch (err) {
    try {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${safe}`)
    } catch {
      // connection-level failure — let the original error surface
    }
    throw err
  }
}

/** Prisma unique-constraint violation (race with a concurrent import). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

/** System-derived columns (live status / tracking / last status update) are
 *  re-derived by the delivery patch on every write — a file omitting them must
 *  not null them out or audit a phantom change. Explicit values are kept. */
function dropNullDerived(core: Record<string, StoredValue>): void {
  for (const k of DERIVED_FIELD_KEYS) {
    if (core[k] == null) delete core[k]
  }
}

interface SheetCtx {
  headerRowIndex: number
  colToField: Array<[number, string]>
}

/** Sheet-context resolvers — column refs bind to the formula's own row;
 *  A1 cell refs / ranges resolve against the parsed sheet (absolute). */
function makeSheetResolvers(
  ctx: SheetCtx | undefined,
  rowsByExcelRow: Map<number, ImportRowAnalysis>,
  fields: FieldDef[]
) {
  const colToField = new Map<number, string>(ctx?.colToField ?? [])
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]))

  const serialize = (v: unknown): EvalValue | null => {
    if (v == null) return null
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    if (typeof v === 'number' || typeof v === 'boolean') return v
    return String(v)
  }
  const cellValueAt = (col: number, row: number): EvalValue | null => {
    const fieldKey = colToField.get(col - 1) // A1 col is 1-based, ctx col 0-based
    const rowAnalysis = rowsByExcelRow.get(row)
    if (!fieldKey || !rowAnalysis) {
      return cellError('#REF!', `Cell reference points outside the imported sheet (row ${row})`)
    }
    return serialize(rowAnalysis.values[fieldKey])
  }
  /** per-row resolver (column refs = this row's values) */
  const rowResolver = (row: ImportRowAnalysis): RefResolver => ({
    columnValue(fieldKey: string, name: string): EvalValue | null {
      if (!fieldByKey.has(fieldKey)) return cellError('#REF!', `Unknown column "${name}"`)
      return serialize(row.values[fieldKey])
    },
    cellValue(addr: CellAddr): EvalValue | null {
      return cellValueAt(addr.col, addr.row)
    },
    rangeValues(start: CellAddr, end: CellAddr): Array<EvalValue | null> | CellError {
      const out: Array<EvalValue | null> = []
      const c0 = Math.min(start.col, end.col)
      const c1 = Math.max(start.col, end.col)
      const r0 = Math.min(start.row, end.row)
      const r1 = Math.max(start.row, end.row)
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const v = cellValueAt(c, r)
          if (isErr(v)) return v
          out.push(v)
        }
      }
      return out
    },
  })
  return { rowResolver }
}

export async function applyImport(input: ConfirmInput, user: SessionUser, meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null }): Promise<ImportApplyResult> {
  const job = await db.importJob.findUnique({ where: { id: input.jobId } })
  if (!job) throw new ApiError(404, 'Import job not found.')
  if (job.status !== 'PREVIEW') throw new ApiError(409, 'This import was already processed. Please upload the file again.')

  const payload = JSON.parse(job.payload || '{}') as {
    rows: ImportRowAnalysis[]
    missing: Array<{ recordId: string }>
    sheetCtx?: SheetCtx
  }
  const rows = payload.rows || []
  // Field mapping (role-aware): restricted tables (Vehicle Rate, Loading
  // Charges) are never applied for roles that may not see them — even if a
  // preview payload (e.g. prepared by another user) carried their values.
  // The apply/transaction/dedup architecture below is untouched.
  const fieldMap = await getFieldMapForRole(user.role)
  const fields = [...fieldMap.values()]
  const coreKeys = new Set(fields.filter((f) => f.isCore && !f.isSystem).map((f) => f.fieldKey))
  const rowsByExcelRow = new Map(rows.map((r) => [r.rowIndex, r]))
  const { rowResolver } = makeSheetResolvers(payload.sheetCtx, rowsByExcelRow, fields)

  /** Evaluate a row's captured formulas → outcomes (value + cached JSON). */
  const evalRowFormulas = (row: ImportRowAnalysis) => {
    const outcomes: Array<{ fieldKey: string; field: FieldDef | undefined; value: StoredValue; cached: string; formula: string }> = []
    if (!row.formulas) return outcomes
    for (const [fieldKey, text] of Object.entries(row.formulas)) {
      const field = fieldMap.get(fieldKey)
      const result: EvalResult = (() => {
        try {
          return evalCompiled(compileFormula(text, fields), rowResolver(row))
        } catch (err) {
          const e = err as { code: string; message: string }
          return cellError(e.code || '#VALUE!', e.message || 'Invalid formula')
        }
      })()
      const v = Array.isArray(result) ? result[0] ?? null : result
      if (isErr(v)) {
        outcomes.push({ fieldKey, field, value: null, cached: JSON.stringify({ ok: false, e: { code: v.code, message: v.message } }), formula: text })
        continue
      }
      const coerced = field ? coerceValue(field, v ?? null) : { ok: false, value: null, error: 'unknown column' }
      if (!coerced.ok) {
        outcomes.push({ fieldKey, field, value: null, cached: JSON.stringify({ ok: false, e: { code: '#VALUE!', message: coerced.error || 'Formula result does not fit this column' } }), formula: text })
        continue
      }
      outcomes.push({ fieldKey, field, value: coerced.value, cached: JSON.stringify({ ok: true, v: coerced.value instanceof Date ? coerced.value.toISOString() : coerced.value }), formula: text })
    }
    return outcomes
  }

  const result: ImportApplyResult = {
    applied: 0, created: 0, updated: 0, unchanged: 0, deleted: 0, skipped: 0,
    duplicates: 0, failed: 0, failedRows: [],
    conflictsResolvedMine: 0, conflictsResolvedTheirs: 0,
  }

  const byRowIndex = new Map(rows.map((r) => [r.rowIndex, r]))

  /** Record a row-level failure with enough context to locate it in the file. */
  const failRow = (row: ImportRowAnalysis, reason: string) => {
    result.failed++
    result.skipped++
    result.failedRows.push({
      rowIndex: row.rowIndex,
      lrNo: (row.values.lrNo as number | string | null) ?? null,
      invoiceNumber: (row.values.invoiceNumber as string | null) ?? null,
      partyName: (row.values.partyName as string | null) ?? null,
      reason,
    })
  }

  const applyOneRow = async (tx: Tx, row: ImportRowAnalysis, forceOverwrite: boolean) => {
    // ---- re-validate (never trust the preview payload) ----
    const core: Record<string, StoredValue> = {}
    const dyn = new Map<string, StoredValue>()
    for (const field of fields) {
      if (field.isSystem) continue
      const raw = row.values[field.fieldKey]
      const res = coerceValue(field, raw)
      if (!res.ok) {
        failRow(row, res.error || `${field.displayName}: invalid value`)
        return { ok: false, reason: res.error }
      }
      if (field.required && res.value == null) {
        const reason = `${field.displayName} is required`
        failRow(row, reason)
        return { ok: false, reason }
      }
      const col = sqlColumnFor(field)
      if (col) core[col] = res.value
      else dyn.set(field.id, res.value)
    }

    // ---- formulas: evaluate in sheet context, override cached values ----
    const formulaOutcomes = evalRowFormulas(row)
    for (const o of formulaOutcomes) {
      if (!o.field) continue
      const col = sqlColumnFor(o.field)
      if (col) core[col] = o.value
      else dyn.set(o.field.id, o.value)
    }
    // derived columns: never nulled from a file — the delivery patch re-derives
    dropNullDerived(core)
    // measurement: store the canonical unit (idempotent — preview already
    // normalized, but apply never trusts the payload)
    if (typeof core.measurement === 'string') core.measurement = normalizeMeasurement(core.measurement)

    // identity may have been re-pointed by key matching — resolve by row.recordId
    const dbRec = await tx.misRecord.findUnique({ where: { id: row.recordId! } })
    if (!dbRec || dbRec.deletedAt) {
      failRow(row, 'Record no longer exists')
      return { ok: false, reason: 'Record no longer exists' }
    }

    // version check (unless user explicitly resolved a conflict with "use my value")
    if (!forceOverwrite && dbRec.version !== row.fileVersion) {
      failRow(row, 'Record changed since preview — review the conflict')
      return { ok: false, reason: 'Record changed since preview — review the conflict' }
    }

    // diffs for audit (identity text fields compare case-insensitively —
    // same rule as the preview classification)
    const audits: AuditEntryInput[] = []
    for (const [col, newVal] of Object.entries(core)) {
      const oldVal = (dbRec as unknown as Record<string, StoredValue>)[col] ?? null
      if (!importValuesEqual(col, oldVal, newVal)) {
        const field = fields.find((f) => sqlColumnFor(f) === col)
        audits.push({
          userId: user.id, userName: user.name, action: 'RECORD_UPDATE', entity: 'RECORD',
          entityId: dbRec.id, fieldName: field?.displayName || col,
          oldValue: fmt(oldVal), newValue: fmt(newVal),
          source: 'EXCEL', ip: meta.ip, userAgent: meta.userAgent,
        })
      }
    }
    const existingDyn = await tx.misValue.findMany({ where: { recordId: dbRec.id } })
    const dynById = new Map(existingDyn.map((v) => [v.fieldId, v]))
    for (const [fieldId, newVal] of dyn.entries()) {
      const old = dynById.get(fieldId)
      const oldVal = old ? (old.valueText ?? old.valueNumber ?? old.valueDate ?? old.valueBool ?? null) as StoredValue : null
      if (!valuesEqual(oldVal, newVal)) {
        const field = fields.find((f) => f.id === fieldId)
        audits.push({
          userId: user.id, userName: user.name, action: 'RECORD_UPDATE', entity: 'RECORD',
          entityId: dbRec.id, fieldName: field?.displayName || fieldId,
          oldValue: fmt(oldVal), newValue: fmt(newVal),
          source: 'EXCEL', ip: meta.ip, userAgent: meta.userAgent,
        })
      }
    }

    // values already match the database (e.g. a concurrent edit landed the same
    // change between preview and confirm) — no write, count as unchanged
    if (audits.length === 0) {
      if (formulaOutcomes.length > 0) {
        await persistImportedFormulas(tx, dbRec.id, formulaOutcomes, user)
      }
      result.unchanged++
      result.skipped++
      return { ok: true, unchanged: true }
    }

    // identity follows the file — recompute keys from the final core values
    const keys = computeRecordKeys(core)

    let updated: { count: number }
    try {
      updated = await tx.misRecord.updateMany({
        where: { id: dbRec.id, version: dbRec.version },
        data: {
          ...core, businessKey: keys.businessKey, lineKey: keys.lineKey,
          ...deliveryPatchFor(row, dbRec), version: dbRec.version + 1, updatedBy: user.name,
        },
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConcurrentDuplicateError('Another record already holds this shipment identity (LR No + Invoice + Party + material line) — resolve the duplicate first')
      }
      throw err
    }
    if (updated.count === 0) {
      failRow(row, 'Concurrent modification — record was saved by someone else')
      return { ok: false, reason: 'Concurrent modification — record was saved by someone else' }
    }
    for (const [fieldId, newVal] of dyn.entries()) {
      if (newVal == null) {
        await tx.misValue.deleteMany({ where: { recordId: dbRec.id, fieldId } })
      } else {
        await tx.misValue.upsert({
          where: { recordId_fieldId: { recordId: dbRec.id, fieldId } },
          update: dynRow(fieldId, dbRec.id, newVal) as never,
          create: dynRow(fieldId, dbRec.id, newVal),
        })
      }
    }
    await persistImportedFormulas(tx, dbRec.id, formulaOutcomes, user)
    await tx.auditLog.createMany({ data: audits.map((a) => auditRow(a)) })
    result.updated++
    result.applied++
    return { ok: true }
  }

  const createOneRow = async (tx: Tx, row: ImportRowAnalysis) => {
    const core: Record<string, StoredValue> = {}
    const dyn = new Map<string, StoredValue>()
    for (const field of fields) {
      if (field.isSystem) continue
      const raw = row.values[field.fieldKey]
      const res = coerceValue(field, raw)
      if (!res.ok) { failRow(row, res.error || `${field.displayName}: invalid value`); return { ok: false, reason: res.error } }
      if (field.required && res.value == null) {
        const reason = `${field.displayName} is required`
        failRow(row, reason)
        return { ok: false, reason }
      }
      const col = sqlColumnFor(field)
      if (col) core[col] = res.value
      else dyn.set(field.id, res.value)
    }
    // ---- formulas: evaluate in sheet context, override cached values ----
    const formulaOutcomes = evalRowFormulas(row)
    for (const o of formulaOutcomes) {
      if (!o.field) continue
      const col = sqlColumnFor(o.field)
      if (col) core[col] = o.value
      else dyn.set(o.field.id, o.value)
    }
    // derived columns: never nulled from a file — the delivery patch re-derives
    dropNullDerived(core)
    // measurement: store the canonical unit (idempotent — preview already
    // normalized, but apply never trusts the payload)
    if (typeof core.measurement === 'string') core.measurement = normalizeMeasurement(core.measurement)

    // composite business identity — carries the DB unique constraint
    const keys = computeRecordKeys(core)

    let created
    try {
      created = await tx.misRecord.create({
        data: {
          ...core, businessKey: keys.businessKey, lineKey: keys.lineKey,
          ...deliveryPatchFor(row, null), createdBy: user.name, updatedBy: user.name,
        },
      })
    } catch (err) {
      // A concurrent import created the same shipment line between preview and
      // confirm — the unique constraint is the final guard. Never a second record.
      // (Rethrown as a domain error so the caller rolls back its SAVEPOINT —
      // PostgreSQL aborts the rest of the transaction after a failed statement.)
      if (isUniqueViolation(err)) {
        throw new ConcurrentDuplicateError('Duplicate — this shipment line was imported concurrently')
      }
      throw err
    }
    if (dyn.size > 0) {
      await tx.misValue.createMany({ data: [...dyn.entries()].map(([fieldId, v]) => dynRow(fieldId, created.id, v)) })
    }
    await persistImportedFormulas(tx, created.id, formulaOutcomes, user)
    await tx.auditLog.createMany({
      data: [{
        userId: user.id, userName: user.name, action: 'RECORD_CREATE', entity: 'RECORD',
        entityId: created.id, source: 'EXCEL' as const, ip: meta.ip, userAgent: meta.userAgent,
        newValue: row.values.lrNo != null ? `LR ${row.values.lrNo} • ${String(row.values.partyName ?? '').slice(0, 60)}` : 'imported record',
      }].map((a) => auditRow(a)),
    })
    result.created++
    result.applied++
    return { ok: true }
  }

  await db.$transaction(
    async (tx) => {
      // 1. new rows (insert; the unique constraint is the race-safe final guard)
      for (const idx of input.newRows) {
        const row = byRowIndex.get(idx)
        if (!row || row.kind !== 'NEW') continue
        try {
          await savepointWork(tx, `imp_new_${idx}`, () => createOneRow(tx, row))
        } catch (err) {
          if (err instanceof ConcurrentDuplicateError) {
            result.duplicates++
            result.skipped++
            continue
          }
          throw err
        }
      }
      // 2. changed rows (version-guarded updates that preserve the record id)
      for (const idx of input.changedRows) {
        const row = byRowIndex.get(idx)
        if (!row || row.kind !== 'CHANGED' || !row.recordId) continue
        try {
          await savepointWork(tx, `imp_chg_${idx}`, () => applyOneRow(tx, row, false))
        } catch (err) {
          if (err instanceof ConcurrentDuplicateError) {
            failRow(row, err.message)
            continue
          }
          throw err
        }
      }
      // 3. conflicts — only apply when user chose "use my value"
      for (const row of rows) {
        if (row.kind !== 'CONFLICT' || !row.recordId) continue
        const resolution = input.resolutions[row.recordId]
        if (resolution === 'mine') {
          try {
            await savepointWork(tx, `imp_cfl_${row.recordId}`, () => applyOneRow(tx, row, true))
          } catch (err) {
            if (err instanceof ConcurrentDuplicateError) {
              failRow(row, err.message)
              continue
            }
            throw err
          }
          result.conflictsResolvedMine++
        } else {
          result.conflictsResolvedTheirs++
          result.skipped++
        }
      }
      // 4. deletions (explicit opt-in only — records missing from the file are NEVER deleted)
      for (const id of input.deletions) {
        const rec = await tx.misRecord.findUnique({ where: { id } })
        if (!rec || rec.deletedAt) continue
        // businessKey released on delete — must not block re-importing this line
        await tx.misRecord.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.name, businessKey: null } })
        await tx.auditLog.createMany({
          data: [auditRow({
            userId: user.id, userName: user.name, action: 'RECORD_DELETE', entity: 'RECORD', entityId: id,
            oldValue: `LR ${rec.lrNo ?? '—'} • ${rec.partyName ?? ''}`.trim(),
            source: 'EXCEL', ip: meta.ip, userAgent: meta.userAgent,
          })],
        })
        result.deleted++
        result.applied++
      }
      // 5. rows classified UNCHANGED / DUPLICATE at preview — not written.
      //    In-file duplicates are reported in the result so the summary matches
      //    what the preview promised (concurrent-import dups add on below).
      result.unchanged += rows.filter((r) => r.kind === 'UNCHANGED').length
      result.duplicates += rows.filter((r) => r.kind === 'DUPLICATE').length
      result.skipped += rows.filter((r) => r.kind === 'UNCHANGED' || r.kind === 'DUPLICATE').length
      // 6. import summary audit entry
      await tx.auditLog.createMany({
        data: [auditRow({
          userId: user.id, userName: user.name, action: 'IMPORT', entity: 'IMPORT', entityId: job.id,
          newValue: `${job.fileName} — ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.duplicates} duplicates, ${result.failed} failed, ${result.deleted} deleted`,
          source: 'EXCEL', ip: meta.ip, userAgent: meta.userAgent,
        })],
      })
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    },)

  await db.importJob.update({
    where: { id: job.id },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      result: JSON.stringify(result),
    },
  })

  await emitRealtime({
    type: 'import_applied',
    count: result.applied,
    by: user.name,
    source: 'EXCEL',
    detail: `${result.created} new • ${result.updated} updated • ${result.unchanged} unchanged • ${result.duplicates} duplicates`,
  })

  return result
}

function dynRow(fieldId: string, recordId: string, v: StoredValue) {
  if (v instanceof Date) return { fieldId, recordId, valueDate: v }
  if (typeof v === 'number') return { fieldId, recordId, valueNumber: v }
  if (typeof v === 'boolean') return { fieldId, recordId, valueBool: v }
  if (typeof v === 'string') return { fieldId, recordId, valueText: v }
  return { fieldId, recordId }
}

/** Derive delivery fields for an imported row (auto-sync on import). */
function deliveryPatchFor(
  row: ImportRowAnalysis,
  existing: { trackingId: string | null; liveStatus: string | null } | null
): Record<string, unknown> {
  const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null
    if (v instanceof Date) return v
    const d = new Date(String(v))
    return isNaN(d.getTime()) ? null : d
  }
  const trackingIdProvided = (row.values.trackingId as string | null)?.toString().trim() || ''
  return computeDeliveryPatch({
    deliveryStatus: (row.values.deliveryStatus as string) ?? null,
    podStatus: (row.values.podStatus as string) ?? null,
    actualDeliveryDate: toDate(row.values.actualDeliveryDate),
    dispatchDate: toDate(row.values.dispatchDate),
    dispatchVehicle: (row.values.dispatchVehicle as string) ?? null,
    lrNo: row.values.lrNo != null ? Number(row.values.lrNo) : null,
    trackingId: trackingIdProvided !== '' ? trackingIdProvided : existing?.trackingId ?? null,
    liveStatus: existing?.liveStatus ?? null,
  }) as unknown as Record<string, unknown>
}

type FormulaOutcomeRow = { fieldKey: string; value: StoredValue; cached: string; formula: string }

/** Persist imported cell formulas (upsert per record+field). */
async function persistImportedFormulas(
  tx: Tx,
  recordId: string,
  outcomes: FormulaOutcomeRow[],
  user: SessionUser
): Promise<void> {
  for (const o of outcomes) {
    await tx.misFormula.upsert({
      where: { recordId_fieldKey: { recordId, fieldKey: o.fieldKey } },
      update: { formula: o.formula, cachedValue: o.cached, updatedBy: user.name },
      create: {
        recordId, fieldKey: o.fieldKey, formula: o.formula,
        cachedValue: o.cached, createdBy: user.name, updatedBy: user.name,
      },
    })
  }
}

function auditRow(a: AuditEntryInput) {
  return {
    userId: a.userId ?? null,
    userName: a.userName ?? null,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId ?? null,
    fieldName: a.fieldName ?? null,
    oldValue: a.oldValue?.slice(0, 2000) ?? null,
    newValue: a.newValue?.slice(0, 2000) ?? null,
    source: a.source ?? 'EXCEL',
    ip: a.ip ?? null,
    userAgent: a.userAgent?.slice(0, 300) ?? null,
  }
}

function fmt(v: StoredValue | undefined | null): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}
