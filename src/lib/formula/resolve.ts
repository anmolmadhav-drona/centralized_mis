// Column-name resolution — the formula engine understands the CURRENT field
// registry. "=Bucket*3", "=bucket*3", "=Loading Charges*3", "=LOADINGCHARGES*3"
// and "=LOADING CHARGES*3" all resolve to the same fieldKey.
import type { FieldDef } from '@/lib/types'

export interface ColumnResolver {
  /** name → fieldKey (case-insensitive, multi-variant) */
  resolve(name: string): string | null
  /** all known column names (for autocomplete / validation hints) */
  names(): string[]
}

export function buildColumnResolver(fields: FieldDef[]): ColumnResolver {
  // longest aliases first so "Total Quantity in Ltrs" wins over "Quantity"
  const index = new Map<string, string>()
  const aliasesOf = (f: FieldDef) => [
    f.fieldKey,
    f.displayName,
    f.fieldName,
    f.displayName.replace(/\s+/g, ''),
    f.fieldName.replace(/\s+/g, ''),
  ]
  const sorted = [...fields].sort((a, b) => {
    const la = Math.max(...aliasesOf(a).map((s) => s.length))
    const lb = Math.max(...aliasesOf(b).map((s) => s.length))
    return lb - la
  })
  for (const f of sorted) {
    if (f.isSystem) continue
    for (const alias of aliasesOf(f)) {
      const key = alias.trim().toLowerCase()
      if (key && !index.has(key)) index.set(key, f.fieldKey)
    }
  }
  return {
    resolve(name: string) {
      const trimmed = name.trim()
      return index.get(trimmed.toLowerCase()) ?? index.get(trimmed.replace(/\s+/g, '').toLowerCase()) ?? null
    },
    names() {
      return [...index.keys()]
    },
  }
}

/** String-literal spans in a formula body (so replacements skip them). */
function stringSpans(s: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let i = 0
  while (i < s.length) {
    const q = s[i]
    if (q === '"' || q === "'") {
      const start = i
      i++
      while (i < s.length) {
        if (s[i] === q) {
          if (i + 1 < s.length && s[i + 1] === q) { i += 2; continue }
          i++
          break
        }
        i++
      }
      spans.push([start, i])
      continue
    }
    i++
  }
  return spans
}

const inSpans = (idx: number, spans: Array<[number, number]>) => spans.some(([a, b]) => idx >= a && idx < b)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Normalize a raw formula body: rewrite multi-word column names (display /
 * Excel header) into their fieldKeys so the tokenizer sees single idents.
 * Only text OUTSIDE string literals is rewritten.
 */
export function normalizeFormulaInput(body: string, fields: FieldDef[]): string {
  const spans = stringSpans(body)
  let out = body
  const replacements: Array<{ re: RegExp; key: string }> = []
  for (const f of fields) {
    if (f.isSystem) continue
    for (const alias of [f.displayName, f.fieldName]) {
      if (!alias || !/\s/.test(alias)) continue
      const pattern = escapeRe(alias).replace(/\\ /g, '\\s+').replace(/\s+/g, '\\s+')
      replacements.push({ re: new RegExp(`(^|[^A-Za-z0-9_.])(${pattern})(?![A-Za-z0-9_])`, 'gi'), key: f.fieldKey })
    }
  }
  // longest alias first to avoid partial overlaps
  replacements.sort((a, b) => b.re.source.length - a.re.source.length)
  for (const { re, key } of replacements) {
    out = out.replace(re, (m, p1, p2, offset: number) => (inSpans(offset, spans) ? m : `${p1}${key}`))
  }
  return out
}
