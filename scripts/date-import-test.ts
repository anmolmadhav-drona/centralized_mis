// Regression test: Excel DATE timezone/rounding shift in the import path.
//
// Runs the SAME SheetJS settings as the real importer against the actual
// uploaded workbook, and asserts the coerced DATE matches the calendar day the
// cell displays — not shifted back a day. Run under a positive-offset zone to
// reproduce the production bug:
//   TZ=Asia/Kolkata bun scripts/date-import-test.ts
import * as XLSX from 'xlsx'
import { existsSync, readFileSync } from 'fs'
import { parseDateInput, coerceValue } from '../src/lib/services/values'
import type { FieldDef } from '../src/lib/types'

let PASS = 0
let FAIL = 0
function ok(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) { PASS++; console.log(`  ✓ ${name}`) }
  else { FAIL++; console.log(`  ✗ ${name} — expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`) }
}

const lrDateField = (): FieldDef => ({
  id: 'fld-lrDate', fieldKey: 'lrDate', fieldName: 'LR DATE', displayName: 'LR Date', dataType: 'DATE',
  required: true, defaultValue: null, options: null, position: 0, isCore: true, isSystem: false, active: true, width: null,
})
const dateTimeField: FieldDef = { ...lrDateField(), fieldKey: 'lastStatusUpdate', dataType: 'DATETIME' }

console.log(`(process TZ offset = ${new Date().getTimezoneOffset()} min; production bug reproduces at negative offsets, e.g. IST -330)`)

// ----------------------------------------------------------------------------
// 1) REAL workbook via the importer's exact SheetJS settings (primary proof).
//    The coerced day must equal the day the cell text (.w) displays.
// ----------------------------------------------------------------------------
const WB_PATH = './upload/Updated MIS NPL SONIPAT.xlsx'
console.log('== Real SheetJS parse of the actual workbook ==')
if (!existsSync(WB_PATH)) {
  console.log(`  ! workbook not found at ${WB_PATH} — skipping real-file assertions (synthetic case below still runs)`)
} else {
  const wb = XLSX.read(readFileSync(WB_PATH), { cellDates: true, type: 'buffer', cellFormula: true })
  const sheetName = wb.SheetNames.includes('MIS') ? 'MIS' : wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  // locate LR DATE column in rows 0..4
  let headerRow = -1, lrDateCol = -1
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').trim().toLowerCase())
    const d = cells.findIndex((c) => c === 'lr date')
    if (d >= 0) { headerRow = i; lrDateCol = d; break }
  }
  ok('LR DATE column located', lrDateCol >= 0, true)

  // parse the cell's own display text (m/d/yy) → canonical yyyy-mm-dd
  const expectedFromCellText = (w: string | undefined): string | null => {
    if (!w) return null
    const m = w.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (!m) return null
    const yy = +m[3]; const year = yy < 100 ? 2000 + yy : yy
    return `${year}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`
  }

  let checked = 0, shifted = 0
  for (let r = headerRow + 1; r < rows.length && checked < 20; r++) {
    const raw = rows[r]?.[lrDateCol]
    if (!(raw instanceof Date)) continue
    const addr = XLSX.utils.encode_cell({ r, c: lrDateCol })
    const cell = (sheet as Record<string, unknown>)[addr] as { w?: string } | undefined
    const expectedDay = expectedFromCellText(cell?.w)
    if (!expectedDay) continue
    checked++
    const res = coerceValue(lrDateField(), raw)
    const gotDay = res.ok && res.value instanceof Date ? res.value.toISOString().slice(0, 10) : String(res.value)
    if (gotDay !== expectedDay) shifted++
    if (checked <= 3) ok(`cell "${cell?.w}" → ${expectedDay} (raw ${raw.toISOString()})`, gotDay, expectedDay)
  }
  ok(`all ${checked} sampled LR Date cells match the displayed day (0 shifted)`, shifted, 0)
}

// ----------------------------------------------------------------------------
// 2) Faithful reproduction of the SheetJS value shape, file-independent.
//    SheetJS yields the intended day at LOCAL midnight minus a few seconds
//    (base-date float rounding). We reproduce exactly that: 15-Sep local
//    midnight − 10s. At a negative offset this is 14-Sep 23:59:5x local.
// ----------------------------------------------------------------------------
console.log('== SheetJS-shaped value (local midnight − 10s) coerces to the intended day ==')
const sheetjsLike = (y: number, m1: number, d: number) => new Date(new Date(y, m1 - 1, d, 0, 0, 0).getTime() - 10_000)
for (const [y, m1, d] of [[2026, 9, 15], [2026, 8, 7], [2026, 1, 1], [2026, 12, 31]] as const) {
  const iso = `${y}-${String(m1).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`
  const res = coerceValue(lrDateField(), sheetjsLike(y, m1, d))
  ok(`${y}-${m1}-${d} SheetJS-shaped → ${iso}`,
    res.ok && res.value instanceof Date ? res.value.toISOString() : String(res.value), iso)
}
// explicit production scenario
ok('15-Sep-2026 persists as 2026-09-15 (NOT 2026-09-14)',
  parseDateInput(sheetjsLike(2026, 9, 15), false)?.toISOString(), '2026-09-15T00:00:00.000Z')

// ----------------------------------------------------------------------------
// 3) DATETIME unchanged; other input forms still correct.
// ----------------------------------------------------------------------------
console.log('== DATETIME unchanged + other DATE input forms ==')
const ts = new Date('2026-09-15T13:45:30.000Z')
ok('DATETIME keeps exact timestamp',
  (() => { const r = coerceValue(dateTimeField, ts); return r.ok && r.value instanceof Date ? r.value.toISOString() : String(r.value) })(),
  '2026-09-15T13:45:30.000Z')
ok('ISO "2026-09-15" → UTC midnight', parseDateInput('2026-09-15', false)?.toISOString(), '2026-09-15T00:00:00.000Z')
ok('dd-mm-yyyy "15-09-2026" → 2026-09-15', parseDateInput('15-09-2026', false)?.toISOString(), '2026-09-15T00:00:00.000Z')
ok('empty → null', parseDateInput('', false), null)
ok('invalid Date → null', parseDateInput(new Date('nope'), false), null)

console.log('')
console.log(`RESULT: ${PASS} pass / ${FAIL} fail`)
process.exit(FAIL > 0 ? 1 : 0)
