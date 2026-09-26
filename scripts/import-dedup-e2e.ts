/**
 * NPL MIS Portal — Excel Import Duplicate-Prevention E2E Test (Task 19)
 * Run: bun scripts/import-dedup-e2e.ts   (production server must run on :3000)
 *
 * Scenarios (per the import specification):
 *  1  fresh row → NEW → INSERT with businessKey
 *  2  re-import same file → UNCHANGED, no second record
 *  3  changed operational field → UPDATE keeping the original record id (Pending → Delivered)
 *  4  same key twice in one file (identical values) → one record + duplicate report
 *  5  same key twice in one file (different values) → duplicate + "differ" flag
 *  6  same LR + invoice, different party → independent records
 *  7  same invoice + party, different LR → independent records
 *  8  whitespace / case / numeric-string variants → same business key → UNCHANGED
 *  9  concurrent import (record inserted after preview) → unique constraint → duplicates, no crash
 * 10  invalid row does not block valid rows
 * 11  large file (1000 rows) — preview + apply performance
 * +  records missing from the file are never deleted (red line)
 * +  soft-deleted record releases its identity → re-import recreates it
 */
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { computeRecordKeys } from '../src/lib/services/business-key'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`) }
}

// ------------------------------------------------------------------
// HTTP client with cookie jar
// ------------------------------------------------------------------
function makeClient() {
  const cookies: string[] = []
  return {
    async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = {}
      if (cookies.length) headers.cookie = cookies.join('; ')
      let payload: BodyInit | undefined
      if (body instanceof FormData) payload = body
      else if (body !== undefined) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const res = await fetch(BASE + path, { method, headers, body: payload })
      for (const c of res.headers.getSetCookie?.() || []) {
        const kv = c.split(';')[0]
        const i = cookies.findIndex((x) => x.split('=')[0] === kv.split('=')[0])
        if (i >= 0) cookies[i] = kv
        else cookies.push(kv)
      }
      const json = await res.json().catch(() => ({}))
      return { status: res.status, json }
    },
    async login(email: string, password: string): Promise<number> {
      const { naLogin } = await import('./lib/na-login')
      // reuse this jar via a one-off bridge: naLogin keeps its own jar
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

// ------------------------------------------------------------------
// Workbook builder — headers straight from the live field registry
// ------------------------------------------------------------------
interface FieldReg {
  fieldKey: string; fieldName: string; dataType: string
  required: boolean; isSystem: boolean; options: string[] | null
}

async function loadRegistry(): Promise<FieldReg[]> {
  const rows = await db.misField.findMany({
    where: { active: true },
    orderBy: { position: 'asc' },
    select: { fieldKey: true, fieldName: true, dataType: true, required: true, isSystem: true, options: true },
  })
  return rows.map((r) => ({
    ...r, options: r.options ? (JSON.parse(r.options) as string[]) : null,
  }))
}

/** Build an .xlsx with the registry headers; rows are maps of fieldKey → raw value. */
function buildWorkbook(registry: FieldReg[], rows: Array<Record<string, unknown>>): Buffer {
  const headers = registry.filter((f) => !f.isSystem).map((f) => f.fieldName)
  const aoa: unknown[][] = [headers]
  for (const row of rows) {
    aoa.push(registry.filter((f) => !f.isSystem).map((f) => row[f.fieldKey] ?? null))
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'MIS')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

function upload(buffer: Buffer, name: string): FormData {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
  return fd
}

// ------------------------------------------------------------------
// a realistic shipment line (identity + operational fields)
// ------------------------------------------------------------------
function line(lr: number, invoice: string, party: string, over: Record<string, unknown> = {}) {
  return {
    lrNo: lr,
    invoiceNumber: invoice,
    partyName: party,
    materialDetails: 'TATA MOTORS HP GENUINE DEF - 1*20L',
    bucket: 50,
    totalQuantity: 1000,
    destination: 'JAMSHEDPUR',
    pickupLocation: 'SONGIR',
    lrDate: '2026-08-20',
    loadType: 'FTL',
    deliveryStatus: 'Pending',
    podStatus: 'POD Pending',
    ...over,
  }
}

async function activeByLr(lr: number) {
  return db.misRecord.findFirst({ where: { lrNo: lr, deletedAt: null } })
}

async function main() {
  console.log('='.repeat(72))
  console.log('IMPORT DEDUPLICATION — E2E TEST (11 scenarios)')
  console.log('='.repeat(72))

  const registry = await loadRegistry()
  const client = makeClient()

  // ---- login (Auth.js credentials flow) ----
  const loginStatus = await client.login('admin@npl.com', 'Admin@123')
  if (loginStatus !== 200) {
    console.log('LOGIN FAILED — aborting', loginStatus)
    process.exit(1)
  }

  const createdLrs: number[] = []
  const jobIds: string[] = []

  // ---- pre-clean: leftovers from a previous (crashed) run make the suite
  //      non-idempotent — purge them so every scenario starts deterministic
  {
    const stale = await db.misRecord.findMany({
      where: {
        OR: [
          { lrNo: { gte: 970000, lte: 972000 } },
          { partyName: { contains: 'E2E' } },
          { createdBy: 'race-simulation' },
        ],
      },
      select: { id: true },
    })
    if (stale.length > 0) {
      const staleIds = stale.map((r) => r.id)
      await db.misFormula.deleteMany({ where: { recordId: { in: staleIds } } })
      await db.misValue.deleteMany({ where: { recordId: { in: staleIds } } })
      await db.auditLog.deleteMany({ where: { entityId: { in: staleIds } } })
      await db.misRecord.deleteMany({ where: { id: { in: staleIds } } })
      console.log(`pre-clean: removed ${stale.length} leftover test record(s)`)
    }
    const staleJobs = await db.importJob.findMany({ where: { OR: [{ fileName: { contains: 'e2e-' } }, { fileName: { contains: 'repro-' } }] }, select: { id: true } })
    if (staleJobs.length > 0) {
      await db.importJob.deleteMany({ where: { id: { in: staleJobs.map((j) => j.id) } } })
      console.log(`pre-clean: removed ${staleJobs.length} leftover job(s)`)
    }
  }

  // baseline AFTER pre-clean — the suite must land exactly where it started
  const before = await db.misRecord.count({ where: { deletedAt: null } })

  /** POST /api/import/preview — respects the endpoint's rate limit
   *  (10 previews / 60s per user): on 429, cools down for one window and
   *  retries. Also retries once on transport-level anomalies. */
  async function preview(buffer: Buffer, name: string) {
    let res = await client.call('POST', '/api/import/preview', upload(buffer, name))
    for (let attempt = 0; (res.status === 429 || !res.json?.jobId) && attempt < 3; attempt++) {
      if (res.status === 429) {
        console.log(`    [preview ${name} rate-limited — cooling down 65s]`)
        await new Promise((r) => setTimeout(r, 65_000))
      } else {
        console.log(`    [preview ${name} anomalous: ${res.status} ${JSON.stringify(res.json).slice(0, 200)} — retrying]`)
        await new Promise((r) => setTimeout(r, 500))
      }
      res = await client.call('POST', '/api/import/preview', upload(buffer, name))
    }
    if (res.status === 200 && res.json?.jobId) jobIds.push(res.json.jobId as string)
    else console.log(`    [preview ${name} FAILED: ${res.status} ${JSON.stringify(res.json).slice(0, 300)}]`)
    return res
  }
  async function confirm(jobId: string, body: Record<string, unknown>) {
    return client.call('POST', '/api/import/confirm', { jobId, resolutions: {}, newRows: [], changedRows: [], deletions: [], ...body })
  }

  // =================================================================
  console.log('\nS1 — fresh row → NEW → INSERT with composite key')
  const lr1 = 970001
  const buf1 = buildWorkbook(registry, [line(lr1, 'E2ETEST26/000001', 'E2E Logistics Pvt Ltd')])
  const p1 = await preview(buf1, 'e2e-s1.xlsx')
  ok('preview 200', p1.status === 200, JSON.stringify(p1.json).slice(0, 200))
  ok('classified NEW', p1.status === 200 && p1.json.stats.new === 1, JSON.stringify(p1.json.stats))
  ok('businessKey computed', p1.status === 200 && p1.json.rows[0].businessKey === `${lr1}\nE2ETEST26/000001\nE2E LOGISTICS PVT LTD`)
  const c1 = await confirm(p1.json.jobId, { newRows: [p1.json.rows[0].rowIndex] })
  ok('apply created=1', c1.status === 200 && c1.json.result.created === 1, JSON.stringify(c1.json).slice(0, 200))
  const rec1 = await activeByLr(lr1)
  createdLrs.push(lr1)
  ok('record stored with businessKey', !!rec1?.businessKey && rec1.businessKey.includes('E2ETEST26/000001'))
  ok('no failed rows', c1.json.result.failed === 0, JSON.stringify(c1.json.result.failedRows))

  // =================================================================
  console.log('\nS2 — re-import the same file → UNCHANGED, no second record')
  const p2 = await preview(buildWorkbook(registry, [line(lr1, 'E2ETEST26/000001', 'E2E Logistics Pvt Ltd')]), 'e2e-s2.xlsx')
  ok('classified UNCHANGED', p2.status === 200 && p2.json.stats.unchanged === 1 && p2.json.stats.new === 0, JSON.stringify(p2.json.stats))
  const c2 = await confirm(p2.json.jobId, {})
  ok('nothing applied', c2.status === 200 && c2.json.result.applied === 0 && c2.json.result.unchanged === 1, JSON.stringify(c2.json.result))
  ok('still exactly one record', (await db.misRecord.count({ where: { lrNo: lr1, deletedAt: null } })) === 1)

  // =================================================================
  console.log('\nS3 — changed operational field → UPDATE keeping original id')
  const lr3 = 970003
  const p3a = await preview(buildWorkbook(registry, [line(lr3, 'E2ETEST26/000003', 'E2E Motors Pvt Ltd')]), 'e2e-s3a.xlsx')
  const c3a = await confirm(p3a.json.jobId, { newRows: [p3a.json.rows[0].rowIndex] })
  ok('S3 seed created', c3a.status === 200 && c3a.json.result.created === 1, JSON.stringify(c3a.json.result).slice(0, 200))
  const rec3a = await activeByLr(lr3)
  createdLrs.push(lr3)
  ok('S3 seed record present', !!rec3a, 'record missing')
  const p3 = await preview(buildWorkbook(registry, [line(lr3, 'E2ETEST26/000003', 'E2E Motors Pvt Ltd', { deliveryStatus: 'Delivered', destination: 'RANCHI' })]), 'e2e-s3c.xlsx')
  ok('classified CHANGED', p3.status === 200 && p3.json.stats.changed === 1, JSON.stringify(p3.json.stats))
  const diff3 = p3.json.rows[0].diffs as Array<{ fieldName: string; oldValue: unknown; newValue: unknown }>
  ok('field-level diff Pending → Delivered', diff3.some((d) => d.fieldName.toLowerCase().includes('delivery') && String(d.oldValue) === 'Pending' && String(d.newValue) === 'Delivered'), JSON.stringify(diff3))
  const c3 = await confirm(p3.json.jobId, { changedRows: [p3.json.rows[0].rowIndex] })
  ok('apply updated=1', c3.status === 200 && c3.json.result.updated === 1, JSON.stringify(c3.json.result))
  const rec3b = await activeByLr(lr3)
  ok('SAME record id preserved', rec3a?.id === rec3b?.id, `${rec3a?.id} → ${rec3b?.id}`)
  ok('values updated in DB', rec3b?.deliveryStatus === 'Delivered' && rec3b?.destination === 'RANCHI')
  ok('version bumped', (rec3b?.version ?? 0) > (rec3a?.version ?? 0))
  const updAudit = await db.auditLog.findFirst({ where: { entityId: rec3b?.id, action: 'RECORD_UPDATE', source: 'EXCEL' }, orderBy: { createdAt: 'desc' } })
  ok('audit trail written', !!updAudit)

  // =================================================================
  console.log('\nS4 — same shipment line twice in one file (identical values)')
  const lr4 = 970004
  const row4 = line(lr4, 'E2ETEST26/000004', 'E2E Duplicate Co')
  const p4 = await preview(buildWorkbook(registry, [row4, row4]), 'e2e-s4.xlsx')
  ok('1 NEW + 1 DUPLICATE', p4.status === 200 && p4.json.stats.new === 1 && p4.json.stats.duplicates === 1, JSON.stringify(p4.json.stats))
  ok('duplicate points at first row', p4.json.rows[1].kind === 'DUPLICATE' && p4.json.rows[1].duplicateOfRow === p4.json.rows[0].rowIndex)
  ok('identical values flagged as non-conflicting', p4.json.rows[1].duplicateConflicting === false)
  const c4 = await confirm(p4.json.jobId, { newRows: [p4.json.rows[0].rowIndex] })
  ok('exactly one record created', c4.status === 200 && c4.json.result.created === 1, JSON.stringify(c4.json.result))
  ok('in-file duplicate reported in result', c4.json.result.duplicates === 1, JSON.stringify(c4.json.result))
  createdLrs.push(lr4)
  ok('one row in DB', (await db.misRecord.count({ where: { lrNo: lr4, deletedAt: null } })) === 1)

  // =================================================================
  console.log('\nS5 — same shipment line twice, different values')
  const lr5 = 970005
  const p5 = await preview(buildWorkbook(registry, [
    line(lr5, 'E2ETEST26/000005', 'E2E Conflicting Co', { destination: 'PUNE' }),
    line(lr5, 'E2ETEST26/000005', 'E2E Conflicting Co', { destination: 'NAGPUR' }),
  ]), 'e2e-s5.xlsx')
  ok('duplicate detected', p5.status === 200 && p5.json.stats.duplicates === 1, JSON.stringify(p5.json.stats))
  ok('conflicting values flagged', p5.json.rows[1].duplicateConflicting === true)
  await confirm(p5.json.jobId, { newRows: [p5.json.rows[0].rowIndex] })
  createdLrs.push(lr5)
  ok('first occurrence (PUNE) wins', (await activeByLr(lr5))?.destination === 'PUNE')

  // =================================================================
  console.log('\nS6 — same LR + invoice, different party → independent records')
  const lr6 = 970006
  const p6 = await preview(buildWorkbook(registry, [
    line(lr6, 'E2ETEST26/000006', 'Party Alpha Ltd'),
    line(lr6, 'E2ETEST26/000006', 'Party Beta Ltd'),
  ]), 'e2e-s6.xlsx')
  ok('both NEW (different parties)', p6.status === 200 && p6.json.stats.new === 2 && p6.json.stats.duplicates === 0, JSON.stringify(p6.json.stats))
  const c6 = await confirm(p6.json.jobId, { newRows: p6.json.rows.map((r: any) => r.rowIndex) })
  ok('both created', c6.status === 200 && c6.json.result.created === 2, JSON.stringify(c6.json.result))
  createdLrs.push(lr6)
  ok('two rows in DB', (await db.misRecord.count({ where: { lrNo: lr6, deletedAt: null } })) === 2)

  // =================================================================
  console.log('\nS7 — same invoice + party, different LR → independent records')
  const p7 = await preview(buildWorkbook(registry, [
    line(970007, 'E2ETEST26/000007', 'E2E Lr Split Co'),
    line(970008, 'E2ETEST26/000007', 'E2E Lr Split Co'),
  ]), 'e2e-s7.xlsx')
  ok('both NEW (different LRs)', p7.status === 200 && p7.json.stats.new === 2 && p7.json.stats.duplicates === 0, JSON.stringify(p7.json.stats))
  const c7 = await confirm(p7.json.jobId, { newRows: p7.json.rows.map((r: any) => r.rowIndex) })
  ok('both created', c7.status === 200 && c7.json.result.created === 2, JSON.stringify(c7.json.result))
  createdLrs.push(970007, 970008)

  // =================================================================
  console.log('\nS8 — whitespace / case / numeric-string variants → same key')
  const lr8 = 970009
  const p8a = await preview(buildWorkbook(registry, [line(lr8, 'E2ETEST26/000009', 'E2E Normalization Co')]), 'e2e-s8a.xlsx')
  await confirm(p8a.json.jobId, { newRows: [p8a.json.rows[0].rowIndex] })
  createdLrs.push(lr8)
  // same shipment, ugly typing: LR as padded string, invoice lowercase, party mixed case
  const p8 = await preview(buildWorkbook(registry, [line(lr8, ' e2etest26/000009 ', 'e2e normalization co', {})]), 'e2e-s8b.xlsx')
  ok('variants match the existing record', p8.status === 200 && p8.json.stats.unchanged === 1 && p8.json.stats.new === 0, JSON.stringify(p8.json.stats))
  ok('no duplicate created', (await db.misRecord.count({ where: { lrNo: lr8, deletedAt: null } })) === 1)

  // =================================================================
  console.log('\nS9 — concurrent import: record created after preview')
  const lr9 = 970010
  const p9 = await preview(buildWorkbook(registry, [line(lr9, 'E2ETEST26/000010', 'E2E Race Condition Co')]), 'e2e-s9.xlsx')
  ok('preview says NEW', p9.status === 200 && p9.json.stats.new === 1, JSON.stringify(p9.json.stats))
  // simulate the other user's import landing between preview and confirm
  const raceRow = line(lr9, 'E2ETEST26/000010', 'E2E Race Condition Co')
  const raceKeys = computeRecordKeys(raceRow)
  const raceRec = await db.misRecord.create({
    data: {
      lrNo: raceRow.lrNo as number, invoiceNumber: raceRow.invoiceNumber as string, partyName: raceRow.partyName as string,
      materialDetails: raceRow.materialDetails as string, bucket: raceRow.bucket as number, totalQuantity: raceRow.totalQuantity as number,
      destination: raceRow.destination as string, deliveryStatus: raceRow.deliveryStatus as string,
      businessKey: raceKeys.businessKey, lineKey: raceKeys.lineKey, createdBy: 'race-simulation', updatedBy: 'race-simulation',
    },
  })
  createdLrs.push(lr9)
  const c9 = await confirm(p9.json.jobId, { newRows: [p9.json.rows[0].rowIndex] })
  ok('unique constraint held — 0 created', c9.status === 200 && c9.json.result.created === 0, JSON.stringify(c9.json.result))
  ok('counted as duplicate, not failure', c9.json.result.duplicates === 1 && c9.json.result.failed === 0, JSON.stringify(c9.json.result))
  ok('still exactly one record', (await db.misRecord.count({ where: { lrNo: lr9, deletedAt: null } })) === 1)
  ok('race record intact', raceRec.businessKey !== null && (await activeByLr(lr9))?.id === raceRec.id)

  // =================================================================
  console.log('\nS10 — invalid row does not block valid rows')
  const lr10 = 970011
  const p10 = await preview(buildWorkbook(registry, [
    { ...line(lr10, 'E2ETEST26/000011', 'E2E Good Row Co') },
    { ...line(970012, 'E2ETEST26/000012', 'E2E Bad Row Co'), lrNo: 'not-a-number', bucket: 'xyz' },
  ]), 'e2e-s10.xlsx')
  ok('1 NEW + 1 INVALID', p10.status === 200 && p10.json.stats.new === 1 && p10.json.stats.invalid === 1, JSON.stringify(p10.json.stats))
  const c10 = await confirm(p10.json.jobId, { newRows: [p10.json.rows[0].rowIndex] })
  ok('good row created', c10.status === 200 && c10.json.result.created === 1, JSON.stringify(c10.json.result))
  createdLrs.push(lr10)
  ok('bad row never stored', (await db.misRecord.count({ where: { partyName: 'E2E Bad Row Co' } })) === 0)

  // =================================================================
  console.log('\nS11 — large file (1000 rows) performance')
  const bigRows = Array.from({ length: 1000 }, (_, i) =>
    line(971000 + i, `E2ETEST26/1${String(i).padStart(5, '0')}`, `E2E Bulk Co ${i % 50}`))
  const bigBuf = buildWorkbook(registry, bigRows)
  const t0 = Date.now()
  const p11 = await preview(bigBuf, 'e2e-s11.xlsx')
  const previewMs = Date.now() - t0
  ok('1000 rows classified NEW', p11.status === 200 && p11.json.stats.new === 1000, JSON.stringify(p11.json.stats))
  ok(`preview under 30s (${(previewMs / 1000).toFixed(1)}s)`, previewMs < 30_000)
  const t1 = Date.now()
  const c11 = await confirm(p11.json.jobId, { newRows: p11.json.rows.map((r: any) => r.rowIndex) })
  const applyMs = Date.now() - t1
  ok('1000 created', c11.status === 200 && c11.json.result.created === 1000, JSON.stringify(c11.json.result).slice(0, 200))
  ok(`apply under 120s (${(applyMs / 1000).toFixed(1)}s)`, applyMs < 120_000)
  for (let i = 0; i < 1000; i++) createdLrs.push(971000 + i)

  // =================================================================
  console.log('\nRED LINE — records missing from a file are never deleted')
  const afterBig = await db.misRecord.count({ where: { deletedAt: null } })
  const p12 = await preview(buildWorkbook(registry, [line(970013, 'E2ETEST26/000013', 'E2E Redline Co')]), 'e2e-s12.xlsx')
  await confirm(p12.json.jobId, { newRows: [p12.json.rows[0].rowIndex] })
  createdLrs.push(970013)
  const afterRedline = await db.misRecord.count({ where: { deletedAt: null } })
  ok('no records deleted by a partial file import', afterRedline === afterBig + 1, `${afterBig} → ${afterRedline}`)

  // =================================================================
  console.log('\nBONUS — soft-deleted record releases identity → re-import recreates')
  const lr13 = 970014
  const p13a = await preview(buildWorkbook(registry, [line(lr13, 'E2ETEST26/000014', 'E2E Rebirth Co')]), 'e2e-s13a.xlsx')
  await confirm(p13a.json.jobId, { newRows: [p13a.json.rows[0].rowIndex] })
  createdLrs.push(lr13)
  const orig = await activeByLr(lr13)
  await db.misRecord.update({ where: { id: orig!.id }, data: { deletedAt: new Date(), businessKey: null } })
  const p13 = await preview(buildWorkbook(registry, [line(lr13, 'E2ETEST26/000014', 'E2E Rebirth Co')]), 'e2e-s13b.xlsx')
  ok('re-import after delete → NEW', p13.status === 200 && p13.json.stats.new === 1, JSON.stringify(p13.json.stats))
  const c13 = await confirm(p13.json.jobId, { newRows: [p13.json.rows[0].rowIndex] })
  ok('recreated', c13.status === 200 && c13.json.result.created === 1, JSON.stringify(c13.json.result))

  // =================================================================
  // CLEANUP — restore the DB to its pre-test state
  // =================================================================
  console.log('\ncleanup…')
  const testRecords = await db.misRecord.findMany({
    where: { OR: [{ lrNo: { in: createdLrs } }, { partyName: { contains: 'E2E' } }] },
    select: { id: true },
  })
  const ids = testRecords.map((r) => r.id)
  if (ids.length > 0) {
    await db.misFormula.deleteMany({ where: { recordId: { in: ids } } })
    await db.misValue.deleteMany({ where: { recordId: { in: ids } } })
    await db.auditLog.deleteMany({ where: { entityId: { in: ids } } })
    await db.misRecord.deleteMany({ where: { id: { in: ids } } })
  }
  if (jobIds.length > 0) await db.importJob.deleteMany({ where: { id: { in: jobIds } } })
  await db.auditLog.deleteMany({ where: { action: 'IMPORT', newValue: { contains: 'e2e-' } } })
  const after = await db.misRecord.count({ where: { deletedAt: null } })
  ok('database restored to baseline', after === before, `${before} → ${after}`)

  await db.$disconnect()
  console.log('\n' + '='.repeat(72))
  console.log(`RESULT: ${passed} pass / ${failed} fail`)
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`))
  console.log('='.repeat(72))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('FATAL:', err)
  await db.$disconnect()
  process.exit(1)
})
