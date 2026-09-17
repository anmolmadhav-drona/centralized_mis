/**
 * Latest-workbook Excel field tests (PART 15 of the latest-workbook task).
 *
 * Builds a workbook in the LATEST format — sheet "NPL SONIPAT", the 30
 * canonical headers (including "Remark" — NOT "Remarsk" — plus DispatchFrom,
 * Vehicle Rate, KM, Rate, Total Rate and the trailing blank column) — and
 * verifies against the PRODUCTION standalone server as ADMIN:
 *
 *   1. every latest-workbook header maps (no "ignored" warnings for them)
 *   2. preview classifies all rows NEW
 *   3. confirm imports the new fields into the correct DB columns
 *   4. the MIS grid API returns the new values
 *   5. export includes the new headers (registry conventions)
 *   6. re-importing the same file → in-file + DB duplicates (dedup intact)
 *   7. "Remark" is the canonical Excel header (no Remarsk anywhere)
 *   8. no duplicate field definitions exist
 *
 * Cleans up every record it creates (soft-delete) so the suite is re-runnable.
 *
 * Run:  bash scripts/with-prod-server.sh bun scripts/excel-newfields-test.ts
 */
import * as XLSX from 'xlsx'

const BASE = process.env.PORTAL_BASE || 'http://localhost:3000'

let passed = 0
let failed = 0
function ok(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ FAIL: ${name}`) }
}

async function naLogin(email: string, password: string): Promise<string | null> {
  const jar: string[] = []
  const cookieHeader = () => (jar.length ? { cookie: jar.join('; ') } : {})
  const absorb = (res: Response) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const kv = c.split(';')[0]
      const i = jar.findIndex((x) => x.split('=')[0] === kv.split('=')[0])
      if (i >= 0) jar[i] = kv; else jar.push(kv)
    }
  }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: cookieHeader() })
  absorb(csrfRes)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/` }),
    redirect: 'manual',
  })
  absorb(res)
  return jar.find((x) => x.startsWith('authjs.session-token=')) ||
    jar.find((x) => x.startsWith('__Secure-authjs.session-token=')) || null
}

// ---- the 30 canonical headers of the LATEST workbook, in order ----
const LATEST_HEADERS = [
  'SR. NO.', 'PICKUP LOCATION', 'PARTY NAME', 'DESTINATION', 'INVOICE NUMBER',
  'LR. NO.', 'LR DATE', 'MATERIAL DETAILS', 'Bucket', 'TOTAL QUANTITY IN LTRS',
  'LOAD TYPE FTL/PTL', 'EXPECTED DELIVERY DATE', 'ACTUAL DELIVERY DATE',
  'DELIVERY STATUS', 'DAMAGE', 'LOADING CHARGES', 'UNLOADING CHARGES',
  'VEHICLE NUMBER', 'VEHICLE TYPE', 'PLY', 'Remark', 'Dispatch Date',
  'DispatchFrom', 'Dispatch Vehicle', 'Vendor Name', 'Vehicle Rate',
  'POD Status', 'KM', 'Rate', 'Total Rate',
]

// data rows — two distinct shipments with values in EVERY new column
const NEW_LR_BASE = 990_500
function dataRow(sr: number, lr: number): (string | number | null)[] {
  return [
    sr, 'Sonipat', `NewField Test Party ${sr}`, 'Testville', `NF-2026/${sr}`, lr, '2026-09-01',
    'TATA Motors HP Genuine Def - 1*20L', 5, 100, 'PTL', '2026-09-03', '2026-09-04',
    'Delivered', 'No', 120.5, 80.25, 'HR99TT0001', 709, 0,
    'Test remark value', '2026-09-02', 'Sonipat WH-A', 'HR99TT0002', 'Drona', 1500.75,
    'Received', 245.5, 28.5, 6981.375,
    null, // trailing blank column (after Total Rate) — must be ignored
  ]
}

async function main() {
  const cookie = await naLogin('admin@npl.com', 'Admin@123')
  if (!cookie) throw new Error('admin login failed')
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body != null ? { 'content-type': 'application/json' } : {}) },
      body: body != null ? JSON.stringify(body) : undefined,
    })
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('spreadsheet') || contentType.includes('octet-stream')) {
      return { status: res.status, json: {} as T, buffer: Buffer.from(await res.arrayBuffer()) }
    }
    const text = await res.text()
    let json = {} as T
    try { json = JSON.parse(text) as T } catch { /* non-JSON */ }
    return { status: res.status, json }
  }

  console.log('\n[0] Canonical field registry')
  {
    const fields = await call<{ fields: Array<{ fieldKey: string; fieldName: string; isCore: boolean }> }>('GET', '/api/fields')
    const byKey = new Map(fields.json.fields.map((f) => [f.fieldKey, f]))
    ok('canonical header "Remark" maps to existing fieldKey remark',
      byKey.get('remark')?.fieldName === 'Remark')
    ok('no Remarsk canonical field exists',
      !fields.json.fields.some((f) => f.fieldName === 'Remarsk' || f.fieldKey === 'Remarsk'))
    for (const [key, header] of [
      ['dispatchFrom', 'DispatchFrom'], ['vehicleRate', 'Vehicle Rate'], ['km', 'KM'],
      ['rate', 'Rate'], ['totalRate', 'Total Rate'],
    ] as const) {
      ok(`field ${key} ← Excel "${header}"`, byKey.get(key)?.fieldName === header && !!byKey.get(key)?.isCore)
    }
    // duplicate-field prevention: no two fields share an Excel header (case-insensitive)
    const names = fields.json.fields.map((f) => f.fieldName.toLowerCase())
    ok('no duplicate Excel headers in registry', new Set(names).size === names.length)
  }

  // ---- build the latest-format workbook (sheet "NPL SONIPAT") ----
  const aoa: unknown[][] = []
  aoa.push(LATEST_HEADERS)
  aoa.push(dataRow(1, NEW_LR_BASE + 1))
  aoa.push(dataRow(2, NEW_LR_BASE + 2))
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'NPL SONIPAT')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const created: string[] = []
  try {
    console.log('\n[1] Import preview — latest format, sheet "NPL SONIPAT"')
    let jobId = ''
    let rowIndices: number[] = []
    {
      const fd = new FormData()
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'latest-format.xlsx')
      const res = await fetch(`${BASE}/api/import/preview`, { method: 'POST', headers: { cookie }, body: fd })
      const json = await res.json() as {
        jobId: string
        rows: Array<{ rowIndex: number; kind: string }>
        stats: { detected: number; new: number; invalid: number }
        warnings: string[]
      }
      ok('preview accepted (sheet "NPL SONIPAT" detected)', res.status === 200 && !!json.jobId)
      jobId = json.jobId
      rowIndices = (json.rows || []).map((r) => r.rowIndex)
      ok('both rows classified NEW (no invalid)', json.stats?.new === 2 && json.stats?.invalid === 0)
      const ignored = (json.warnings || []).find((w) => w.includes('Ignored'))
      ok('no latest-workbook column reported as ignored (blank col excepted)',
        !ignored || !LATEST_HEADERS.some((h) => (ignored || '').includes(h)))
      ok('blank trailing column tolerated (never a field)', !fieldsIncludeBlank(json.warnings || []))
    }

    console.log('\n[2] Import confirm — values land in the right columns')
    {
      const res = await call<{ result: { applied: number; created: number; failed: number; failedRows: unknown[] } }>('POST', '/api/import/confirm', {
        jobId, resolutions: {}, newRows: rowIndices, changedRows: [], deletions: [],
      })
      ok('confirm applied 2 / created 2 / failed 0',
        res.json.result?.applied === 2 && res.json.result?.created === 2 && res.json.result?.failed === 0)
    }

    console.log('\n[3] Grid API returns the new fields')
    {
      const res = await call<{ rows: Array<Record<string, unknown>>; total: number }>('GET', `/api/records?start=0&end=50&filter=${encodeURIComponent(JSON.stringify({ partyName: { filterType: 'text', type: 'contains', filter: 'NewField Test Party' } }))}`)
      ok('both test records found via filter', res.json.rows.length === 2)
      const row = res.json.rows.find((r) => r.lrNo === NEW_LR_BASE + 1)
      ok('record 1 found', !!row)
      if (row) {
        created.push(row.id as string)
        ok('dispatchFrom imported', row.dispatchFrom === 'Sonipat WH-A')
        ok('remark imported (Remark column)', row.remark === 'Test remark value')
        ok('vehicleRate imported', row.vehicleRate === 1500.75)
        ok('km imported (decimal preserved)', row.km === 245.5)
        ok('rate imported', row.rate === 28.5)
        ok('totalRate imported', row.totalRate === 6981.375)
        ok('loadingCharges imported', row.loadingCharges === 120.5)
        ok('unloadingCharges imported', row.unloadingCharges === 80.25)
        ok('legacy columns still import (partyName)', row.partyName === 'NewField Test Party 1')
      }
      const row2 = res.json.rows.find((r) => r.lrNo === NEW_LR_BASE + 2)
      if (row2) created.push(row2.id as string)
      ok('second record created', !!row2)
    }

    console.log('\n[4] Export round-trip')
    {
      const res = await call('POST', '/api/export', { includeSummary: false })
      ok('export succeeded', res.status === 200 && (res.buffer?.length ?? 0) > 5000)
      const expWb = XLSX.read(res.buffer!, { type: 'buffer' })
      const expRows = XLSX.utils.sheet_to_json<unknown[]>(expWb.Sheets['MIS'], { header: 1, raw: true, defval: null })
      const headerRow = (expRows[1] || []).map((c) => String(c ?? '').trim())
      for (const h of ['Remark', 'DispatchFrom', 'Vehicle Rate', 'KM', 'Rate', 'Total Rate']) {
        ok(`export includes "${h}"`, headerRow.includes(h))
      }
      ok('export uses "Remark" (not "Remarsk")', !headerRow.includes('Remarsk'))
      // round-trip: re-importing the export must NOT duplicate records
      const fd = new FormData()
      fd.append('file', new Blob([new Uint8Array(res.buffer!)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'roundtrip.xlsx')
      const rt = await fetch(`${BASE}/api/import/preview`, { method: 'POST', headers: { cookie }, body: fd })
      const rtJson = await rt.json() as {
        jobId: string
        stats: { new: number; unchanged: number; duplicates: number }
      }
      ok('re-import of export → 0 new records (round-trip identity intact)',
        rt.status === 200 && rtJson.stats?.new === 0 && (rtJson.stats?.unchanged ?? 0) > 300)
    }

    console.log('\n[5] Duplicate prevention unchanged')
    {
      // (a) re-importing the same file (no SYS ids) → business-key matches the
      //     DB records → UNCHANGED, never new
      const fd = new FormData()
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'latest-format-again.xlsx')
      const rt = await fetch(`${BASE}/api/import/preview`, { method: 'POST', headers: { cookie }, body: fd })
      const rtJson = await rt.json() as { jobId: string; stats: { new: number; unchanged: number } }
      ok('re-import of the same file → 0 new, 2 unchanged (businessKey/lineKey match intact)',
        rt.status === 200 && rtJson.stats?.new === 0 && rtJson.stats?.unchanged === 2)

      // (b) a file containing the SAME shipment line twice → first NEW, second
      //     in-file DUPLICATE (never applied)
      const dupAoa: unknown[][] = [LATEST_HEADERS, dataRow(3, NEW_LR_BASE + 3), dataRow(3, NEW_LR_BASE + 3)]
      const dupWb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(dupWb, XLSX.utils.aoa_to_sheet(dupAoa), 'NPL SONIPAT')
      const dupBuf = XLSX.write(dupWb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      const fd2 = new FormData()
      fd2.append('file', new Blob([new Uint8Array(dupBuf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'in-file-duplicate.xlsx')
      const dup = await fetch(`${BASE}/api/import/preview`, { method: 'POST', headers: { cookie }, body: fd2 })
      const dupJson = await dup.json() as { stats: { new: number; duplicates: number }; rows: Array<{ kind: string; duplicateOfRow: number | null }> }
      ok('in-file duplicate detected → 1 new + 1 duplicate',
        dup.status === 200 && dupJson.stats?.new === 1 && dupJson.stats?.duplicates === 1)
      ok('duplicate row points at the first occurrence',
        dupJson.rows?.[1]?.kind === 'DUPLICATE' && dupJson.rows?.[1]?.duplicateOfRow === dupJson.rows?.[0]?.rowIndex)
    }
  } finally {
    // ---- cleanup: soft-delete created records ----
    for (const id of created) {
      await call('DELETE', `/api/records/${id}`).catch(() => { /* best effort */ })
    }
    console.log(`\n(cleanup: soft-deleted ${created.length} test records)`)
  }

  console.log(`\n========= EXCEL NEW-FIELDS: ${passed} passed, ${failed} failed =========`)
  if (failed > 0) process.exit(1)
}

function fieldsIncludeBlank(warnings: string[]): boolean {
  // a blank header cell produces no warning at all ("" headers are skipped)
  return warnings.some((w) => w.toLowerCase().includes('unnamed') || /ignored .*column\(s\): ,/.test(w))
}

main().catch((e) => { console.error(e); process.exit(1) })
