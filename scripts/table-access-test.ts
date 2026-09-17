/**
 * Table-access visibility tests (PART 14 of the latest-workbook task).
 *
 * Verifies, against the PRODUCTION standalone server, that the
 * management-sensitive Centralized MIS tables —
 *   • Vehicle Rate      (vehicleRate)
 *   • Loading Charges   (loadingCharges)
 * — are visible/writable ONLY for ADMIN and MANAGER:
 *
 *   ADMIN   → visible in /api/fields, values in /api/records, writable, exported
 *   MANAGER → visible in /api/fields, values in /api/records, writable, exported
 *   USER    → hidden everywhere, writes → 403, values stripped, export stripped
 *   VIEWER  → hidden everywhere, suggest → 403, values stripped, export stripped
 *
 * Run:  bash scripts/with-prod-server.sh bun scripts/table-access-test.ts
 */
import * as XLSX from 'xlsx'

const BASE = process.env.PORTAL_BASE || 'http://localhost:3000'

let passed = 0
let failed = 0
function ok(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ FAIL: ${name}`) }
}

// ---- tiny Auth.js credentials login (cookie jar) ----
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

interface Caller {
  cookie: string
  call: <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<{
    status: number; json: T; buffer?: Buffer; text: string
  }>
}

async function loginAs(email: string, password: string): Promise<Caller> {
  const cookie = await naLogin(email, password)
  if (!cookie) throw new Error(`login failed for ${email}`)
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body != null ? { 'content-type': 'application/json' } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    })
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('spreadsheet') || contentType.includes('octet-stream')) {
      return { status: res.status, json: {} as T, buffer: Buffer.from(await res.arrayBuffer()), text: '' }
    }
    const text = await res.text()
    let json = {} as T
    try { json = JSON.parse(text) as T } catch { /* non-JSON */ }
    return { status: res.status, json, text }
  }
  return { cookie, call }
}

const RESTRICTED_KEYS = ['vehicleRate', 'loadingCharges'] as const
const RESTRICTED_DISPLAYS = ['Vehicle Rate', 'Loading Charges'] as const

async function main() {
  console.log('\n[0] Logins')
  const admin = await loginAs('admin@npl.com', 'Admin@123')
  const manager = await loginAs('manager@npl.com', 'Manager@123')
  const user = await loginAs('user@npl.com', 'User@123')
  const viewer = await loginAs('viewer@npl.com', 'Viewer@123')
  ok('all four roles logged in', true)

  // ------------------------------------------------------------------
  console.log('\n[1] ADMIN — restricted tables visible & writable')
  // ------------------------------------------------------------------
  {
    const fields = await admin.call<{ fields: Array<{ fieldKey: string }> }>('GET', '/api/fields')
    const keys = fields.json.fields.map((f) => f.fieldKey)
    ok('ADMIN /api/fields includes Vehicle Rate + Loading Charges',
      RESTRICTED_KEYS.every((k) => keys.includes(k)))

    const recs = await admin.call<{ rows: Array<Record<string, unknown>> }>('GET', '/api/records?start=0&end=3')
    ok('ADMIN /api/records rows carry restricted values',
      recs.json.rows.length > 0 && RESTRICTED_KEYS.every((k) => k in recs.json.rows[0]))

    // pick a record and write both restricted fields
    const target = recs.json.rows[0]
    const patch = await admin.call<{ record: Record<string, unknown> }>('PATCH', `/api/records/${target.id}`, {
      version: target.version,
      values: { loadingCharges: 111.5, vehicleRate: 222.75 },
    })
    ok('ADMIN PATCH loadingCharges + vehicleRate → 200',
      patch.status === 200 && patch.json.record?.loadingCharges === 111.5 && patch.json.record?.vehicleRate === 222.75)

    const single = await admin.call<{ record: Record<string, unknown> }>('GET', `/api/records/${target.id}`)
    ok('ADMIN single-record GET carries restricted values',
      single.json.record?.loadingCharges === 111.5 && single.json.record?.vehicleRate === 222.75)

    const exp = await admin.call('POST', '/api/export', { includeSummary: false })
    ok('ADMIN export includes restricted headers',
      exp.status === 200 && (exp.buffer?.length ?? 0) > 5000 && includesHeaders(exp.buffer!, ['Vehicle Rate', 'LOADING CHARGES']))

    // restore
    await admin.call('PATCH', `/api/records/${target.id}`, {
      version: (patch.json.record as { version: number }).version,
      values: { loadingCharges: target.loadingCharges ?? null, vehicleRate: target.vehicleRate ?? null },
    })
  }

  // ------------------------------------------------------------------
  console.log('\n[2] MANAGER — restricted tables visible & writable')
  // ------------------------------------------------------------------
  {
    const fields = await manager.call<{ fields: Array<{ fieldKey: string }> }>('GET', '/api/fields')
    const keys = fields.json.fields.map((f) => f.fieldKey)
    ok('MANAGER /api/fields includes Vehicle Rate + Loading Charges',
      RESTRICTED_KEYS.every((k) => keys.includes(k)))

    const recs = await manager.call<{ rows: Array<Record<string, unknown>> }>('GET', '/api/records?start=0&end=3')
    ok('MANAGER /api/records rows carry restricted values',
      recs.json.rows.length > 0 && RESTRICTED_KEYS.every((k) => k in recs.json.rows[0]))

    const target = recs.json.rows[0]
    const patch = await manager.call('PATCH', `/api/records/${target.id}`, {
      version: target.version,
      values: { loadingCharges: 88.25 },
    })
    ok('MANAGER PATCH loadingCharges → 200', patch.status === 200)
    await manager.call('PATCH', `/api/records/${target.id}`, {
      version: (patch.json as { record: { version: number } }).record.version,
      values: { loadingCharges: target.loadingCharges ?? null },
    })

    const exp = await manager.call('POST', '/api/export', { includeSummary: false })
    ok('MANAGER export includes restricted headers',
      exp.status === 200 && includesHeaders(exp.buffer!, ['Vehicle Rate', 'LOADING CHARGES']))
  }

  // ------------------------------------------------------------------
  console.log('\n[3] USER — restricted tables hidden, writes 403, exports stripped')
  // ------------------------------------------------------------------
  {
    const fields = await user.call<{ fields: Array<{ fieldKey: string; displayName: string }> }>('GET', '/api/fields')
    const keys = fields.json.fields.map((f) => f.fieldKey)
    const displays = fields.json.fields.map((f) => f.displayName)
    ok('USER /api/fields hides Vehicle Rate + Loading Charges',
      RESTRICTED_KEYS.every((k) => !keys.includes(k)))
    ok('USER /api/fields hides restricted display names',
      RESTRICTED_DISPLAYS.every((d) => !displays.includes(d)))

    const recs = await user.call<{ rows: Array<Record<string, unknown>>; total: number }>('GET', '/api/records?start=0&end=5')
    ok('USER /api/records total still visible (operational data)', recs.json.total > 0)
    ok('USER /api/records rows have restricted values stripped',
      recs.json.rows.length > 0 && RESTRICTED_KEYS.every((k) => !(k in recs.json.rows[0])))

    // direct write attempts → 403
    const target = recs.json.rows[0]
    const w1 = await user.call('PATCH', `/api/records/${target.id}`, {
      version: target.version, values: { loadingCharges: 999 },
    })
    ok('USER PATCH loadingCharges → 403', w1.status === 403)
    const w2 = await user.call('PATCH', `/api/records/${target.id}`, {
      version: target.version, values: { vehicleRate: 999 },
    })
    ok('USER PATCH vehicleRate → 403', w2.status === 403)
    const w3 = await user.call('POST', '/api/records', {
      values: { partyName: 'X', lrNo: 999901, destination: 'Y', loadingCharges: 5 },
    })
    ok('USER POST create-with-loadingCharges → 403', w3.status === 403)
    const w4 = await user.call('POST', '/api/records/bulk', {
      changes: [{ id: target.id, version: target.version, values: { vehicleRate: 7 } }],
    })
    ok('USER bulk write vehicleRate → per-item rejection, nothing written',
      w4.status === 200 && (w4.json as { ok: number }).ok === 0)

    // value unchanged after all attempts
    const after = await admin.call<{ record: Record<string, unknown> }>('GET', `/api/records/${target.id}`)
    ok('restricted values untouched by USER write attempts',
      (after.json.record?.loadingCharges ?? null) === (target.loadingCharges ?? null))

    const single = await user.call<{ record: Record<string, unknown> }>('GET', `/api/records/${target.id}`)
    ok('USER single-record GET stripped', RESTRICTED_KEYS.every((k) => !(k in (single.json.record ?? {}))))

    const exp = await user.call('POST', '/api/export', { includeSummary: false })
    ok('USER export succeeds (operational data)',
      exp.status === 200 && (exp.buffer?.length ?? 0) > 5000)
    ok('USER export excludes restricted headers',
      !includesHeaders(exp.buffer!, ['Vehicle Rate', 'LOADING CHARGES']))

    const sug = await user.call('GET', '/api/records/suggest?field=loadingCharges&q=')
    ok('USER suggest on restricted field → 403', sug.status === 403)

    const filtered = await user.call('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ vehicleRate: { filterType: 'number', type: 'greaterThan', filter: 0 } }))}`)
    ok('USER filter on restricted column → 403 (no value oracle)', filtered.status === 403)
    const sorted = await user.call('GET', `/api/records?start=0&end=5&sort=${encodeURIComponent(JSON.stringify([{ colId: 'loadingCharges', sort: 'desc' }]))}`)
    ok('USER sort on restricted column → 403', sorted.status === 403)
    const expFilter = await user.call('POST', '/api/export', {
      filterModel: { vehicleRate: { filterType: 'number', type: 'greaterThan', filter: 0 } },
    })
    ok('USER export filtered on restricted column → 403', expFilter.status === 403)
  }

  // ------------------------------------------------------------------
  console.log('\n[4] VIEWER — restricted tables hidden, no data leaks')
  // ------------------------------------------------------------------
  {
    const fields = await viewer.call<{ fields: Array<{ fieldKey: string }> }>('GET', '/api/fields')
    const keys = fields.json.fields.map((f) => f.fieldKey)
    ok('VIEWER /api/fields hides Vehicle Rate + Loading Charges',
      RESTRICTED_KEYS.every((k) => !keys.includes(k)))

    const recs = await viewer.call<{ rows: Array<Record<string, unknown>> }>('GET', '/api/records?start=0&end=5')
    ok('VIEWER /api/records rows have restricted values stripped',
      recs.json.rows.length > 0 && RESTRICTED_KEYS.every((k) => !(k in recs.json.rows[0])))

    const exp = await viewer.call('POST', '/api/export', { includeSummary: false })
    ok('VIEWER export excludes restricted headers',
      exp.status === 200 && !includesHeaders(exp.buffer!, ['Vehicle Rate', 'LOADING CHARGES']))

    const sug = await viewer.call('GET', '/api/records/suggest?field=vehicleRate&q=')
    ok('VIEWER suggest on restricted field → 403', sug.status === 403)

    // VIEWER cannot write records at all (existing RBAC) — sanity
    const w = await viewer.call('PATCH', `/api/records/${(recs.json.rows[0] as { id: string }).id}`, {
      version: (recs.json.rows[0] as { version: number }).version, values: { partyName: 'nope' },
    })
    ok('VIEWER PATCH record → 403 (existing RBAC)', w.status === 403)
  }

  // ------------------------------------------------------------------
  console.log('\n[5] USER import — restricted columns not mapped, never written')
  // ------------------------------------------------------------------
  {
    // latest-format workbook with values in the restricted columns
    const headers = [
      'SR. NO.', 'PICKUP LOCATION', 'PARTY NAME', 'DESTINATION', 'INVOICE NUMBER',
      'LR. NO.', 'LR DATE', 'MATERIAL DETAILS', 'Bucket', 'TOTAL QUANTITY IN LTRS',
      'LOAD TYPE FTL/PTL', 'EXPECTED DELIVERY DATE', 'ACTUAL DELIVERY DATE',
      'DELIVERY STATUS', 'DAMAGE', 'LOADING CHARGES', 'UNLOADING CHARGES',
      'VEHICLE NUMBER', 'VEHICLE TYPE', 'PLY', 'Remark', 'Dispatch Date',
      'DispatchFrom', 'Dispatch Vehicle', 'Vendor Name', 'Vehicle Rate',
      'POD Status', 'KM', 'Rate', 'Total Rate',
    ]
    const row = [
      1, 'Sonipat', 'TA Restriction Test', 'Testville', 'TA-2026/1', 990_777, '2026-09-01',
      'TATA Motors HP Genuine Def - 1*20L', 5, 100, 'PTL', '2026-09-03', null,
      'Pending', 'No', 555.5, 66.25, 'HR99TT0009', 709, 0,
      'via USER import', '2026-09-02', 'Sonipat WH-B', 'HR99TT0010', 'Drona', 777.75,
      'POD Pending', 100, 10, 1000,
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, row])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'NPL SONIPAT')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(buf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'ta-restriction.xlsx')
    const prev = await fetch(`${BASE}/api/import/preview`, { method: 'POST', headers: { cookie: user.cookie }, body: fd })
    const prevJson = await prev.json() as {
      jobId: string
      rows: Array<{ rowIndex: number; values: Record<string, unknown> }>
      stats: { new: number }
    }
    ok('USER preview succeeds (operational columns import normally)',
      prev.status === 200 && prevJson.stats?.new === 1)
    const vals = prevJson.rows?.[0]?.values ?? {}
    ok('USER preview never captured restricted values',
      !('vehicleRate' in vals) && !('loadingCharges' in vals))

    const conf = await user.call<{ result: { created: number } }>('POST', '/api/import/confirm', {
      jobId: prevJson.jobId, resolutions: {},
      newRows: (prevJson.rows || []).map((r) => r.rowIndex), changedRows: [], deletions: [],
    })
    ok('USER confirm creates the record', conf.json.result?.created === 1)

    // verify as ADMIN: operational columns landed, restricted ones stayed NULL
    const recs = await admin.call<{ rows: Array<Record<string, unknown>> }>('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ lrNo: { filterType: 'number', type: 'equals', filter: 990_777 } }))}`)
    const rec = recs.json.rows[0]
    ok('operational columns imported (dispatchFrom, remark)',
      rec?.dispatchFrom === 'Sonipat WH-B' && rec?.remark === 'via USER import')
    ok('restricted columns NOT written (vehicleRate, loadingCharges stay null)',
      (rec?.vehicleRate ?? null) === null && (rec?.loadingCharges ?? null) === null)
    if (rec) await admin.call('DELETE', `/api/records/${rec.id}`)
  }

  console.log(`\n========= TABLE ACCESS: ${passed} passed, ${failed} failed =========`)
  if (failed > 0) process.exit(1)
}

/** Header scan of an exported workbook buffer. */
function includesHeaders(buffer: Buffer, headers: string[]): boolean {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets['MIS']
  if (!sheet) return false
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  const headerRow = (rows[1] || []).map((c) => String(c ?? '').trim())
  return headers.every((h) => headerRow.includes(h))
}

main().catch((e) => { console.error(e); process.exit(1) })
