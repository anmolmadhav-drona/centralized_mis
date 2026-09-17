// Value coercion & serialization between client/Excel representations and typed storage
import type { FieldDef } from '@/lib/types'
import { TYPE_TRAITS } from '@/lib/services/fields'

export type StoredValue = string | number | Date | boolean | null

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

/** Parse a date from ISO string / Date / Excel serial-ish input → Date or null.
 *  keepTime: preserve the time-of-day (DATETIME fields); default truncates
 *  to UTC midnight (DATE fields — stable Excel round-trip). */
export function parseDateInput(raw: unknown, keepTime = false): Date | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null
    if (keepTime) return new Date(raw.getTime())
    return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 0, 0, 0))
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial date (days since 1899-12-30)
    if (raw > 20000 && raw < 60000) {
      const ms = Math.round((raw - 25569) * 86400 * 1000)
      if (keepTime) {
        const dFull = new Date(ms)
        return isNaN(dFull.getTime()) ? null : dFull
      }
      const d = new Date(ms)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    }
    return null
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (ISO_DATE_RE.test(s)) {
      if (keepTime && s.length > 10) {
        const dFull = new Date(s)
        return isNaN(dFull.getTime()) ? null : dFull
      }
      const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`)
      return isNaN(d.getTime()) ? null : d
    }
    // dd-mm-yyyy or dd/mm/yyyy
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (m) {
      const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
      return isNaN(d.getTime()) ? null : d
    }
    // dd-MMM-yyyy (e.g. 07-Aug-2026)
    const d2 = new Date(s)
    if (!isNaN(d2.getTime()) && s.match(/\d{1,2}\s*[- ]?[A-Za-z]{3,}\s*[- ]?\d{2,4}/)) {
      return new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate()))
    }
  }
  return null
}

export interface CoerceResult {
  ok: boolean
  value: StoredValue
  error?: string
}

/**
 * Coerce a raw client/Excel value into typed storage for a field.
 * Never throws — returns { ok:false, error } for invalid input.
 */
export function coerceValue(field: FieldDef, raw: unknown): CoerceResult {
  const t = TYPE_TRAITS[field.dataType]
  const empty = raw == null || raw === '' || (typeof raw === 'string' && !raw.trim())

  if (empty) {
    if (field.required) {
      return { ok: false, value: null, error: `${field.displayName} is required` }
    }
    return { ok: true, value: null }
  }

  if (t.boolean) {
    if (typeof raw === 'boolean') return { ok: true, value: raw }
    const s = String(raw).trim().toLowerCase()
    if (['true', 'yes', '1', 'y'].includes(s)) return { ok: true, value: true }
    if (['false', 'no', '0', 'n'].includes(s)) return { ok: true, value: false }
    return { ok: false, value: null, error: `${field.displayName}: expected Yes/No` }
  }

  if (t.date) {
    const d = parseDateInput(raw, field.dataType === 'DATETIME')
    if (!d) return { ok: false, value: null, error: `${field.displayName}: invalid date` }
    return { ok: true, value: d }
  }

  if (field.dataType === 'INTEGER') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''))
    if (!Number.isFinite(n) || !Number.isInteger(Math.round(n * 1e6) / 1e6)) {
      return { ok: false, value: null, error: `${field.displayName}: expected a whole number` }
    }
    return { ok: true, value: Math.round(n) }
  }

  if (field.dataType === 'DECIMAL') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''))
    if (!Number.isFinite(n)) return { ok: false, value: null, error: `${field.displayName}: expected a number` }
    return { ok: true, value: n }
  }

  if (field.dataType === 'DROPDOWN') {
    return { ok: true, value: String(raw).trim() }
  }

  // TEXT / LONG_TEXT
  return { ok: true, value: String(raw).trim() }
}

/** Serialize a stored value for client JSON (dates → yyyy-MM-dd) */
export function serializeValue(field: FieldDef, v: StoredValue): unknown {
  if (v == null) return null
  if (v instanceof Date) {
    const iso = v.toISOString()
    return field.dataType === 'DATE' ? iso.slice(0, 10) : iso
  }
  return v
}

/** Compare two stored values for change detection */
export function valuesEqual(a: StoredValue, b: StoredValue): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a instanceof Date && b instanceof Date) {
    // 1s tolerance — Excel date-serial round-trips lose sub-second precision,
    // which would otherwise classify untouched rows as CHANGED on import
    return Math.abs(a.getTime() - b.getTime()) < 1000
  }
  if (a instanceof Date || b instanceof Date) return false
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  return String(a).trim() === String(b).trim()
}

/** Import change-detection equality. Identity text fields (invoice number,
 *  party name) compare case- and whitespace-insensitively: the composite
 *  business key already treats "SONGOG26/22337" and " songog26/22337 " as the
 *  same shipment, so a case-only variance must not surface as a change (and
 *  must not overwrite the stored display casing on an otherwise-identical row). */
export function importValuesEqual(fieldKey: string, a: StoredValue, b: StoredValue): boolean {
  if (fieldKey === 'invoiceNumber' || fieldKey === 'partyName') {
    if (a == null && b == null) return true
    if (a == null || b == null) return false
    const fold = (v: StoredValue) => String(v).replace(/\s+/g, ' ').trim().toUpperCase()
    return fold(a) === fold(b)
  }
  return valuesEqual(a, b)
}

/** Format a stored value for Excel cell writing */
export function excelValue(field: FieldDef, v: StoredValue): string | number | Date | boolean | null {
  if (v == null) return null
  if (v instanceof Date) return v
  return v as string | number | boolean
}
