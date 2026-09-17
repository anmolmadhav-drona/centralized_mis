// Distinct-value suggestions — powers the Add/Edit record dialog's
// "type a few letters, pick an existing value" comboboxes (party names,
// destinations, vehicle numbers…). Values are ranked by how often they are
// used in the live MIS so the most common entries surface first.
//
// SAFETY: the column name comes from the DB-backed field registry
// (CORE_COLUMNS whitelist); the query text is a bound LIKE parameter with
// escaped wildcards. SQL-injection safe by construction. Portable
// SQLite ↔ PostgreSQL (LOWER() on both sides keeps matching case-insensitive
// on either engine — PostgreSQL LIKE is case-sensitive by default).
import { rawQuery } from '@/lib/db'
import { ApiError } from '@/lib/api'
import { getFieldMap, sqlColumnFor, TYPE_TRAITS } from '@/lib/services/fields'

export interface Suggestion {
  value: string
  count: number
}

export const SUGGEST_LIMIT_DEFAULT = 8
export const SUGGEST_LIMIT_MAX = 20

/** Escape LIKE wildcards so user input matches literally */
function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`)
  return `%${escaped}%`
}

/**
 * Top distinct values for a text-ish field, filtered by an optional query
 * substring, ordered by usage frequency (then alphabetically).
 *
 * Core fields read from their MisRecord column; dynamic (EAV) fields read
 * from MisValue.valueText. Only TEXT / LONG_TEXT / DROPDOWN fields are
 * suggestable — numbers and dates are not free-typed in the form.
 */
export async function suggestValues(fieldKey: string, q: string, limit: number): Promise<Suggestion[]> {
  const fields = await getFieldMap()
  const field = fields.get(fieldKey)
  if (!field || field.isSystem || !field.active) {
    throw new ApiError(400, 'Unknown field.')
  }
  if (!TYPE_TRAITS[field.dataType].text) {
    throw new ApiError(400, 'Suggestions are only available for text fields.')
  }

  const pattern = likePattern(q.trim())
  const coreCol = sqlColumnFor(field)

  if (coreCol) {
    const rows = await rawQuery<Array<{ value: string | null; count: number | bigint }>>(
      `SELECT "${coreCol}" AS value, COUNT(*) AS count
         FROM "MisRecord"
        WHERE "deletedAt" IS NULL
          AND "${coreCol}" IS NOT NULL AND "${coreCol}" != ''
          AND LOWER("${coreCol}") LIKE LOWER(?) ESCAPE '\\'
        GROUP BY "${coreCol}"
        ORDER BY COUNT(*) DESC, "${coreCol}" ASC
        LIMIT ?`,
      pattern,
      limit
    )
    return rows.map((r) => ({ value: String(r.value), count: Number(r.count) }))
  }

  // dynamic EAV field → MisValue.valueText
  const rows = await rawQuery<Array<{ value: string | null; count: number | bigint }>>(
    `SELECT v."valueText" AS value, COUNT(*) AS count
       FROM "MisValue" v
       JOIN "MisField" f ON v."fieldId" = f."id"
       JOIN "MisRecord" r ON v."recordId" = r."id"
      WHERE f."fieldKey" = ?
        AND r."deletedAt" IS NULL
        AND v."valueText" IS NOT NULL AND v."valueText" != ''
        AND LOWER(v."valueText") LIKE LOWER(?) ESCAPE '\\'
      GROUP BY v."valueText"
      ORDER BY COUNT(*) DESC, v."valueText" ASC
      LIMIT ?`,
    fieldKey,
    pattern,
    limit
  )
  return rows.map((r) => ({ value: String(r.value), count: Number(r.count) }))
}
