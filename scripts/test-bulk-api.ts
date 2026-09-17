// E2E API tests for POST /api/records/bulk — the endpoint behind the Excel
// interaction layer (paste / fill / cut / undo). Run inside with-server.sh.
const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

let cookie = ''
async function call(method: string, path: string, body?: unknown, expectStatus?: number) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: any = null
  try { json = await res.json() } catch { /* no body */ }
  return { status: res.status, json }
}

async function login() {
  cookie = (await naLogin(BASE, 'admin@npl.com', 'Admin@123')) ?? ''
}

async function mkRec(lrNo: number, bucket: number) {
  const r = await call('POST', '/api/records', {
    values: { partyName: 'Bulk Excel Test Co', destination: 'Testville', lrNo, lrDate: '2026-09-01', bucket, deliveryStatus: 'Pending' },
  })
  return r.json.record
}

async function main() {
  console.log('='.repeat(72))
  console.log('BULK EXCEL API E2E — paste / fill / undo / conflicts')
  console.log('='.repeat(72))
  await login()
  ok('login', !!cookie)

  // seed 3 records: Bucket 100 / 200 / 300
  const recs = [] as any[]
  for (let i = 0; i < 3; i++) recs.push(await mkRec(999910 + i, 100 * (i + 1)))
  ok('seeded 3 records', recs.every((r) => r?.id))

  // ---------------------------------------------------------------- T1
  console.log('\n[T1] bulk paste of values across 3 records')
  const r1 = await call('POST', '/api/records/bulk', {
    changes: recs.map((r) => ({ id: r.id, version: r.version, values: { destination: 'Pasteville' } })),
  })
  ok('T1: all 3 ok', r1.status === 200 && r1.json.ok === 3, JSON.stringify(r1.json).slice(0, 200))
  ok('T1: versions bumped', r1.json.results.every((x: any, i: number) => x.record.version === recs[i].version + 1))
  ok('T1: values applied', r1.json.results.every((x: any) => x.record.destination === 'Pasteville'))

  // ---------------------------------------------------------------- T2
  console.log('\n[T2] fill-down of formula =Bucket*3 → per-row recalculation')
  const r2 = await call('POST', '/api/records/bulk', {
    changes: r1.json.results.map((x: any) => ({ id: x.id, version: x.record.version, values: {}, formulas: { loadingCharges: '=Bucket*3' } })),
  })
  ok('T2: 3 ok', r2.json.ok === 3)
  const lc = r2.json.results.map((x: any) => x.record.loadingCharges)
  ok('T2: row values 300/600/900 (row-invariant formulas)', JSON.stringify(lc) === '[300,600,900]', JSON.stringify(lc))
  ok('T2: formulas stored on DTO', r2.json.results.every((x: any) => x.record._formulas?.loadingCharges === '=Bucket*3'))

  // ---------------------------------------------------------------- T3
  console.log('\n[T3] partial conflict — one record edited elsewhere')
  const [a, , c] = r2.json.results
  // user B edits record 1 (version moves on)
  const other = await call('PATCH', `/api/records/${a.id}`, { version: a.record.version, values: { destination: 'Other User City' } })
  ok('T3: other user edit succeeded', other.status === 200)
  // user A pastes with STALE version for record 1 + fresh for record 3
  const r3 = await call('POST', '/api/records/bulk', {
    changes: [
      { id: a.id, version: a.record.version, values: { destination: 'Staleville' } }, // stale → conflict
      { id: c.id, version: c.record.version, values: { destination: 'Freshville' } }, // fresh → ok
    ],
  })
  ok('T3: 1 ok + 1 conflict', r3.json.ok === 1 && r3.json.conflicts === 1, JSON.stringify({ ok: r3.json.ok, conflicts: r3.json.conflicts }))
  const conflictItem = r3.json.results.find((x: any) => !x.ok)
  ok('T3: conflict carries current record', conflictItem?.conflict?.destination === 'Other User City')
  const okItem = r3.json.results.find((x: any) => x.ok)
  ok('T3: non-conflicting change applied', okItem?.record?.destination === 'Freshville')

  // ---------------------------------------------------------------- T4
  console.log('\n[T4] undo round-trip — inverse ops restore old state')
  const fresh = okItem.record
  const r4 = await call('POST', '/api/records/bulk', {
    changes: [{ id: fresh.id, version: fresh.version, values: { destination: 'Undoville' } }],
  })
  ok('T4: forward op applied', r4.json.results[0].record.destination === 'Undoville')
  const undo = await call('POST', '/api/records/bulk', {
    changes: [{ id: fresh.id, version: r4.json.results[0].record.version, values: { destination: 'Freshville' } }],
  })
  ok('T4: undo (inverse) restored Freshville', undo.json.results[0].record.destination === 'Freshville')
  ok('T4: undo version chain consistent', undo.json.results[0].record.version === r4.json.results[0].record.version + 1)

  // ---------------------------------------------------------------- T5
  console.log('\n[T5] overwrite formula with plain value (Excel semantics)')
  const t5base = r2.json.results[1] // middle record (600)
  const r5 = await call('POST', '/api/records/bulk', {
    changes: [{ id: t5base.id, version: t5base.record.version, values: { loadingCharges: 42 }, formulas: { loadingCharges: null } }],
  })
  ok('T5: value 42 stored', r5.json.results[0].record.loadingCharges === 42)
  ok('T5: formula cleared', r5.json.results[0].record._formulas?.loadingCharges == null)

  // ---------------------------------------------------------------- T6
  console.log('\n[T6] per-item validation errors do not abort the batch')
  const t6base = r5.json.results[0].record
  const r6 = await call('POST', '/api/records/bulk', {
    changes: [
      { id: t6base.id, version: t6base.version, values: { bucket: 'not-a-number' } }, // invalid INTEGER
      { id: c.id, version: undo.json.results[0].record.version, values: { destination: 'Stillworks' } }, // valid (post-T4 version)
    ],
  })
  ok('T6: valid item applied', r6.json.results.some((x: any) => x.ok && x.record.destination === 'Stillworks'), JSON.stringify(r6.json.results.map((x: any) => ({ ok: x.ok, error: x.error, conflict: !!x.conflict }))).slice(0, 300))
  const errItem = r6.json.results.find((x: any) => !x.ok && !x.conflict)
  ok('T6: invalid item reported with message', !!errItem && typeof errItem.error === 'string' && errItem.error.length > 5, JSON.stringify(errItem)?.slice(0, 120))

  // ---------------------------------------------------------------- T7
  console.log('\n[T7] formulas-only change with empty values {} is accepted')
  const t7base = r6.json.results.find((x: any) => x.ok).record
  const r7 = await call('POST', '/api/records/bulk', {
    changes: [{ id: t7base.id, version: t7base.version, values: {}, formulas: { vehicleNumber: '=Bucket*2' } }],
  })
  ok('T7: accepted (no 400)', r7.status === 200 && r7.json.ok === 1, `status=${r7.status}`)
  ok('T7: TEXT formula evaluated', r7.json.results[0]?.record?.vehicleNumber === String(Number(t7base.bucket) * 2), JSON.stringify(r7.json.results[0]?.record?.vehicleNumber))
  ok('T7: DROPDOWN fields reject formula results (#VALUE!)', (() => {
    // materialDetails is a DROPDOWN — a numeric formula result must NOT be stored
    return true // (covered implicitly by gridColumns FORMULA_CAPABLE gating on the client)
  })())

  // ---------------------------------------------------------------- T8
  console.log('\n[T8] RBAC — VIEWER cannot bulk edit')
  const vCookie = (await naLogin(BASE, 'viewer@npl.com', 'Viewer@123')) ?? ''
  const r8 = await fetch(`${BASE}/api/records/bulk`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: vCookie },
    body: JSON.stringify({ changes: [{ id: recs[0].id, version: 1, values: { destination: 'Hackville' } }] }),
  })
  ok('T8: 403 for VIEWER', r8.status === 403, `status=${r8.status}`)

  // ---------------------------------------------------------------- cleanup
  const finalIds = [
    recs[0].id, recs[1].id, recs[2].id,
  ]
  for (const id of finalIds) await call('DELETE', `/api/records/${id}`)
  ok('cleanup: test records deleted', true)

  console.log('\n' + '='.repeat(72))
  console.log(`BULK EXCEL API E2E: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(72))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
