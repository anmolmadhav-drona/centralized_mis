// API E2E for the Add-Entry improvements:
//   1. GET /api/records/suggest — core text field, EAV dynamic field, RBAC,
//      validation, LIKE-escaping, limit
//   2. Field registry defaults (pre-fill values for the Add dialog)
//   3. POST /api/records — defaults flow through a create (spot-check)
import { PrismaClient } from '@prisma/client'
import { naLogin } from './lib/na-login'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

async function login(email: string, password: string): Promise<string> {
  return (await naLogin(BASE, email, password)) ?? ''
}

async function get(cookie: string, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

async function main() {
  console.log('— login')
  const admin = await login('admin@npl.com', 'Admin@123')
  const viewer = await login('viewer@npl.com', 'Viewer@123')
  ok('admin login', admin.length > 0)
  ok('viewer login', viewer.length > 0)

  // ------------------------------------------------------------------
  console.log('— suggest: core text fields')
  {
    const { status, body } = await get(admin, '/api/records/suggest?field=partyName&limit=5')
    ok('partyName 200', status === 200, `got ${status} ${JSON.stringify(body).slice(0, 120)}`)
    const list: Array<{ value: string; count: number }> = body?.suggestions ?? []
    ok('partyName ≤5 items', list.length >= 1 && list.length <= 5, `got ${list.length}`)
    ok('counts are positive ints', list.every((s) => Number.isInteger(s.count) && s.count > 0))
    ok('sorted by usage', list.every((s, i) => i === 0 || list[i - 1].count >= s.count))

    // substring search, case-insensitive (SQLite LIKE ASCII)
    const q = await get(admin, '/api/records/suggest?field=partyName&q=ghumman')
    const vals: string[] = (q.body?.suggestions ?? []).map((s: any) => String(s.value))
    ok('q=ghumman finds Ghumman Distributors', vals.some((v) => /ghumman/i.test(v)), JSON.stringify(vals))
    // counts respected: every hit contains the query (case-insensitive)
    ok('every hit contains query', vals.every((v) => v.toLowerCase().includes('ghumman')))

    // destination
    const d = await get(admin, '/api/records/suggest?field=destination&q=delhi')
    const dvals: string[] = (d.body?.suggestions ?? []).map((s: any) => String(s.value))
    ok('destination q=delhi non-empty', dvals.length > 0, JSON.stringify(dvals))

    // dropdown field (materialDetails → DROPDOWN is text-ish, suggestable)
    const m = await get(admin, '/api/records/suggest?field=materialDetails&q=4*5')
    ok('materialDetails q=4*5 works (wildcards escaped, no crash)', m.status === 200, `got ${m.status}`)
    const mvals: string[] = (m.body?.suggestions ?? []).map((s: any) => String(s.value))
    ok('materialDetails hits contain 4*5 literally', mvals.every((v) => v.includes('4*5')) && mvals.length > 0, JSON.stringify(mvals.slice(0, 3)))

    // numeric field rejected
    const n = await get(admin, '/api/records/suggest?field=bucket')
    ok('numeric field → 400', n.status === 400, `got ${n.status}`)
    // unknown field rejected
    const u = await get(admin, '/api/records/suggest?field=nope')
    ok('unknown field → 400', u.status === 400, `got ${u.status}`)
    // bad limit rejected
    const l = await get(admin, '/api/records/suggest?field=partyName&limit=999')
    ok('limit>20 → 400', l.status === 400, `got ${l.status}`)
    // auth required
    const anon = await fetch(`${BASE}/api/records/suggest?field=partyName`)
    ok('anonymous → 401', anon.status === 401, `got ${anon.status}`)
    // viewer can use it (records:view)
    const v = await get(viewer, '/api/records/suggest?field=partyName&limit=3')
    ok('viewer allowed (records:view)', v.status === 200, `got ${v.status}`)
  }

  // ------------------------------------------------------------------
  console.log('— suggest: dynamic (EAV) field')
  {
    // create a temp dynamic field + values on two records
    await db.misField.create({
      data: {
        fieldKey: 'e2eSuggestTag', fieldName: 'E2E Suggest Tag', displayName: 'E2E Suggest Tag',
        dataType: 'TEXT', required: false, options: null, position: 900,
        isCore: false, isSystem: false, active: true, createdBy: 'e2e',
      },
    }).catch(() => {/* already exists from a previous run */})
    const field = await db.misField.findUnique({ where: { fieldKey: 'e2eSuggestTag' } })
    const recs = await db.misRecord.findMany({ take: 3, orderBy: { id: 'asc' } })
    await db.misValue.deleteMany({ where: { fieldId: field!.id } })
    await db.misValue.createMany({
      data: [
        { recordId: recs[0].id, fieldId: field!.id, valueText: 'Alpha Tag' },
        { recordId: recs[1].id, fieldId: field!.id, valueText: 'Alpha Tag' },
        { recordId: recs[2].id, fieldId: field!.id, valueText: 'Beta Tag' },
      ],
    })
    // The server caches the field registry for 15s (CACHE_TTL_MS in
    // services/fields.ts). We just created this field directly via Prisma,
    // bypassing the API (which would invalidate the cache) — wait out the TTL
    // so the suggest route can see the new EAV field.
    await new Promise((r) => setTimeout(r, 16_000))
    const { status, body } = await get(admin, '/api/records/suggest?field=e2eSuggestTag')
    const list: Array<{ value: string; count: number }> = body?.suggestions ?? []
    ok('EAV suggest 200', status === 200, `got ${status}`)
    ok('EAV counts: Alpha 2, Beta 1',
      list.find((s) => s.value === 'Alpha Tag')?.count === 2 && list.find((s) => s.value === 'Beta Tag')?.count === 1,
      JSON.stringify(list))
    const q = await get(admin, '/api/records/suggest?field=e2eSuggestTag&q=beta')
    ok('EAV filtered q=beta', (q.body?.suggestions ?? []).length === 1, JSON.stringify(q.body?.suggestions))
  }

  // ------------------------------------------------------------------
  console.log('— registry defaults (Add-Entry pre-fill)')
  {
    const expected: Record<string, string> = {
      pickupLocation: 'Sonipat', transporterName: 'Drona Logitech', lrStatus: 'To be Billed',
      damage: 'No', vehicleType: '709', ply: '0', loadType: 'PTL',
      deliveryStatus: 'Pending', podStatus: 'POD Pending',
    }
    for (const [key, def] of Object.entries(expected)) {
      const f = await db.misField.findUnique({ where: { fieldKey: key } })
      ok(`default ${key}='${def}'`, f?.defaultValue === def, `got '${f?.defaultValue}'`)
    }
    // defaults are valid options where the field is a dropdown
    for (const key of ['lrStatus', 'damage', 'loadType', 'deliveryStatus', 'podStatus']) {
      const f = await db.misField.findUnique({ where: { fieldKey: key } })
      const opts = f?.options ? JSON.parse(f.options) : []
      ok(`default of ${key} is an allowed option`, opts.includes(f?.defaultValue ?? '∅'))
    }
    // the /api/fields registry surface exposes defaultValue to the form
    const { body } = await get(admin, '/api/fields')
    const pickup = (body?.fields ?? []).find((f: any) => f.fieldKey === 'pickupLocation')
    ok('GET /api/fields exposes defaultValue', pickup?.defaultValue === 'Sonipat', JSON.stringify(pickup))
  }

  // ------------------------------------------------------------------
  console.log('— create with defaults (payload from the form pre-fill)')
  {
    const res = await fetch(`${BASE}/api/records`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({
        values: {
          partyName: 'Suggest E2E Co', destination: 'Test Delhi', lrNo: 999951, lrDate: '2026-09-12',
          // the pre-filled defaults a user would leave untouched:
          pickupLocation: 'Sonipat', transporterName: 'Drona Logitech',
          lrStatus: 'To be Billed', damage: 'No', vehicleType: 709, ply: 0,
          loadType: 'PTL', deliveryStatus: 'Pending', podStatus: 'POD Pending',
        },
      }),
    })
    const body = await res.json().catch(() => null)
    ok('create 201', res.status === 201, `${res.status} ${JSON.stringify(body).slice(0, 200)}`)
    const rec = body?.record
    ok('defaults stored', rec?.pickupLocation === 'Sonipat' && rec?.lrStatus === 'To be Billed' && rec?.deliveryStatus === 'Pending')
    if (rec?.id) {
      const del = await fetch(`${BASE}/api/records/${rec.id}`, { method: 'DELETE', headers: { cookie: admin } })
      ok('cleanup delete 200', del.status === 200, `got ${del.status}`)
    }
  }

  // ------------------------------------------------------------------
  console.log('— cleanup')
  {
    const field = await db.misField.findUnique({ where: { fieldKey: 'e2eSuggestTag' } })
    if (field) {
      await db.misValue.deleteMany({ where: { fieldId: field.id } })
      await db.misField.delete({ where: { id: field.id } })
    }
    await db.misRecord.deleteMany({ where: { partyName: 'Suggest E2E Co' } })
    ok('EAV test field + values removed', true)
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
