// Composite business identity for MIS records — the backbone of the
// Excel-import duplicate-prevention system.
//
// BUSINESS KEY (shipment identity, per the import specification):
//   normalize(LR No.) + SEP + normalize(Invoice Number) + SEP + normalize(Party Name)
//
// LINE KEY (line discriminator):
//   normalize(Material Details) + SEP + bucket + SEP + totalQuantity
//     + SEP + normalizeMeasurement(measurement)
// Quantity is a MAGNITUDE paired with a unit (measurement): the same
// magnitude in different units is a different line — "Chemical|10|100|LTR" and
// "Chemical|10|100|KG" must NOT collapse to one identity. Measurement is
// canonicalized (case/space folded, alias-mapped) via normalizeMeasurement so
// the line key stays deterministic and normalization-safe.
// PTL shipments legitimately carry MULTIPLE lines under one business key
// (same LR + Invoice + Party, different material/quantity) — 44 such groups
// exist in the production baseline. The line key is what makes each stored
// record unique; the pair (businessKey, lineKey) carries the DB UNIQUE
// constraint.
//
// This module is intentionally dependency-free (no db, no Next): it is used
// by API routes, the import pipeline, the record mutations, backfill scripts
// and unit tests alike. (normalizeMeasurement is likewise pure.)

import { normalizeMeasurement } from './measurement'

/** field separator — whitespace collapse removes \n from every part, so it can never occur inside one */
const SEP = '\n'

export interface RecordKeyValues {
  lrNo?: unknown
  invoiceNumber?: unknown
  partyName?: unknown
  materialDetails?: unknown
  bucket?: unknown
  totalQuantity?: unknown
  measurement?: unknown
}

export interface RecordKeys {
  /** normalized "LR|Invoice|Party" composite; null when any identity part is missing */
  businessKey: string | null
  /** normalized "material|bucket|qty" line discriminator; never null */
  lineKey: string
}

/** Collapse all whitespace runs to single spaces and trim. */
function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Numeric canonicalization: 1301, "1301", " 1301 ", "01301" → "1301".
 *  (LR numbers are stored as INTEGER — leading zeros are not representable
 *  in this system, so they cannot be meaningful for identity.) */
function toIntString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : null
  if (typeof v === 'string') {
    const s = collapseSpaces(v)
    if (s === '') return null
    if (/^-?\d+$/.test(s)) return String(parseInt(s, 10))
    return s
  }
  return String(v)
}

/** LR No. — canonical integer string (see toIntString). */
export function normalizeLrNo(v: unknown): string | null {
  return toIntString(v)
}

/** Invoice Number — trim, collapse whitespace, uppercase. Numeric Excel cells
 *  (543965) and their string form ("543965") resolve identically. */
export function normalizeInvoice(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : null
  const s = collapseSpaces(String(v))
  return s === '' ? null : s.toUpperCase()
}

/** Party Name — trim, collapse whitespace, uppercase. Comparison only — the
 *  stored display value keeps its original formatting. Legal suffixes (LTD,
 *  PVT, LLP …) are deliberately NOT stripped: "ABC INDUSTRIES LTD." and
 *  "ABC INDUSTRIES" remain different parties. No fuzzy matching, ever. */
export function normalizePartyName(v: unknown): string | null {
  if (v == null) return null
  const s = collapseSpaces(String(v))
  return s === '' ? null : s.toUpperCase()
}

/** Material Details — normalized line-discriminator part. */
export function normalizeMaterial(v: unknown): string {
  if (v == null) return ''
  return collapseSpaces(String(v)).toUpperCase()
}

function numPart(v: unknown): string {
  if (v == null || v === '') return ''
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? String(Math.round(n)) : ''
}

/**
 * Business key = LR No. + Invoice Number + Party Name, normalized.
 * Returns null when ANY identity part is missing — a record without a
 * complete identity cannot participate in duplicate detection and is exempt
 * from the unique constraint.
 */
export function buildBusinessKey(lrNo: unknown, invoiceNumber: unknown, partyName: unknown): string | null {
  const lr = normalizeLrNo(lrNo)
  const inv = normalizeInvoice(invoiceNumber)
  const party = normalizePartyName(partyName)
  if (lr == null || inv == null || party == null) return null
  return [lr, inv, party].join(SEP)
}

/**
 * Line key = Material + Bucket + Quantity + Measurement, normalized.
 * Discriminates the multiple lines of a PTL multi-drop shipment AND keeps
 * same-magnitude/different-unit lines distinct (100 LTR ≠ 100 KG). The
 * measurement part is canonicalized with normalizeMeasurement (a missing unit
 * resolves to the same canonical UNSPECIFIED token, never an assumed LTR).
 * Always returns a string (empty parts are allowed) so it can participate in
 * the composite unique constraint together with a non-null businessKey.
 */
export function buildLineKey(
  materialDetails: unknown,
  bucket: unknown,
  totalQuantity: unknown,
  measurement?: unknown,
): string {
  return [
    normalizeMaterial(materialDetails),
    numPart(bucket),
    numPart(totalQuantity),
    normalizeMeasurement(measurement),
  ].join(SEP)
}

/** Compute both keys from a values map (record row or coerced import row). */
export function computeRecordKeys(v: RecordKeyValues): RecordKeys {
  return {
    businessKey: buildBusinessKey(v.lrNo, v.invoiceNumber, v.partyName),
    lineKey: buildLineKey(v.materialDetails, v.bucket, v.totalQuantity, v.measurement),
  }
}

/** Material part of a line key (for grouping lines by material). */
export function materialOfLineKey(lineKey: string | null | undefined): string {
  if (!lineKey) return ''
  return lineKey.split(SEP)[0] ?? ''
}
