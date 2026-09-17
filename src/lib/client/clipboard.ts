// Excel clipboard exchange helpers.
//
// The grid talks TSV (tab-separated values) with the system clipboard —
// exactly the format Excel itself uses — so multi-cell copy/paste works
// between Excel and the portal in both directions.
//
// The INTERNAL clipboard additionally remembers per-cell formulas so that
// pasting inside the portal preserves formulas (like Excel does), while
// pasting into external apps receives computed values (also like Excel).

export interface ClipCell {
  /** display token written to TSV (computed value for formula cells) */
  text: string
  /** formula source when the copied cell holds a formula */
  formula?: string
}

/** Build a TSV block from a cell matrix (Excel-compatible, with quoting). */
export function buildTsv(cells: ClipCell[][]): string {
  return cells.map((row) => row.map(csvField).join('\t')).join('\n')
}

/** Parse a TSV block (Excel-compatible quoting aware) into raw tokens. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue }
    if (ch === '\t') { row.push(field); field = ''; i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  row.push(field)
  rows.push(row)
  // drop fully-empty trailing rows (trailing newline artifacts)
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return rows
}

function csvField(c: ClipCell): string {
  const t = c.text
  if (t.includes('\t') || t.includes('\n') || t.includes('"')) {
    return `"${t.replace(/"/g, '""')}"`
  }
  return t
}

export type PasteToken =
  | { kind: 'formula'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'empty' }

/** Interpret one pasted token the way Excel would. */
export function interpretToken(raw: string): PasteToken {
  const s = raw.trim()
  if (s === '') return { kind: 'empty' }
  if (s.startsWith('=')) return { kind: 'formula', text: s }
  const n = Number(s.replace(/,/g, ''))
  if (s !== '' && Number.isFinite(n)) return { kind: 'number', value: n }
  return { kind: 'text', value: s }
}

/** Excel-style numeric series continuation.
 *  • ≥2 numbers with a constant delta → arithmetic series (1,2,3 → 4,5,6)
 *  • single number or irregular numbers → copy verbatim ("drag copy")
 *  • any text in the column → copy verbatim */
export function fillSeries(source: string[], count: number): string[] {
  const out: string[] = []
  if (source.length === 0) return out
  const nums = source.map((s) => Number(s))
  const allNumeric = source.every((s, i) => s.trim() !== '' && Number.isFinite(nums[i]))
  if (source.length >= 2 && allNumeric) {
    const delta = nums[1] - nums[0]
    const uniform = nums.every((n, i) => i === 0 || Math.abs(n - nums[i - 1] - delta) < 1e-9)
    if (uniform && delta !== 0) {
      for (let i = 0; i < count; i++) {
        const v = nums[nums.length - 1] + delta * (i + 1)
        out.push(fmtSeriesNum(v, source))
      }
      return out
    }
  }
  // copy (with wrap-around tiling for multi-row source blocks)
  for (let i = 0; i < count; i++) out.push(source[i % source.length])
  return out
}

function fmtSeriesNum(v: number, source: string[]): string {
  // preserve integer-ness of the source series
  if (source.every((s) => Number.isInteger(Number(s)))) return String(Math.round(v))
  return String(Math.round(v * 1e6) / 1e6)
}

/** Normalize a date-ish token to something the server accepts
 *  (ISO yyyy-mm-dd). Handles Excel display formats like 09-01-26 —
 *  the MIS workbook displays dates as mm-dd-yy, so 2-digit-year tokens
 *  are interpreted month-first (day-first forms go to the server). */
export function normalizeDateToken(raw: string): string {
  const s = raw.trim()
  if (s === '') return ''
  // 2-digit year forms: mm-dd-yy / mm/dd/yy (workbook display format)
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/)
  if (m) {
    const yy = +m[3]
    const year = yy < 70 ? 2000 + yy : 1900 + yy
    const mm = String(+m[1]).padStart(2, '0')
    const dd = String(+m[2]).padStart(2, '0')
    return `${year}-${mm}-${dd}`
  }
  return s // ISO / dd-mm-yyyy / dd-MMM-yyyy — server handles these
}
