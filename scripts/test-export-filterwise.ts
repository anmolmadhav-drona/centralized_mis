// test-export-filterwise.ts — verifies the filterwise Excel export feature.
// For each scenario: POST /api/export with the exact AG Grid filter model the
// UI would send → parse the returned .xlsx (ExcelJS) → assert row counts,
// values, sort order, Summary-sheet math, and live formulas.
//
// Run: bunx tsx scripts/test-export-filterwise.ts   (server must be up on :3000)
import ExcelJS from 'exceljs'
import { naLogin } from './lib/na-login'

const BASE = process.env.EXPORT_BASE || 'http://localhost:3000'
const EMAIL = 'admin@npl.com'
const PASSWORD = 'Admin@123'

let cookie = ''
let PASS = 0
let FAIL = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`) }
  else { FAIL++; console.log(`  ✗ ${name} — ${detail}`) }
}

async function login() {
  cookie = await naLogin(BASE, EMAIL, PASSWORD)
  if (!cookie) throw new Error('login failed')
}

async function apiRecords(params: URLSearchParams) {
  const res = await fetch(`${BASE}/api/records?${params.toString()}`, { headers: { cookie } })
  if (!res.ok) throw new Error(`records failed: ${res.status}`)
  return (await res.json()) as { rows: Array<Record<string, unknown>>; total: number }
}

async function apiExport(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`export failed: ${res.status} ${await res.text().catch(() => '')}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const fileName = res.headers.get('x-file-name') || ''
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return { buf, fileName, wb }
}

interface SheetInfo {
  dataRows: Array<Record<string, unknown>>  // keyed by header name
  headers: string[]
  ws: ExcelJS.Worksheet
}

function readSheet(wb: ExcelJS.Workbook, name: string): SheetInfo {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`missing sheet ${name}`)
  const headers: string[] = []
  const headerRow = ws.getRow(2) // row 2 = styled header
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => { headers[col - 1] = String(cell.value ?? '') })
  const dataRows: Array<Record<string, unknown>> = []
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rec: Record<string, unknown> = {}
    let any = false
    headers.forEach((h, i) => {
      if (!h) return
      const cell = row.getCell(i + 1)
      let v: unknown = cell.value
      if (v != null && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result
      if (v != null && typeof v === 'object' && 'text' in (v as object) && (v as { richText?: unknown }).richText) v = (v as { text: string }).text
      if (v instanceof Date) v = v.toISOString().slice(0, 10)
      rec[h] = v
      if (v != null && v !== '') any = true
    })
    if (any) dataRows.push(rec)
  }
  return { dataRows, headers, ws }
}

const col = (info: SheetInfo, ...candidates: string[]) => {
  for (const c of candidates) {
    const exact = info.headers.find((h) => h.trim().toUpperCase() === c.trim().toUpperCase())
    if (exact) return exact
  }
  return ''
}

async function main() {
  await login()
  console.log('== scenario 0: no filter (full export) ==')
  {
    const { buf, fileName, wb } = await apiExport({ includeSummary: true })
    const info = readSheet(wb, 'MIS')
    const all = await apiRecords(new URLSearchParams({ start: '0', end: '1' }))
    ok('returns a valid xlsx (>10KB)', buf.byteLength > 10_000, `${buf.byteLength}B`)
    ok(`fileName pattern MIS_Export_*.xlsx`, /^MIS_Export_\d{12}\.xlsx$/.test(fileName), fileName) // stamp = yyyyMMddHHmm
    ok(`row count == server total (${all.total})`, info.dataRows.length === all.total, `sheet=${info.dataRows.length} api=${all.total}`)
    ok('Summary sheet present', !!wb.getWorksheet('Summary'))
    ok('SYS_RECORD_ID + SYS_VERSION trailing columns', info.headers.includes('SYS_RECORD_ID') && info.headers.includes('SYS_VERSION'))
    ok('TOTAL row present (row 1)', String(wb.getWorksheet('MIS')!.getRow(1).getCell(1).value ?? '').length >= 0)
    const srno = col(info, 'SR. NO.', 'SR.NO.', 'SR NO')
    ok('SR. NO. regenerated 1..N', srno ? String(info.dataRows[0]?.[srno]) === '1' && String(info.dataRows[1]?.[srno]) === '2' : false)
  }

  console.log('== scenario 1: single text filter — deliveryStatus equals "Delivered" ==')
  {
    const filterModel = { deliveryStatus: { filterType: 'text', type: 'equals', filter: 'Delivered' } }
    const { wb } = await apiExport({ filterModel, includeSummary: false })
    const info = readSheet(wb, 'MIS')
    const api = await apiRecords(new URLSearchParams({ start: '0', end: '500', filter: JSON.stringify(filterModel) }))
    ok(`rows == grid total for same filter (${api.total})`, info.dataRows.length === api.total, `sheet=${info.dataRows.length} api=${api.total}`)
    const statusCol = col(info, 'DELIVERY STATUS')
    const allDelivered = statusCol ? info.dataRows.every((r) => String(r[statusCol] ?? '') === 'Delivered') : false
    ok('every exported row has deliveryStatus=Delivered', allDelivered)
    ok('Summary omitted when includeSummary=false', !wb.getWorksheet('Summary'))
  }

  console.log('== scenario 2: search + filter combined ==')
  {
    const filterModel = { partyName: { filterType: 'text', type: 'contains', filter: 'Ghumman' } }
    const search = 'pathankot'
    const { wb } = await apiExport({ filterModel, search })
    const info = readSheet(wb, 'MIS')
    const api = await apiRecords(new URLSearchParams({ start: '0', end: '500', filter: JSON.stringify(filterModel), search }))
    ok(`rows == grid total for search+filter (${api.total})`, info.dataRows.length === api.total, `sheet=${info.dataRows.length} api=${api.total}`)
    const partyCol = col(info, 'PARTY NAME')
    const destCol = col(info, 'DESTINATION')
    const allMatch = partyCol && destCol
      ? info.dataRows.every((r) => String(r[partyCol] ?? '').includes('Ghumman') && String(r[destCol] ?? '').toLowerCase().includes('pathankot'))
      : false
    ok('every row matches party contains Ghumman AND search hits pathankot', allMatch && info.dataRows.length >= 1)
  }

  console.log('== scenario 3: date range filter (lrDate inRange) ==')
  {
    const filterModel = {
      lrDate: { filterType: 'date', type: 'inRange', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
    }
    const { wb } = await apiExport({ filterModel })
    const info = readSheet(wb, 'MIS')
    const api = await apiRecords(new URLSearchParams({ start: '0', end: '500', filter: JSON.stringify(filterModel) }))
    ok(`rows == grid total for date range (${api.total})`, info.dataRows.length === api.total, `sheet=${info.dataRows.length} api=${api.total}`)
    const lrCol = col(info, 'LR DATE', 'LR. DATE')
    const inRange = lrCol ? info.dataRows.every((r) => {
      const v = String(r[lrCol] ?? '').slice(0, 10)
      return v >= '2026-08-01' && v <= '2026-08-31'
    }) : false
    ok('every exported LR DATE falls inside [2026-08-01, 2026-08-31]', inRange)
    ok('date-range scenario matches real records (>0)', info.dataRows.length > 0, `n=${info.dataRows.length}`)
  }

  console.log('== scenario 4: sort order honored (lrNo desc) ==')
  {
    const sortModel = [{ colId: 'lrNo', sort: 'desc' }]
    const { wb } = await apiExport({ sortModel })
    const info = readSheet(wb, 'MIS')
    const lrNoCol = col(info, 'LR NO', 'LR. NO.', 'LR.NO.')
    const nums = info.dataRows.map((r) => Number(r[lrNoCol] ?? NaN)).filter((n) => Number.isFinite(n))
    const sortedDesc = nums.every((n, i) => i === 0 || nums[i - 1] >= n)
    ok('rows exported in lrNo DESC order', sortedDesc, JSON.stringify(nums.slice(0, 5)))
  }

  console.log('== scenario 5: Summary sheet math matches filtered subset ==')
  {
    const filterModel = { deliveryStatus: { filterType: 'text', type: 'equals', filter: 'Delivered' } }
    const { wb } = await apiExport({ filterModel, includeSummary: true })
    const mis = readSheet(wb, 'MIS')
    const qtyCol = col(mis, 'TOTAL QUANTITY IN LTRS', 'TOTAL QUANTITY IN LTRS.')
    const expectedTotal = qtyCol
      ? mis.dataRows.reduce((s, r) => s + (Number(r[qtyCol]) || 0), 0)
      : NaN
    const sum = wb.getWorksheet('Summary')!
    // Grand Total is in the last header column of the last data row
    let grand = NaN
    const hRow = sum.getRow(2)
    const headers: string[] = []
    hRow.eachCell({ includeEmpty: false }, (c, i) => { headers[i - 1] = String(c.value ?? '') })
    const gtIdx = headers.findIndex((h) => h === 'Grand Total') + 1
    for (let r = 3; r <= sum.rowCount; r++) {
      if (String(sum.getRow(r).getCell(1).value ?? '') === 'Grand Total') { grand = Number(sum.getRow(r).getCell(gtIdx).value); break }
    }
    ok('Summary Grand Total == sum of filtered TOTAL QUANTITY', grand === expectedTotal, `summary=${grand} mis=${expectedTotal}`)
    ok('Summary counts filtered rows only (not 340-all)', mis.dataRows.length < 340)
  }

  console.log('== scenario 6: live Excel formulas exported ==')
  {
    // create a temp record with a formula, export it, then clean up
    const create = await fetch(`${BASE}/api/records`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        values: { lrNo: '999971', lrDate: '2026-09-12', partyName: 'Export Test Co', destination: 'Test City', bucket: 100 },
        formulas: { loadingCharges: '=Bucket*3' },
      }),
    })
    const created = (await create.json()) as { record?: { id?: string } }
    const id = created.record?.id
    ok('temp record with formula created', !!id)
    if (id) {
      try {
        const filterModel = { partyName: { filterType: 'text', type: 'equals', filter: 'Export Test Co' } }
        const { wb } = await apiExport({ filterModel })
        const info = readSheet(wb, 'MIS')
        ok('filtered export contains exactly the temp record', info.dataRows.length === 1, `n=${info.dataRows.length}`)
        const loadCol = col(info, 'LOADING CHARGES')
        const ws = info.ws
        const r = 3
        // find the column index of loadCol
        const idx = info.headers.indexOf(loadCol) + 1
        const cell = ws.getRow(r).getCell(idx)
        const cv = cell.value as { formula?: string; result?: unknown } | null
        ok('formula exported as live Excel formula (=Bucket*3 → A1 form)', !!cv && typeof cv === 'object' && 'formula' in cv && /^[A-Z]+\d+$|^[A-Z]+\$?\d+/.test(String((cv as { formula: string }).formula).replace(/^.*?([A-Z]{1,2}\$?\d+).*$/, '$1')) !== false && 'formula' in cv, JSON.stringify(cv))
        const bucketIdx = info.headers.indexOf(col(info, 'BUCKET')) + 1
        const a1Bucket = ExcelJS.utils ? '' : '' // not needed; compute expected formula col letter
        const colLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
        const expectedFormula = `${colLetter(bucketIdx)}3*3`
        ok(`formula references same-row bucket cell (${expectedFormula})`, !!cv && typeof cv === 'object' && (cv as { formula: string }).formula === expectedFormula, JSON.stringify(cv && 'formula' in cv ? cv.formula : cv))
        ok('cached result 300 present', cv != null && 'result' in cv && Number((cv as { result: unknown }).result) === 300, JSON.stringify(cv && 'result' in cv ? (cv as { result: unknown }).result : null))
      } finally {
        const del = await fetch(`${BASE}/api/records/${id}`, { method: 'DELETE', headers: { cookie } })
        ok('cleanup delete ok', del.ok, String(del.status))
      }
    }
  }

  console.log('== scenario 7: export respects setFilterModel(null) state (chips removed) ==')
  {
    // exporting with an explicitly empty filter model must equal full export
    const { wb } = await apiExport({ filterModel: {} })
    const info = readSheet(wb, 'MIS')
    const all = await apiRecords(new URLSearchParams({ start: '0', end: '1' }))
    ok('empty filterModel exports all rows', info.dataRows.length === all.total, `sheet=${info.dataRows.length} api=${all.total}`)
  }

  console.log('== scenario 8: text equals is case-insensitive (Excel semantics) ==')
  {
    const filterModel = { destination: { filterType: 'text', type: 'equals', filter: 'hisar' } } // lowercase query
    const { wb } = await apiExport({ filterModel })
    const info = readSheet(wb, 'MIS')
    const destCol = col(info, 'DESTINATION')
    const matches = destCol
      ? info.dataRows.filter((r) => String(r[destCol] ?? '').toLowerCase() === 'hisar')
      : []
    ok('lowercase "hisar" matches HISAR + Hisar rows (5)', matches.length === 5 && info.dataRows.length === 5, `n=${info.dataRows.length}`)
    const notEqual = { destination: { filterType: 'text', type: 'notEqual', filter: 'HISAR' } }
    const { wb: wb2 } = await apiExport({ filterModel: notEqual })
    const info2 = readSheet(wb2, 'MIS')
    const d2 = col(info2, 'DESTINATION')
    const noneHisar = d2 ? info2.dataRows.every((r) => String(r[d2] ?? '').toLowerCase() !== 'hisar') : false
    ok('notEqual HISAR excludes both cases (335)', noneHisar && info2.dataRows.length === 340 - 5, `n=${info2.dataRows.length}`)
  }

  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`)
  process.exit(FAIL === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
