// Record mutations — create / update / delete with optimistic concurrency
// control, field validation, audit trail, realtime notifications, the
// Excel-style formula engine (server-authoritative evaluation) and the
// delivery-status auto-sync.
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import type { FieldDef, MisRecordDto, SessionUser } from '@/lib/types'
import { getFieldMap, invalidateFieldCache, sqlColumnFor, TYPE_TRAITS } from '@/lib/services/fields'
import { coerceValue, valuesEqual, type StoredValue } from '@/lib/services/values'
import { computeRecordKeys } from '@/lib/services/business-key'
import { assertFieldsWritable } from '@/lib/table-access'
import { getRecordDto } from '@/lib/services/records-query'
import { writeAudit, type AuditEntryInput } from '@/lib/services/audit'
import { emitRealtime } from '@/lib/services/realtime'
import { computeDeliveryPatch, touchesDeliverySignals, resolveLiveStatus } from '@/lib/services/delivery'
import {
  compileFormula, evalCompiled, rowLocalResolver, isErr, extractDeps, type EvalResult, type Ast,
} from '@/lib/formula'

/** Prisma unique-constraint violation on (businessKey, lineKey). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

/** Field keys whose values feed the composite business/line identity. */
const IDENTITY_FIELD_KEYS = new Set([
  'lrNo', 'invoiceNumber', 'partyName', 'materialDetails', 'bucket', 'totalQuantityLtrs',
])

function identityConflictError(values: Record<string, unknown>): ApiError {
  const lr = values.lrNo != null ? `LR ${values.lrNo}` : 'this LR'
  const inv = values.invoiceNumber != null ? `invoice ${values.invoiceNumber}` : 'this invoice'
  return new ApiError(
    409,
    `A record for ${lr} • ${inv} • ${String(values.partyName ?? '')} with the same material line already exists — duplicate shipment lines are not allowed.`,
  )
}

export interface ValidationIssue {
  fieldKey: string
  fieldName: string
  message: string
}

/** Validate + coerce a values map against the field registry. */
export function validateValues(
  values: Record<string, unknown>,
  fieldMap: Map<string, FieldDef>,
  opts: { partial: boolean }
): { core: Record<string, StoredValue>; dyn: Map<string, StoredValue>; issues: ValidationIssue[] } {
  const core: Record<string, StoredValue> = {}
  const dyn = new Map<string, StoredValue>()
  const issues: ValidationIssue[] = []

  for (const [key, raw] of Object.entries(values)) {
    const field = fieldMap.get(key)
    if (!field || field.isSystem || !field.active) continue // unknown fields ignored
    const res = coerceValue(field, raw)
    if (!res.ok) {
      issues.push({ fieldKey: key, fieldName: field.displayName, message: res.error || 'Invalid value' })
      continue
    }
    if (field.required && res.value == null && !opts.partial) {
      issues.push({ fieldKey: key, fieldName: field.displayName, message: `${field.displayName} is required` })
      continue
    }
    const col = sqlColumnFor(field)
    if (col) core[col] = res.value
    else dyn.set(field.id, res.value)
  }
  return { core, dyn, issues }
}

export class VersionConflictError extends Error {
  current: MisRecordDto
  constructor(current: MisRecordDto) {
    super('This record was modified by another user.')
    this.current = current
  }
}

// ------------------------------------------------------------------
// Formula engine — server-side processing of a `formulas` payload
// { fieldKey: "=Bucket*3" | null }  (null → clear the formula)
// ------------------------------------------------------------------
interface FormulaOutcome {
  /** computed value for the field (null when the formula errored) */
  value: StoredValue
  /** JSON for MisFormula.cachedValue */
  cached: string
  /** evaluation error (rendered in the cell) */
  error?: { code: string; message: string }
}

export function evaluateFormulasRowLocal(
  formulas: Record<string, string | null>,
  mergedValues: Record<string, unknown>,
  fields: FieldDef[]
): { outcomes: Map<string, FormulaOutcome>; errors: Array<{ fieldKey: string; fieldName: string; message: string }> } {
  const outcomes = new Map<string, FormulaOutcome>()
  const errors: Array<{ fieldKey: string; fieldName: string; message: string }> = []
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]))

  // dependency-ordered evaluation (formulas may reference each other)
  const pending = new Map<string, string>()
  for (const [k, v] of Object.entries(formulas)) {
    if (v != null && String(v).trim() !== '') pending.set(k, String(v))
  }

  const resolver = rowLocalResolver(mergedValues, fields)
  let rounds = 0
  while (pending.size > 0 && rounds <= pending.size + 1) {
    rounds++
    let progressed = false
    for (const [fieldKey, text] of [...pending.entries()]) {
      const field = fieldByKey.get(fieldKey)
      if (!field) {
        errors.push({ fieldKey, fieldName: fieldKey, message: `Unknown column "${fieldKey}"` })
        pending.delete(fieldKey)
        progressed = true
        continue
      }
      let compiled
      try {
        compiled = compileFormula(text, fields)
      } catch (err) {
        const e = err as { code: string; message: string }
        errors.push({ fieldKey, fieldName: field.displayName, message: e.message })
        outcomes.set(fieldKey, { value: null, cached: JSON.stringify({ ok: false, e: { code: e.code, message: e.message } }), error: { code: e.code, message: e.message } })
        pending.delete(fieldKey)
        progressed = true
        continue
      }
      // direct self-reference → circular
      if (extractDeps(compiled.ast).columns.includes(fieldKey)) {
        const msg = 'Circular reference — this formula depends on itself'
        errors.push({ fieldKey, fieldName: field.displayName, message: msg })
        outcomes.set(fieldKey, { value: null, cached: JSON.stringify({ ok: false, e: { code: '#CYCLE!', message: msg } }), error: { code: '#CYCLE!', message: msg } })
        mergedValues[fieldKey] = null
        pending.delete(fieldKey)
        progressed = true
        continue
      }
      // do all referenced columns have settled values?
      const deps = needsSettling(compiled.ast, pending, fieldKey)
      if (deps) continue // evaluate later (referenced formula not yet computed)
      const result = evalCompiled(compiled, resolver)
      outcomes.set(fieldKey, outcomeOf(result, field))
      // store computed value into mergedValues so later formulas can use it
      mergedValues[fieldKey] = outcomes.get(fieldKey)!.value
      pending.delete(fieldKey)
      progressed = true
    }
    if (!progressed) {
      // circular reference among the pending formulas
      for (const [fieldKey] of pending) {
        const field = fieldByKey.get(fieldKey)
        errors.push({
          fieldKey,
          fieldName: field?.displayName || fieldKey,
          message: 'Circular reference — this formula depends on itself',
        })
        outcomes.set(fieldKey, {
          value: null,
          cached: JSON.stringify({ ok: false, e: { code: '#CYCLE!', message: 'Circular reference — this formula depends on itself' } }),
          error: { code: '#CYCLE!', message: 'Circular reference — this formula depends on itself' },
        })
        mergedValues[fieldKey] = null
      }
      pending.clear()
    }
  }
  return { outcomes, errors }
}

function needsSettling(ast: Ast, pending: Map<string, string>, self: string): boolean {
  const deps = extractDeps(ast)
  return deps.columns.some((c) => c !== self && pending.has(c))
}

function outcomeOf(result: EvalResult, field: FieldDef): FormulaOutcome {
  const v = Array.isArray(result) ? result[0] ?? null : result
  if (isErr(v)) {
    return {
      value: null,
      cached: JSON.stringify({ ok: false, e: { code: v.code, message: v.message } }),
      error: { code: v.code, message: v.message },
    }
  }
  // coerce the computed value to the field's type
  const res = coerceValue(field, v ?? null)
  if (!res.ok) {
    const e = { code: '#VALUE!', message: res.error || 'Formula result does not fit this column' }
    return { value: null, cached: JSON.stringify({ ok: false, e }), error: e }
  }
  return { value: res.value, cached: JSON.stringify({ ok: true, v: res.value instanceof Date ? res.value.toISOString() : res.value }) }
}

// ------------------------------------------------------------------
// CREATE
// ------------------------------------------------------------------
export async function createRecord(
  values: Record<string, unknown>,
  user: SessionUser,
  meta: { source: 'PORTAL' | 'EXCEL' | 'API'; ip?: string | null; userAgent?: string | null; requestId?: string | null },
  formulas?: Record<string, string | null>
): Promise<MisRecordDto> {
  // management-sensitive tables (Vehicle Rate, Loading Charges, …) are
  // ADMIN/MANAGER-only — a restricted-table write is 403 for other roles
  assertFieldsWritable([...Object.keys(values), ...Object.keys(formulas || {})], user.role)
  const fieldMap = await getFieldMap()
  const fields = [...fieldMap.values()]

  // required fields must all be present
  for (const f of fieldMap.values()) {
    if (f.required && !f.isSystem && values[f.fieldKey] == null) {
      throw new ApiError(400, `${f.displayName} is required.`)
    }
  }

  // ---- formulas: evaluate row-locally against the incoming values ----
  let merged = { ...values }
  if (formulas && Object.keys(formulas).length > 0) {
    const { outcomes, errors } = evaluateFormulasRowLocal(formulas, merged, fields)
    if (errors.length > 0) {
      // formulas that FAIL evaluation are stored as error cells, not rejected —
      // except compile errors on required fields
      for (const e of errors) {
        const field = fieldMap.get(e.fieldKey)
        if (field?.required) throw new ApiError(400, `${e.fieldName}: ${e.message}`)
      }
    }
    for (const [fieldKey, outcome] of outcomes) {
      merged[fieldKey] = outcome.value
    }
  }

  const { core, dyn, issues } = validateValues(merged, fieldMap, { partial: false })
  if (issues.length > 0) {
    throw new ApiError(400, issues.map((i) => i.message).join(' • '))
  }

  // ---- delivery auto-sync on create ----
  const deliveryPatch = computeDeliveryPatch({
    deliveryStatus: (merged.deliveryStatus as string) ?? null,
    podStatus: (merged.podStatus as string) ?? null,
    actualDeliveryDate: toDateOrNull(merged.actualDeliveryDate),
    dispatchDate: toDateOrNull(merged.dispatchDate),
    dispatchVehicle: (merged.dispatchVehicle as string) ?? null,
    lrNo: toNumOrNull(merged.lrNo),
    trackingId: (merged.trackingId as string) ?? null,
    liveStatus: null,
  })

  const record = await db.$transaction(async (tx) => {
    // composite business identity (duplicate prevention) — computed from the
    // final values AFTER formula evaluation so it always reflects storage
    const keys = computeRecordKeys(merged)
    let created
    try {
      created = await tx.misRecord.create({
        data: {
          ...core, businessKey: keys.businessKey, lineKey: keys.lineKey,
          ...deliveryPatch, createdBy: user.name, updatedBy: user.name,
        },
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw identityConflictError(merged)
      throw err
    }
    if (dyn.size > 0) {
      await tx.misValue.createMany({
        data: [...dyn.entries()].map(([fieldId, v]) => valueRow(fieldId, created.id, v)),
      })
    }
    if (formulas) {
      await persistFormulas(tx, created.id, formulas, merged, fields, user)
    }
    return created
  })

  await writeAudit([
    {
      userId: user.id, userName: user.name, action: 'RECORD_CREATE', entity: 'RECORD',
      entityId: record.id, newValue: summarize(merged, fieldMap),
      source: meta.source, ip: meta.ip, userAgent: meta.userAgent,
    },
  ])
  await emitRealtime({ type: 'records_created', count: 1, by: user.name, source: meta.source })

  const dto = await getRecordDto(record.id)
  if (!dto) throw new ApiError(500, 'Record was created but could not be read back.')
  return dto
}

// ------------------------------------------------------------------
// UPDATE (optimistic concurrency + formulas + delivery auto-sync)
// ------------------------------------------------------------------
export async function updateRecord(
  id: string,
  expectedVersion: number,
  values: Record<string, unknown>,
  user: SessionUser,
  meta: { source: 'PORTAL' | 'EXCEL' | 'API'; ip?: string | null; userAgent?: string | null; requestId?: string | null },
  formulas?: Record<string, string | null>
): Promise<MisRecordDto> {
  // management-sensitive tables (Vehicle Rate, Loading Charges, …) are
  // ADMIN/MANAGER-only — a restricted-table write is 403 for other roles
  assertFieldsWritable([...Object.keys(values), ...Object.keys(formulas || {})], user.role)
  const fieldMap = await getFieldMap()
  const fields = [...fieldMap.values()]

  // required fields cannot be cleared
  for (const f of fieldMap.values()) {
    if (f.required && values[f.fieldKey] !== undefined && values[f.fieldKey] == null) {
      throw new ApiError(400, `${f.displayName} cannot be empty.`)
    }
  }

  // ---- load current state (values + existing formulas) for evaluation ----
  const existingDto = await getRecordDto(id)
  if (!existingDto) throw new ApiError(404, 'Record not found. It may have been deleted.')

  const merged: Record<string, unknown> = { ...existingDto }
  for (const [k, v] of Object.entries(values)) {
    if (fieldMap.has(k)) merged[k] = v
  }

  // ---- evaluate incoming formulas row-locally ----
  const formulaOutcomes = new Map<string, FormulaOutcome>()
  if (formulas && Object.keys(formulas).length > 0) {
    const { outcomes } = evaluateFormulasRowLocal(formulas, merged, fields)
    for (const [k, o] of outcomes) {
      formulaOutcomes.set(k, o)
      merged[k] = o.value
    }
  }

  // ---- server-side recalc: existing formulas whose inputs changed ----
  // (transitive: when a formula recomputes, formulas depending on IT must
  //  recompute too — iterate until the cascade settles, like a spreadsheet)
  const existingFormulas = await db.misFormula.findMany({ where: { recordId: id } })
  const incomingFormulaKeys = new Set(formulas ? Object.keys(formulas) : [])
  const changedKeys = new Set(Object.keys(values))
  const recalculated = new Map<string, FormulaOutcome>()
  if (existingFormulas.length > 0) {
    const dirty = new Set<string>([...changedKeys, ...formulaOutcomes.keys()])
    let round = 0
    while (dirty.size > 0 && round < existingFormulas.length + 2) {
      round++
      const reEval: Record<string, string | null> = {}
      const consumed = new Set<string>()
      for (const f of existingFormulas) {
        if (incomingFormulaKeys.has(f.fieldKey)) continue // handled above
        if (recalculated.has(f.fieldKey)) continue
        const deps = depsOfFormula(f.formula, fields)
        let affected = false
        for (const k of dirty) {
          if (deps.has(k)) { affected = true; break }
        }
        if (affected) reEval[f.fieldKey] = f.formula
      }
      if (Object.keys(reEval).length === 0) break
      const before = new Map<string, unknown>(Object.entries(merged))
      const { outcomes } = evaluateFormulasRowLocal(reEval, merged, fields)
      for (const [k, o] of outcomes) {
        recalculated.set(k, o)
        merged[k] = o.value
        const prevValue = before.get(k)
        if (!valuesEqual(prevValue == null ? null : (prevValue as StoredValue), o.value)) consumed.add(k)
      }
      // continue the cascade only through fields whose VALUE actually changed
      dirty.clear()
      for (const k of consumed) dirty.add(k)
    }
  }

  // final values = user's plain values + formula-computed values
  const effectiveValues: Record<string, unknown> = { ...values }
  for (const [k, o] of [...formulaOutcomes, ...recalculated]) {
    effectiveValues[k] = o.value
  }

  const { core, dyn, issues } = validateValues(effectiveValues, fieldMap, { partial: true })
  if (issues.length > 0) {
    throw new ApiError(400, issues.map((i) => i.message).join(' • '))
  }

  // ---- delivery auto-sync (when shipment signals changed) ----
  const deliveryChanged = touchesDeliverySignals([...changedKeys, ...formulaOutcomes.keys()])
  let deliveryData: Record<string, unknown> = {}
  if (deliveryChanged) {
    const patch = computeDeliveryPatch({
      deliveryStatus: (merged.deliveryStatus as string) ?? null,
      podStatus: (merged.podStatus as string) ?? null,
      actualDeliveryDate: toDateOrNull(merged.actualDeliveryDate),
      dispatchDate: toDateOrNull(merged.dispatchDate),
      dispatchVehicle: (merged.dispatchVehicle as string) ?? null,
      lrNo: toNumOrNull(merged.lrNo),
      trackingId: (merged.trackingId as string) ?? null,
      liveStatus: (existingDto.liveStatus as string) ?? null,
    }) as unknown as Record<string, unknown>
    deliveryData = patch
  }

  const conflictOrResult = await db.$transaction(async (tx) => {
    const existing = await tx.misRecord.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      throw new ApiError(404, 'Record not found. It may have been deleted.')
    }
    if (existing.version !== expectedVersion) {
      const currentDto = await getRecordDto(id)
      if (currentDto) throw new VersionConflictError(currentDto)
      throw new ApiError(404, 'Record not found.')
    }

    // compute audit diffs BEFORE mutating
    const auditEntries: AuditEntryInput[] = []
    for (const [col, newVal] of Object.entries(core)) {
      const oldVal = (existing as unknown as Record<string, StoredValue>)[col] ?? null
      if (!valuesEqual(oldVal, newVal)) {
        const field = fields.find((f) => sqlColumnFor(f) === col)
        // formula-driven change? show the formula in the audit trail
        const viaFormula = [...formulaOutcomes.keys(), ...recalculated.keys()].find((k) => {
          const f = fieldMap.get(k)
          return f ? sqlColumnFor(f) === col : false
        })
        auditEntries.push({
          userId: user.id, userName: user.name, action: 'RECORD_UPDATE', entity: 'RECORD',
          entityId: id, fieldName: viaFormula ? `${field?.displayName || col} (formula)` : field?.displayName || col,
          oldValue: fmtAudit(oldVal), newValue: fmtAudit(newVal),
          source: meta.source, ip: meta.ip, userAgent: meta.userAgent,
        })
      }
    }

    // dynamic diffs
    const existingDyn = await tx.misValue.findMany({ where: { recordId: id } })
    const dynById = new Map(existingDyn.map((v) => [v.fieldId, v]))
    for (const [fieldId, newVal] of dyn.entries()) {
      const old = dynById.get(fieldId)
      const oldVal = old
        ? (old.valueText ?? old.valueNumber ?? (old.valueDate ?? (old.valueBool ?? null)))
        : null
      if (!valuesEqual(oldVal as StoredValue, newVal)) {
        const field = fields.find((f) => f.id === fieldId)
        auditEntries.push({
          userId: user.id, userName: user.name, action: 'RECORD_UPDATE', entity: 'RECORD',
          entityId: id, fieldName: field?.displayName || fieldId,
          oldValue: fmtAudit(oldVal as StoredValue), newValue: fmtAudit(newVal),
          source: meta.source, ip: meta.ip, userAgent: meta.userAgent,
        })
      }
    }

    // delivery sync audit
    if (deliveryChanged && deliveryData.liveStatus !== existing.liveStatus) {
      auditEntries.push({
        userId: user.id, userName: user.name, action: 'RECORD_UPDATE', entity: 'RECORD',
        entityId: id, fieldName: 'Delivery Status (Live)',
        oldValue: existing.liveStatus ?? null, newValue: String(deliveryData.liveStatus),
        source: meta.source, ip: meta.ip, userAgent: meta.userAgent,
      })
    }

    // formula add/remove audit
    if (formulas) {
      for (const [fieldKey, text] of Object.entries(formulas)) {
        const field = fieldMap.get(fieldKey)
        if (!field) continue
        const prev = existingFormulas.find((f) => f.fieldKey === fieldKey)
        const nextText = text == null || String(text).trim() === '' ? null : String(text)
        if ((prev?.formula ?? null) !== nextText) {
          auditEntries.push({
            userId: user.id, userName: user.name, action: 'RECORD_UPDATE', entity: 'RECORD',
            entityId: id, fieldName: `${field.displayName} (formula)`,
            oldValue: prev?.formula ?? null, newValue: nextText,
            source: meta.source, ip: meta.ip, userAgent: meta.userAgent,
          })
        }
      }
    }

    const hasFormulaWork = !!formulas || recalculated.size > 0
    if (
      auditEntries.length === 0 && dyn.size === 0 && Object.keys(core).length === 0 &&
      !hasFormulaWork
    ) {
      return { changed: false } // no-op save
    }

    // guarded update: only succeeds if version still matches (race-safe).
    // when identity fields change, the composite keys are recomputed so the
    // unique constraint always reflects the stored identity.
    const identityTouched =
      [...changedKeys].some((k) => IDENTITY_FIELD_KEYS.has(k)) ||
      [...formulaOutcomes.keys(), ...recalculated.keys()].some((k) => IDENTITY_FIELD_KEYS.has(k))
    const keyData: { businessKey?: string | null; lineKey?: string | null } =
      identityTouched ? computeRecordKeys(merged) : {}
    let updated: { count: number }
    try {
      updated = await tx.misRecord.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...core, businessKey: keyData.businessKey, lineKey: keyData.lineKey,
          ...deliveryData, version: expectedVersion + 1, updatedBy: user.name,
        },
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw identityConflictError(merged)
      throw err
    }
    if (updated.count === 0) {
      const currentDto = await getRecordDto(id)
      if (currentDto) throw new VersionConflictError(currentDto)
      throw new ApiError(409, 'This record was modified by another user. Please review and try again.')
    }

    // apply dynamic values
    for (const [fieldId, newVal] of dyn.entries()) {
      if (newVal == null) {
        await tx.misValue.deleteMany({ where: { recordId: id, fieldId } })
      } else {
        await tx.misValue.upsert({
          where: { recordId_fieldId: { recordId: id, fieldId } },
          update: valueRow(fieldId, id, newVal) as never,
          create: valueRow(fieldId, id, newVal),
        })
      }
    }

    // ---- persist formulas (incoming + recalculated) ----
    if (formulas) {
      await persistFormulas(tx, id, formulas, merged, fields, user)
    }
    for (const [fieldKey, outcome] of recalculated) {
      await tx.misFormula.upsert({
        where: { recordId_fieldKey: { recordId: id, fieldKey } },
        update: { cachedValue: outcome.cached, updatedBy: user.name },
        create: {
          recordId: id, fieldKey, formula: existingFormulas.find((f) => f.fieldKey === fieldKey)?.formula ?? '',
          cachedValue: outcome.cached, createdBy: user.name, updatedBy: user.name,
        },
      })
    }

    return { changed: true, auditEntries }
  })

  if ('auditEntries' in conflictOrResult && conflictOrResult.changed) {
    await writeAudit(conflictOrResult.auditEntries ?? [])
    await emitRealtime({ type: 'records_updated', count: 1, by: user.name, source: meta.source })
  }

  const dto = await getRecordDto(id)
  if (!dto) throw new ApiError(500, 'Record was updated but could not be read back.')
  return dto
}

// ------------------------------------------------------------------
// BULK UPDATE — one call, per-record optimistic guards (paste / fill /
// client-side recalculation persistence across records)
// ------------------------------------------------------------------
export interface BulkChange {
  id: string
  version: number
  values: Record<string, unknown>
  formulas?: Record<string, string | null>
}

export interface BulkItemResult {
  id: string
  ok: boolean
  record?: MisRecordDto
  conflict?: MisRecordDto
  error?: string
}

export async function bulkUpdateRecords(
  changes: BulkChange[],
  user: SessionUser,
  meta: { source: 'PORTAL' | 'EXCEL' | 'API'; ip?: string | null; userAgent?: string | null; requestId?: string | null }
): Promise<BulkItemResult[]> {
  const results: BulkItemResult[] = []
  for (const change of changes.slice(0, 500)) {
    try {
      const record = await updateRecord(change.id, change.version, change.values, user, meta, change.formulas)
      results.push({ id: change.id, ok: true, record })
    } catch (err) {
      if (err instanceof VersionConflictError) {
        results.push({ id: change.id, ok: false, conflict: err.current })
      } else if (err instanceof ApiError) {
        results.push({ id: change.id, ok: false, error: err.message })
      } else {
        results.push({ id: change.id, ok: false, error: 'Update failed' })
      }
    }
  }
  return results
}

// ------------------------------------------------------------------
// DELETE (soft)
// ------------------------------------------------------------------
export async function deleteRecord(
  id: string,
  user: SessionUser,
  meta: { source: 'PORTAL' | 'EXCEL' | 'API'; ip?: string | null; userAgent?: string | null; requestId?: string | null }
): Promise<void> {
  const existing = await db.misRecord.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) throw new ApiError(404, 'Record not found.')
  await db.misRecord.update({
    where: { id },
    // businessKey released on delete — a soft-deleted row must not hold the
    // shipment identity hostage (would block re-importing the same line)
    data: { deletedAt: new Date(), updatedBy: user.name, businessKey: null },
  })
  await writeAudit([
    {
      userId: user.id, userName: user.name, action: 'RECORD_DELETE', entity: 'RECORD', entityId: id,
      oldValue: `LR ${existing.lrNo ?? '—'} • ${existing.partyName ?? ''}`.trim(),
      source: meta.source, ip: meta.ip, userAgent: meta.userAgent,
    },
  ])
  await emitRealtime({ type: 'records_deleted', count: 1, by: user.name, source: meta.source })
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

async function persistFormulas(
  tx: Tx,
  recordId: string,
  formulas: Record<string, string | null>,
  mergedValues: Record<string, unknown>,
  fields: FieldDef[],
  user: SessionUser
): Promise<void> {
  // compute outcomes again inside the tx for exact cached values
  const { outcomes } = evaluateFormulasRowLocal(formulas, { ...mergedValues }, fields)
  for (const [fieldKey, text] of Object.entries(formulas)) {
    const nextText = text == null || String(text).trim() === '' ? null : String(text)
    if (nextText == null) {
      await tx.misFormula.deleteMany({ where: { recordId, fieldKey } })
      continue
    }
    const outcome = outcomes.get(fieldKey)
    await tx.misFormula.upsert({
      where: { recordId_fieldKey: { recordId, fieldKey } },
      update: { formula: nextText, cachedValue: outcome?.cached ?? null, updatedBy: user.name },
      create: {
        recordId, fieldKey, formula: nextText,
        cachedValue: outcome?.cached ?? null, createdBy: user.name, updatedBy: user.name,
      },
    })
  }
}

function depsOfFormula(formulaText: string, fields: FieldDef[]): Set<string> {
  try {
    const compiled = compileFormula(formulaText, fields)
    return new Set(extractDeps(compiled.ast).columns)
  } catch {
    return new Set()
  }
}

function valueRow(fieldId: string, recordId: string, v: StoredValue) {
  if (v instanceof Date) return { fieldId, recordId, valueDate: v }
  if (typeof v === 'number') return { fieldId, recordId, valueNumber: v }
  if (typeof v === 'boolean') return { fieldId, recordId, valueBool: v }
  if (typeof v === 'string') return { fieldId, recordId, valueText: v }
  return { fieldId, recordId }
}

function fmtAudit(v: StoredValue): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

function summarize(values: Record<string, unknown>, fieldMap: Map<string, FieldDef>): string {
  const lr = values['lrNo']
  const party = values['partyName']
  const parts: string[] = []
  if (lr != null && lr !== '') parts.push(`LR ${lr}`)
  const partyField = fieldMap.get('partyName')
  if (party != null && party !== '') parts.push(String(party).slice(0, 60))
  else void partyField
  return parts.join(' • ') || 'new record'
}

function toDateOrNull(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return v
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

function toNumOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export { invalidateFieldCache, resolveLiveStatus }
