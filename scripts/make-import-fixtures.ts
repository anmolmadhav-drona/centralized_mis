/**
 * NPL MIS Portal — Excel import test-fixture generator (development tooling).
 * Run: bun scripts/make-import-fixtures.ts
 *
 * Writes a documented, reproducible fixture set into tests/fixtures/ (git-
 * ignored — regenerate on demand). Each fixture maps to a scenario in the
 * duplicate-prevention spec (see docs/duplicate-system.md):
 *
 *   01-valid.xlsx               clean baseline rows (import → NEW)
 *   02-exact-duplicate.xlsx     rows identical to 01 (→ UNCHANGED on re-import)
 *   03-same-businesskey-different-linekey.xlsx
 *                               same LR+Invoice+Party, different material/qty
 *                               (→ independent NEW records — PTL multi-line)
 *   04-normalized-duplicate.xlsx  whitespace/case/numeric-string variants of
 *                               01 rows (→ UNCHANGED — same business key)
 *   05-incomplete-identity.xlsx rows missing LR / Invoice / Party
 *                               (→ NULL businessKey, exempt from dedup)
 *   06-soft-deleted-key.xlsx    rows whose keys were soft-deleted
 *                               (→ re-created, identity released)
 *   07-changed-operational.xlsx  same keys as 01, different status fields
 *                               (→ UPDATED, original record id preserved)
 *   08-malformed.xlsx           not a real workbook (garbage bytes)
 *   09-empty.xlsx               valid workbook, no MIS sheet/data
 *
 * The interactive scenarios (concurrent import race — preview, insert behind
 * the preview's back) are covered by scripts/import-dedup-e2e.ts scenario 9
 * because they require a live server + database, not a static file.
 */
import * as XLSX from 'xlsx'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(import.meta.dir, '..', 'tests', 'fixtures')
mkdirSync(OUT_DIR, { recursive: true })

// Exact core headers the import pipeline expects (order matters).
const HEADERS = [
  'SR. NO.', 'PICKUP LOCATION', 'PARTY NAME', 'DESTINATION', 'INVOICE NUMBER',
  'LR. NO.', 'LR DATE', 'MATERIAL DETAILS', 'TRANSPOTER NAME', 'Bucket',
  'TOTAL QUANTITY IN LTRS', 'LOAD TYPE FTL/PTL', 'EXPECTED DELIVERY DATE',
  'ACTUAL DELIVERY DATE', 'DELIVERY STATUS', 'LR STATUS', 'DAMAGE',
  'LOADING CHARGES', 'UNLOADING CHARGES', 'VEHICLE NUMBER', 'VEHICLE TYPE',
  'PLY', 'Remark', 'Remarks 1', 'Dispatch Date', 'Dispatch Vehicle',
  'Vendor Name', 'Route Code2', 'POD Status',
]

type Row = (string | number | null)[]
const baseRow = (sr: number, lr: number, inv: string | number, party: string, qty: number, material = 'TATA Motors HP Genuine Def - 1*20L'): Row => [
  sr, 'Sonipat', party, 'Panipat', inv, lr, '2026-01-05', material, 'Drona Logitech',
  9, qty, 'PTL', '2026-01-07', null, 'Pending', 'To be Billed', 'No',
  null, null, 'HR29AB1234', 709, 0, null, 'Pending', null, null, 'Drona', 'Deepak Route 1', 'POD Pending',
]

function writeBook(name: string, rows: Row[]) {
  const aoa: Row[] = ['', ...HEADERS.map(() => null), ...rows] as Row[]
  aoa[0] = ['NPL MIS — import'] // row 1 = title, row 2 = headers, row 3+ = data
  aoa[1] = HEADERS as Row
  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'MIS')
  XLSX.writeFile(wb, join(OUT_DIR, name))
  console.log(`  ✓ ${name} (${rows.length} data rows)`)
}

console.log('Generating import fixtures → tests/fixtures/')

// 01 — clean baseline
writeBook('01-valid.xlsx', [
  baseRow(1, 2001, 'INV-2001', 'ACME INDUSTRIES', 2000),
  baseRow(2, 2002, 'INV-2002', 'BETA TRADERS', 3000),
  baseRow(3, 2003, 543965, 'GAMMA LOGISTICS', 1500), // numeric invoice cell
])

// 02 — exact duplicate of 01
writeBook('02-exact-duplicate.xlsx', [
  baseRow(1, 2001, 'INV-2001', 'ACME INDUSTRIES', 2000),
  baseRow(2, 2002, 'INV-2002', 'BETA TRADERS', 3000),
  baseRow(3, 2003, 543965, 'GAMMA LOGISTICS', 1500),
])

// 03 — same business key, different line key (PTL multi-line)
writeBook('03-same-businesskey-different-linekey.xlsx', [
  baseRow(1, 2001, 'INV-2001', 'ACME INDUSTRIES', 2000, 'TATA Motors HP Genuine Def - 1*10L'),
  baseRow(2, 2001, 'INV-2001', 'ACME INDUSTRIES', 500, 'TATA Motors HP Genuine Def - 4*5L'),
])

// 04 — normalized duplicates of 01 (whitespace/case/numeric-string variants)
const variant = baseRow(1, 2001, '  inv-2001  ', '  acme industries ', 2000)
writeBook('04-normalized-duplicate.xlsx', [
  variant,
  baseRow(2, ' 2002 ', 'INV-2002', 'Beta Traders', 3000), // numeric-string LR
])

// 05 — incomplete identity (missing LR / invoice / party)
writeBook('05-incomplete-identity.xlsx', [
  baseRow(1, 3001, 'INV-3001', 'DELTA CORP', 1000),
  [2, 'Sonipat', null, 'Panipat', 'INV-3002', 3002, '2026-01-05', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null], // no party
  [3, 'Sonipat', 'EPSILON LTD', 'Panipat', null, null, '2026-01-05', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null], // no invoice/LR
])

// 06 — soft-deleted key scenario (fixture carries the ORIGINAL rows; the
// soft delete itself is performed against the database by the e2e suite)
writeBook('06-soft-deleted-key.xlsx', [
  baseRow(1, 4001, 'INV-4001', 'ZETA SUPPLY', 800),
])

// 07 — changed operational fields on the same keys as 01
const updated = baseRow(1, 2001, 'INV-2001', 'ACME INDUSTRIES', 2000)
updated[14] = 'Delivered' // DELIVERY STATUS Pending → Delivered
updated[13] = '2026-01-06' // ACTUAL DELIVERY DATE set
writeBook('07-changed-operational.xlsx', [updated])

// 08 — malformed workbook (garbage bytes, not xlsx)
writeFileSync(join(OUT_DIR, '08-malformed.xlsx'), Buffer.from('this is not a real xlsx workbook — parse must fail, not crash'))
console.log('  ✓ 08-malformed.xlsx (garbage bytes)')

// 09 — empty workbook (valid xlsx, no MIS sheet)
{
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nothing here']]), 'Sheet1')
  XLSX.writeFile(wb, join(OUT_DIR, '09-empty.xlsx'))
  console.log('  ✓ 09-empty.xlsx (no MIS sheet)')
}

console.log('\nDone. Fixture inventory + expected outcomes: docs/duplicate-system.md')
console.log('Live duplicate/import/race scenarios: bun run test:import (needs a running server)')
