// Measurement (unit) normalization for quantity-aware reporting.
//
// Quantity and Measurement are a pair: values may only be aggregated when they
// share the SAME normalized measurement. This helper decides that grouping key.
//
// Design (deliberately NOT fuzzy — see src/lib/services/status-normalizer.ts
// for the fuzzy dropdown matcher, which must NOT be used here): a value is
// canonicalized by case/space folding, then mapped through an explicit alias
// table. Unknown units are preserved as their trimmed, space-collapsed,
// upper-cased form so distinct units stay distinct — no edit-distance matching
// that could collapse unrelated units (e.g. "KG" and "KL") into one.

/** Canonical unit → the set of accepted spellings (lower-cased, space-collapsed). */
const ALIASES: Record<string, string[]> = {
  LTR: ['ltr', 'ltrs', 'l', 'lt', 'lts', 'liter', 'liters', 'litre', 'litres'],
  KG: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  PCS: ['pc', 'pcs', 'piece', 'pieces'],
}

/** Sentinel used for rows that have no measurement recorded. */
export const UNSPECIFIED_MEASUREMENT = 'Unspecified'

// Build a reverse lookup once: accepted spelling → canonical unit.
const CANONICAL_BY_ALIAS: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [canonical, spellings] of Object.entries(ALIASES)) {
    map[canonical.toLowerCase()] = canonical
    for (const s of spellings) map[s] = canonical
  }
  return map
})()

/**
 * Normalize a raw measurement value to a canonical grouping key.
 *
 * - null / empty            → UNSPECIFIED_MEASUREMENT
 * - known unit / alias      → its canonical form (e.g. "liters" → "LTR")
 * - unknown unit            → trimmed, space-collapsed, upper-cased original
 *
 * Case and surrounding/interior whitespace are always folded, so "Liters",
 * "liters", "LITERS" and "  ltr " all resolve to "LTR". Unrelated values are
 * never merged.
 */
export function normalizeMeasurement(raw: unknown): string {
  if (raw == null) return UNSPECIFIED_MEASUREMENT
  const collapsed = String(raw).replace(/\s+/g, ' ').trim()
  if (!collapsed) return UNSPECIFIED_MEASUREMENT
  const key = collapsed.toLowerCase()
  return CANONICAL_BY_ALIAS[key] ?? collapsed.toUpperCase()
}
