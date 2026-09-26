// Focused tests for MULTI-SHEET Excel import (parse/detect/combine stage).
// Uses the pure, DB-free collectImportRows()/detectMisSheets() with in-memory
// SheetJS workbooks. Run under IST so the date case reproduces the real shift:
//   TZ=Asia/Kolkata bun scripts/multi-sheet-import-test.ts
import * as XLSX from 'xlsx'
import { collectImportRows, detectMisSheets } from '../src/lib/excel/import'
import type { FieldDef, FieldDataType } from '../src/lib/types'

let PASS = 0
let FAIL = 0
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { PASS++; console.log(`  ✓ ${name}`) }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`) }
}

const F = (fieldKey: string, fieldName: string, dataType: FieldDataType = 'TEXT'): FieldDef => ({
  id: `fld-${fieldKey}`, fieldKey, fieldName, displayName: fieldName, dataType,
  required: false, defaultValue: null, options: null, position: 0,
  isCore: true, isSystem: false, active: true, width: null,
})
const FIELDS: FieldDef[] = [
  F('partyName', 'PARTY NAME'), F('destination', 'DESTINATION'), F('invoiceNumber', 'INVOICE NUMBER'),
  F('lrNo', 'LR. NO.', 'INTEGER'), F('lrDate', 'LR DATE', 'DATE'), F('materialDetails', 'MATERIAL DETAILS'),
  F('bucket', 'Bucket', 'INTEGER'), F('totalQuantity', 'TOTAL QUANTITY', 'INTEGER'),
  F('measurement', 'Measurement'), F('deliveryStatus', 'DELIVERY STATUS'),
  F('transporterName', 'TRANSPOTER NAME'), F('loadType', 'LOAD TYPE FTL/PTL'),
]
const STD_HEADERS = FIELDS.map((f) => f.fieldName)

type Rec = { party?: string; dest?: string; invoice?: string; lr?: number; lrDate?: unknown; material?: string; bucket?: number; qty?: number; meas?: string; status?: string }
const stdRow = (o: Rec): unknown[] => [
  o.party ?? 'ABC', o.dest ?? 'Delhi', o.invoice ?? 'INV-500', o.lr ?? 1001, o.lrDate ?? '2026-09-15',
  o.material ?? 'Oil', o.bucket ?? 300, o.qty ?? 6000, o.meas ?? 'LTR', o.status ?? 'Pending', 'Drona', 'PTL',
]
/** AoA sheet: `hr` blank rows before the header row, then header, then data. */
function sheet(hr: number, headers: (string | null)[], data: unknown[][]): XLSX.WorkSheet {
  const aoa: unknown[][] = []
  // filler title rows before the header (a real cell so the row genuinely
  // exists — aoa_to_sheet trims fully-empty leading rows)
  for (let i = 0; i < hr; i++) aoa.push([`title row ${i + 1}`])
  aoa.push(headers)
  for (const d of data) aoa.push(d)
  return XLSX.utils.aoa_to_sheet(aoa as (string | number | boolean | Date | null)[][], { cellDates: true })
}
function wbOf(sheets: Array<{ name: string; ws: XLSX.WorkSheet }>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name)
  return wb
}
const nonMis = (title: string) => sheet(0, ['Report', title], [['generated', 'today'], ['note', 'ignore me']])
const bk = (r: { businessKey: string | null; lineKey: string }) => `${r.businessKey}\u0000${r.lineKey}`

console.log('== 1. One valid MIS sheet (backward compatible) ==')
{
  const wb = wbOf([{ name: 'Sheet1', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 1 }), stdRow({ lr: 2 })]) }])
  const c = collectImportRows(wb, FIELDS)
  ok('one sheet detected', c.sheets.length === 1, `got ${c.sheets.length}`)
  ok('two rows parsed', c.rows.length === 2, `got ${c.rows.length}`)
  ok('sourceSheet set', c.rows.every((r) => r.sourceSheet === 'Sheet1'))
}

console.log('== 2 & 3. Two / three valid sheets combine ==')
{
  const wb2 = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 10 })]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 11 }), stdRow({ lr: 12 })]) },
  ])
  const c2 = collectImportRows(wb2, FIELDS)
  ok('two sheets, 3 rows combined', c2.sheets.length === 2 && c2.rows.length === 3, `${c2.sheets.length}/${c2.rows.length}`)
  const wb3 = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 10 })]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 11 })]) },
    { name: 'West', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 12 })]) },
  ])
  const c3 = collectImportRows(wb3, FIELDS)
  ok('three sheets, 3 rows combined', c3.sheets.length === 3 && c3.rows.length === 3)
}

console.log('== 4 & 5. Non-MIS sheets ignored ==')
{
  const wb4 = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 10 })]) },
    { name: 'Summary', ws: nonMis('Summary') },
  ])
  const c4 = collectImportRows(wb4, FIELDS)
  ok('MIS + Summary → only 1 MIS sheet', c4.sheets.length === 1 && c4.sheets[0].sheetName === 'North')

  const wb5 = wbOf([
    { name: 'Instructions', ws: nonMis('Instructions') },
    { name: 'West', ws: sheet(2, STD_HEADERS, [stdRow({ lr: 20 })]) },
    { name: 'Notes', ws: nonMis('Notes') },
  ])
  const c5 = collectImportRows(wb5, FIELDS)
  ok('MIS + Instructions + Notes → only MIS', c5.sheets.length === 1 && c5.sheets[0].sheetName === 'West')
}

console.log('== 6. Detection is name-independent ==')
{
  const wb = wbOf([
    { name: 'Zone-Q7', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 1 })]) },
    { name: 'random name', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 2 })]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  ok('both sheets detected regardless of name', c.sheets.length === 2)
}

console.log('== 7. Different header row positions ==')
{
  const wb = wbOf([
    { name: 'North', ws: sheet(2, STD_HEADERS, [stdRow({ lr: 1 })]) }, // header at Excel row 3
    { name: 'South', ws: sheet(4, STD_HEADERS, [stdRow({ lr: 2 })]) }, // header at Excel row 5
  ])
  const det = detectMisSheets(wb, FIELDS)
  ok('North header row index 2, South index 4', det[0].headerRowIndex === 2 && det[1].headerRowIndex === 4,
    `${det[0]?.headerRowIndex}/${det[1]?.headerRowIndex}`)
  const c = collectImportRows(wb, FIELDS)
  ok('rows parsed under shifted headers', c.rows.length === 2)
}

console.log('== 8. Different column positions map to same fields ==')
{
  // South uses a different column order (LR in col A) — must still map to lrNo/qty/measurement.
  const southHeaders = ['LR. NO.', 'PARTY NAME', 'DESTINATION', 'INVOICE NUMBER', 'MATERIAL DETAILS', 'Bucket', 'TOTAL QUANTITY', 'Measurement', 'LR DATE', 'DELIVERY STATUS', 'TRANSPOTER NAME', 'LOAD TYPE FTL/PTL']
  const southRow = [1001, 'ABC', 'Delhi', 'INV-500', 'Oil', 300, 6000, 'LTR', '2026-09-15', 'Pending', 'Drona', 'PTL']
  const wb = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 1001 })]) },
    { name: 'South', ws: sheet(1, southHeaders, [southRow]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  const north = c.rows.find((r) => r.sourceSheet === 'North')!
  const south = c.rows.find((r) => r.sourceSheet === 'South')!
  ok('North & South map to identical field values', north.values.lrNo === 1001 && south.values.lrNo === 1001
    && north.values.totalQuantity === 6000 && south.values.totalQuantity === 6000
    && south.values.measurement === 'LTR')
}

console.log('== 9. Duplicate ACROSS two worksheets = same identity ==')
{
  const wb = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({})]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({})]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  ok('same businessKey+lineKey across sheets', bk(c.rows[0]) === bk(c.rows[1]) && c.rows[0].businessKey != null)
  // replicate the workbook-wide in-file dedup grouping used by analyzeImportFile
  const seen = new Map<string, number>(); let dups = 0
  for (const r of c.rows) { const k = bk(r); if (seen.has(k)) dups++; else seen.set(k, 1) }
  ok('cross-sheet duplicate detected (1 dup)', dups === 1)
}

console.log('== 10. Duplicate WITHIN one worksheet ==')
{
  const wb = wbOf([{ name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({}), stdRow({})]) }])
  const c = collectImportRows(wb, FIELDS)
  ok('same identity within one sheet', bk(c.rows[0]) === bk(c.rows[1]))
}

console.log('== 11. Unique rows across worksheets stay unique ==')
{
  const wb = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 1, invoice: 'A' })]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 2, invoice: 'B' })]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  ok('distinct identities', bk(c.rows[0]) !== bk(c.rows[1]))
}

console.log('== 12. Measurement variants normalize across sheets ==')
{
  const wb = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 1, meas: 'Liters' })]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 2, meas: 'ltrs' })]) },
    { name: 'West', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 3, meas: 'LTR' })]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  ok('Liters/ltrs/LTR all → LTR', c.rows.every((r) => r.values.measurement === 'LTR'))
}

console.log('== 13. Different measurements remain separate identities ==')
{
  const wb = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ meas: 'LTR' })]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({ meas: 'KG' })]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  ok('6000 LTR ≠ 6000 KG (different lineKey)', c.rows[0].lineKey !== c.rows[1].lineKey
    && c.rows[0].values.measurement === 'LTR' && c.rows[1].values.measurement === 'KG')
}

console.log('== 14. 15-Sep-2026 date across multiple worksheets ==')
{
  const d = new Date(2026, 8, 15) // SheetJS-shaped local midnight, 15-Sep
  const wb = wbOf([
    { name: 'North', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 1, lrDate: d })]) },
    { name: 'South', ws: sheet(1, STD_HEADERS, [stdRow({ lr: 2, lrDate: d })]) },
  ])
  const c = collectImportRows(wb, FIELDS)
  const iso = (r: (typeof c.rows)[number]) => (r.values.lrDate instanceof Date ? r.values.lrDate.toISOString().slice(0, 10) : String(r.values.lrDate))
  ok('lrDate stays 2026-09-15 in every sheet', c.rows.every((r) => iso(r) === '2026-09-15'),
    `got ${c.rows.map(iso).join(',')}`)
}

console.log('== 15. Zero valid MIS worksheets ==')
{
  const wb = wbOf([{ name: 'Summary', ws: nonMis('Summary') }, { name: 'Notes', ws: nonMis('Notes') }])
  const c = collectImportRows(wb, FIELDS)
  ok('no MIS sheets detected → empty', c.sheets.length === 0 && c.rows.length === 0)
}

console.log('== 17. Source sheet + Excel row metadata ==')
{
  const wb = wbOf([
    { name: 'North', ws: sheet(2, STD_HEADERS, [stdRow({ lr: 1 })]) }, // header row 3 → data row 4
    { name: 'South', ws: sheet(4, STD_HEADERS, [stdRow({ lr: 2 })]) }, // header row 5 → data row 6
  ])
  const c = collectImportRows(wb, FIELDS)
  const north = c.rows.find((r) => r.sourceSheet === 'North')!
  const south = c.rows.find((r) => r.sourceSheet === 'South')!
  ok('North metadata (sheet+excelRow 4)', north.sourceSheet === 'North' && north.excelRow === 4, `row ${north?.excelRow}`)
  ok('South metadata (sheet+excelRow 6)', south.sourceSheet === 'South' && south.excelRow === 6, `row ${south?.excelRow}`)
}

console.log('')
console.log(`RESULT: ${PASS} pass / ${FAIL} fail`)
process.exit(FAIL > 0 ? 1 : 0)
