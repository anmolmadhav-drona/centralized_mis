// Formula engine + delivery status — API E2E test (user scenarios T1–T7)
// Run: npx tsx scripts/test-formula-api.ts   (server on :3000)
const BASE = 'http://localhost:3000'

function makeClient() {
  const cookies: string[] = []
  return {
    async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = {}
      if (cookies.length) headers.cookie = cookies.join('; ')
      let payload: BodyInit | undefined
      if (body !== undefined) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const res = await fetch(BASE + path, { method, headers, body: payload })
      const setCookie = res.headers.getSetCookie?.() || []
      for (const c of setCookie) {
        const kv = c.split(';')[0]
        const i = cookies.findIndex((x) => x.split('=')[0] === kv.split('=')[0])
        if (i >= 0) cookies[i] = kv
        else cookies.push(kv)
      }
      const ct = res.headers.get('content-type') || ''
      const json = ct.includes('json') ? await res.json().catch(() => ({})) : {}
      return { status: res.status, json }
    },
    async login(email: string, password: string): Promise<number> {
      const { naLogin } = await import('./lib/na-login')
      const cookie = await naLogin(BASE, email, password)
      if (cookie) {
        const i = cookies.findIndex((x) => x.split('=')[0] === cookie.split('=')[0])
        if (i >= 0) cookies[i] = cookie
        else cookies.push(cookie)
        return 200
      }
      return 401
    },
  }
}

let passed = 0
let failed = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} ${detail}`) }
}

async function main() {
  console.log('='.repeat(72))
  console.log('FORMULA ENGINE + DELIVERY STATUS — API E2E')
  console.log('='.repeat(72))

  // pre-clean any leftovers from earlier failed runs
  const preCookie = (await naLogin(BASE, 'admin@npl.com', 'Admin@123')) ?? ''
  for (const lr of [999901, 999902, 999950]) {
    const page = await fetch(`${BASE}/api/records?search=${lr}`, { headers: { cookie: preCookie } })
    const body = await page.json().catch(() => ({ rows: [] }))
    for (const row of body.rows || []) {
      await fetch(`${BASE}/api/records/${row.id}`, { method: 'DELETE', headers: { cookie: preCookie } })
    }
  }

  const admin = makeClient()
  await admin.login('admin@npl.com', 'Admin@123')
  const manager = makeClient()
  await manager.login('manager@npl.com', 'Manager@123')

  // ---------- create a test record with Bucket=100 ----------
  console.log('\n[1] T1 — LoadingCharges = =Bucket*3 → 300')
  const created = await admin.call('POST', '/api/records', {
    values: { partyName: 'Formula Test Co', destination: 'Testville', lrNo: 999901, lrDate: '2026-09-01', bucket: 100, deliveryStatus: 'Pending' },
  })
  ok('create record', created.status === 201)
  const id = created.json.record.id
  const r1 = await admin.call('PATCH', `/api/records/${id}`, {
    version: created.json.record.version,
    values: {},
    formulas: { loadingCharges: '=Bucket*3' },
  })
  ok('T1: loadingCharges = 300', r1.json.record?.loadingCharges === 300, `got ${r1.json.record?.loadingCharges}`)
  ok('T1: formula stored on DTO', r1.json.record?._formulas?.loadingCharges === '=Bucket*3', JSON.stringify(r1.json.record?._formulas))

  // ---------- T2 ----------
  console.log('\n[2] T2 — Bucket 100→200 → auto 600')
  const r2 = await admin.call('PATCH', `/api/records/${id}`, { version: r1.json.record.version, values: { bucket: 200 } })
  ok('T2: loadingCharges auto-recalc = 600', r2.json.record?.loadingCharges === 600, `got ${r2.json.record?.loadingCharges}`)

  // ---------- T3 ----------
  console.log('\n[3] T3 — dynamic LoadingRate=4, =Bucket*LoadingRate → 800')
  const lrField = await admin.call('POST', '/api/fields', { fieldName: 'Loading Rate', dataType: 'DECIMAL', position: 'last' })
  const lrKey = lrField.json.field.fieldKey
  const r3 = await admin.call('PATCH', `/api/records/${id}`, {
    version: r2.json.record.version,
    values: { [lrKey]: 4 },
    formulas: { loadingCharges: '=Bucket*LoadingRate' },
  })
  ok('T3: loadingCharges = 800', r3.json.record?.loadingCharges === 800, `got ${r3.json.record?.loadingCharges}`)

  // ---------- T4 ----------
  console.log('\n[4] T4 — TransportCharges=500, TotalCharges==LoadingCharges+TransportCharges → 1300')
  const tcField = await admin.call('POST', '/api/fields', { fieldName: 'Transport Charges', dataType: 'DECIMAL', position: 'last' })
  const totField = await admin.call('POST', '/api/fields', { fieldName: 'Total Charges', dataType: 'DECIMAL', position: 'last' })
  const tcKey = tcField.json.field.fieldKey
  const totKey = totField.json.field.fieldKey
  const r4 = await admin.call('PATCH', `/api/records/${id}`, {
    version: r3.json.record.version,
    values: { [tcKey]: 500 },
    formulas: { [totKey]: '=LoadingCharges+TransportCharges' },
  })
  ok('T4: totalCharges = 1300', r4.json.record?.[totKey] === 1300, `got ${r4.json.record?.[totKey]}`)

  // ---------- T5 ----------
  console.log('\n[5] T5 — LoadingRate 4→5 → LC=1000 AND Total=1500')
  const r5 = await admin.call('PATCH', `/api/records/${id}`, { version: r4.json.record.version, values: { [lrKey]: 5 } })
  ok('T5: loadingCharges auto = 1000', r5.json.record?.loadingCharges === 1000, `got ${r5.json.record?.loadingCharges}`)
  ok('T5: totalCharges auto = 1500', r5.json.record?.[totKey] === 1500, `got ${r5.json.record?.[totKey]}`)

  // ---------- error handling ----------
  console.log('\n[6] Formula validation & errors')
  const bad = await admin.call('PATCH', `/api/records/${id}`, { version: r5.json.record.version, values: {}, formulas: { loadingCharges: '=Bucket*ABC' } })
  ok('=Bucket*ABC → #REF! error cell shown', bad.json.record?._formulaErrors?.loadingCharges?.code === '#REF!' && /Unknown column "ABC"/.test(bad.json.record?._formulaErrors?.loadingCharges?.message || ''), JSON.stringify(bad.json.record?._formulaErrors))

  const div0 = await admin.call('PATCH', `/api/records/${id}`, { version: bad.json.record.version, values: {}, formulas: { loadingCharges: '=1/0' } })
  ok('=1/0 → stored as #DIV/0! error cell', div0.json.record?._formulaErrors?.loadingCharges?.code === '#DIV/0!', JSON.stringify(div0.json.record?._formulaErrors))

  const cleared = await admin.call('PATCH', `/api/records/${id}`, {
    version: div0.json.record.version,
    values: { loadingCharges: 42 },
    formulas: { loadingCharges: null },
  })
  ok('plain value clears formula', cleared.json.record?.loadingCharges === 42 && !cleared.json.record?._formulas?.loadingCharges, JSON.stringify(cleared.json.record?._formulas))

  // circular reference
  const circ = await admin.call('PATCH', `/api/records/${id}`, {
    version: cleared.json.record.version,
    values: {},
    formulas: { loadingCharges: '=LoadingCharges*2' },
  })
  ok('self-reference → #CYCLE! error cell', circ.json.record?._formulaErrors?.loadingCharges?.code === '#CYCLE!', JSON.stringify(circ.json.record?._formulaErrors))
  const vAfterCirc = circ.json.record?.version ?? cleared.json.record.version

  // ---------- delivery status ----------
  console.log('\n[7] Delivery status integration (T7)')
  const lookup = await admin.call('GET', '/api/delivery/status?trackingId=LR-999901')
  ok('T7: lookup by tracking ID', lookup.status === 200 && lookup.json.delivery?.trackingId === 'LR-999901', JSON.stringify(lookup.json).slice(0, 140))
  ok('T7: live status derived', lookup.json.delivery?.liveStatus === 'Pending', `got ${lookup.json.delivery?.liveStatus}`)

  const afterDate = await admin.call('PATCH', `/api/records/${id}`, { version: vAfterCirc, values: { actualDeliveryDate: '2026-09-01' } })
  ok('auto-sync: actualDeliveryDate → Delivered', afterDate.json.record?.liveStatus === 'Delivered', `got ${afterDate.json.record?.liveStatus}`)
  ok('auto-sync: lastStatusUpdate set', !!afterDate.json.record?.lastStatusUpdate)

  const summary = await admin.call('GET', '/api/delivery/status?mode=summary')
  const totalSum = (summary.json.byStatus || []).reduce((s: number, x: { count: number }) => s + x.count, 0)
  ok('delivery summary counts match total', summary.json.total === totalSum && summary.json.total >= 340, `${summary.json.total} vs ${totalSum}`)

  // ---------- bulk PATCH ----------
  console.log('\n[8] Bulk PATCH (multi-record persistence)')
  const rec2 = await admin.call('POST', '/api/records', { values: { partyName: 'Formula Test Co 2', destination: 'Testville', lrNo: 999902, lrDate: '2026-09-01', bucket: 10 } })
  const bulk = await admin.call('POST', '/api/records/bulk', {
    changes: [
      { id, version: afterDate.json.record.version, values: { bucket: 300 } },
      { id: rec2.json.record.id, version: rec2.json.record.version, values: { bucket: 77 } },
    ],
  })
  ok('bulk: both records updated', bulk.json.ok === 2, JSON.stringify(bulk.json).slice(0, 120))

  // ---------- T6: two users, different records, simultaneously ----------
  console.log('\n[9] T6 — concurrent multi-user editing')
  const [aGet, bGet] = await Promise.all([
    admin.call('GET', `/api/records/${id}`),
    manager.call('GET', `/api/records/${rec2.json.record.id}`),
  ])
  const [aPatch, bPatch] = await Promise.all([
    admin.call('PATCH', `/api/records/${id}`, { version: aGet.json.record.version, values: { destination: 'UserA-Edit' } }),
    manager.call('PATCH', `/api/records/${rec2.json.record.id}`, { version: bGet.json.record.version, values: { destination: 'UserB-Edit' } }),
  ])
  ok('T6: different records — both changes preserved', aPatch.json.record?.destination === 'UserA-Edit' && bPatch.json.record?.destination === 'UserB-Edit')

  const [s1, s2] = await Promise.all([
    admin.call('GET', `/api/records/${id}`),
    manager.call('GET', `/api/records/${id}`),
  ])
  const [w1, w2] = await Promise.all([
    admin.call('PATCH', `/api/records/${id}`, { version: s1.json.record.version, values: { partyName: 'Admin-Wins' } }),
    manager.call('PATCH', `/api/records/${id}`, { version: s2.json.record.version, values: { partyName: 'Manager-Wins' } }),
  ])
  const firstWon = w1.status === 200 ? w1.json.record : w2.json.record
  ok('T6: same record — optimistic lock 409 for the loser', (w1.status === 200) !== (w2.status === 200), `w1=${w1.status} w2=${w2.status}`)
  ok('T6: no silent overwrite', firstWon.partyName === (w1.status === 200 ? 'Admin-Wins' : 'Manager-Wins'), firstWon.partyName)

  // ---------- export with formulas ----------
  console.log('\n[10] Export formula preservation')
  await admin.call('PATCH', `/api/records/${id}`, { version: (w1.status === 200 ? w1.json.record : w2.json.record).version, values: {}, formulas: { loadingCharges: '=Bucket*3' } })
  const exp = await fetch(`${BASE}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: (await loginCookie()) },
    body: JSON.stringify({ search: '999901', includeSummary: false }),
  })
  ok('export 200', exp.status === 200)
  const buf = Buffer.from(await exp.arrayBuffer())
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { cellFormula: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  let foundFormula = false
  let formulaText = ''
  for (const addr of Object.keys(ws)) {
    const cell = ws[addr] as { f?: string; v?: unknown }
    if (cell && typeof cell.f === 'string' && /Loading/i.test(String(cell.v ?? '')) === false && cell.f.includes('*')) {
      // any formula cell with a multiplication — our translated =B{row}*3
      if (/^[A-Z]+\d+\*3$/.test(cell.f)) { foundFormula = true; formulaText = cell.f }
    }
  }
  ok('export contains live Excel formula', foundFormula, `expected e.g. K5*3 — got: ${formulaText}`)

  // ---------- import with formulas (round-trip) ----------
  console.log('\n[11] Import formula round-trip')
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'formula-test.xlsx')
  const impRes = await fetch(`${BASE}/api/import/preview`, {
    method: 'POST',
    headers: { cookie: (await loginCookie()) },
    body: form,
  })
  const imp = await impRes.json()
  ok('import preview 200', impRes.status === 200, JSON.stringify(imp).slice(0, 200))

  // ---------- cleanup ----------
  await admin.call('DELETE', `/api/records/${id}`)
  await admin.call('DELETE', `/api/records/${rec2.json.record.id}`)
  for (const f of [lrField, tcField, totField]) {
    await admin.call('DELETE', `/api/fields/${f.json.field.id}`)
  }
  console.log('\ncleanup done')

  console.log('\n' + '='.repeat(72))
  console.log(`${passed} passed, ${failed} failed`)
  console.log('='.repeat(72))
  process.exit(failed > 0 ? 1 : 0)
}

let cachedCookie: string | null = null
async function loginCookie(): Promise<string> {
  if (cachedCookie) return cachedCookie
  cachedCookie = (await naLogin(BASE, 'admin@npl.com', 'Admin@123')) ?? ''
  return cachedCookie
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
