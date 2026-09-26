// Focused tests for the Quantity + Measurement backend foundation.
// Run: bun scripts/measurement-import-test.ts
//
// Covers: core-column mapping (Part 1), single-sheet importer measurement
// handling (Part 3), and the header→fieldKey mapping. Line-identity behavior
// (Part 2) lives in business-key-test.ts.
import { sqlColumnFor, CORE_COLUMNS } from '../src/lib/services/fields'
import { normalizeMeasurement } from '../src/lib/services/measurement'
import type { FieldDef } from '../src/lib/types'

let PASS = 0
let FAIL = 0
function ok(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) { PASS++; console.log(`  ✓ ${name}`) }
  else { FAIL++; console.log(`  ✗ ${name} — expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`) }
}

const mkField = (fieldKey: string, fieldName: string): FieldDef => ({
  id: `fld-${fieldKey}`, fieldKey, fieldName, displayName: fieldName, dataType: 'TEXT',
  required: false, defaultValue: null, options: null, position: 0,
  isCore: true, isSystem: false, active: true, width: null,
})

const qtyField = mkField('totalQuantity', 'TOTAL QUANTITY')
const measField = mkField('measurement', 'Measurement')

console.log('== Physical core-column mapping (Part 1) ==')
ok('10) sqlColumnFor(measurement) === "measurement"', sqlColumnFor(measField), 'measurement')
ok('11) sqlColumnFor(totalQuantity) === "totalQuantity"', sqlColumnFor(qtyField), 'totalQuantity')
ok('measurement is a physical core column (not EAV)', CORE_COLUMNS.measurement, 'measurement')
ok('quantity is a physical core column', CORE_COLUMNS.totalQuantity, 'totalQuantity')

console.log('== Header → fieldKey mapping (Part 3, same rule as import.ts) ==')
const fields = [qtyField, measField]
const mapHeader = (h: string): string | null => {
  const lower = h.toLowerCase()
  const f = fields.find((f) => f.fieldName.toLowerCase() === lower)
  return f ? f.fieldKey : null
}
ok('12) TOTAL QUANTITY -> totalQuantity', mapHeader('TOTAL QUANTITY'), 'totalQuantity')
ok('12) Measurement -> measurement', mapHeader('Measurement'), 'measurement')
ok('old "TOTAL QUANTITY IN LTRS" header no longer matches', mapHeader('TOTAL QUANTITY IN LTRS'), null)
ok('full chain: TOTAL QUANTITY -> fieldKey -> column',
  (() => { const k = mapHeader('TOTAL QUANTITY'); const f = fields.find((x) => x.fieldKey === k); return f ? sqlColumnFor(f) : null })(),
  'totalQuantity')
ok('full chain: Measurement -> fieldKey -> column',
  (() => { const k = mapHeader('Measurement'); const f = fields.find((x) => x.fieldKey === k); return f ? sqlColumnFor(f) : null })(),
  'measurement')

console.log('== Importer measurement handling (Part 3 — mirrors import.ts) ==')
// Exact copy of the measurement block in src/lib/excel/import.ts so this test
// tracks the real importer behavior (normalize + require-when-quantity).
function importMeasure(qty: unknown, rawMeas: unknown): { stored: string | null; invalid: boolean } {
  const errors: string[] = []
  const values: Record<string, unknown> = { totalQuantity: qty, measurement: rawMeas }
  const hasQty = values['totalQuantity'] != null && values['totalQuantity'] !== ''
  const hasMeas = values['measurement'] != null && String(values['measurement']).trim() !== ''
  if (hasMeas) values['measurement'] = normalizeMeasurement(values['measurement'])
  else { values['measurement'] = null; if (hasQty) errors.push('Measurement is required when Total Quantity is present.') }
  return { stored: values['measurement'] as string | null, invalid: errors.length > 0 }
}
ok('1) 6300 + Liters => stored LTR', importMeasure(6300, 'Liters').stored, 'LTR')
ok('2) 8200 + KG => stored KG', importMeasure(8200, 'KG').stored, 'KG')
ok('3) 450 + PCS => stored PCS', importMeasure(450, 'PCS').stored, 'PCS')
ok('4) Liters/liters/Ltrs/ltr/LTR all normalize to LTR',
  ['Liters', 'liters', 'Ltrs', 'ltr', 'LTR'].every((v) => importMeasure(100, v).stored === 'LTR'), true)
ok('5) quantity present + measurement missing => INVALID', importMeasure(6300, null).invalid, true)
ok('5) quantity present + measurement blank => INVALID', importMeasure(6300, '   ').invalid, true)
ok('quantity present + valid measurement => not invalid', importMeasure(6300, 'KG').invalid, false)
ok('no quantity + no measurement => not invalid (row simply has no qty)', importMeasure(null, null).invalid, false)
ok('missing measurement is NOT silently defaulted to LTR', importMeasure(6300, null).stored, null)

console.log('')
console.log(`RESULT: ${PASS} pass / ${FAIL} fail`)
process.exit(FAIL > 0 ? 1 : 0)
