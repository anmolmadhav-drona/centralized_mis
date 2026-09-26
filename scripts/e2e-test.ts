/**
 * NPL MIS Portal — E2E API test suite
 * Run: bun scripts/e2e-test.ts   (server must be running on :3000)
 * Covers: auth, RBAC, CRUD, optimistic concurrency, dynamic fields,
 * filtering/search/sort, Excel export fidelity, import preview/confirm,
 * conflict detection, invalid files, duplicates, audit, soft delete.
 */
const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(`${name} ${detail}`)
    console.log(`  ✗ ${name} ${detail}`)
  }
}

function makeClient() {
  const cookies: string[] = []
  return {
    async call(method: string, path: string, body?: unknown, isForm = false): Promise<{ status: number; json: any; headers: Headers; buffer?: Buffer }> {
      const headers: Record<string, string> = {}
      if (cookies.length) headers.cookie = cookies.join('; ')
      let payload: BodyInit | undefined
      if (body instanceof FormData) payload = body
      else if (body !== undefined) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      void isForm
      const res = await fetch(BASE + path, { method, headers, body: payload })
      const setCookie = res.headers.getSetCookie?.() || []
      for (const c of setCookie) {
        const kv = c.split(';')[0]
        const i = cookies.findIndex((x) => x.split('=')[0] === kv.split('=')[0])
        if (i >= 0) cookies[i] = kv
        else cookies.push(kv)
      }
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('json')) {
        const json = await res.json().catch(() => ({}))
        return { status: res.status, json, headers: res.headers }
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      return { status: res.status, json: {}, headers: res.headers, buffer }
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

async function main() {
  console.log('='.repeat(72))
  console.log('NPL MIS PORTAL — E2E TEST SUITE')
  console.log('='.repeat(72))

  // ------------------------------------------------ auth
  console.log('\n[1] Authentication')
  const admin = makeClient()
  const r1s = await admin.login('admin@npl.com', 'Admin@123')
  const r1me = await admin.call('GET', '/api/auth/me')
  ok('admin login', r1s === 200 && r1me.json.user?.role === 'ADMIN')

  // pre-clean leftovers from earlier (crashed) runs — the suite creates
  // E2E* fields/records later and 409s on duplicates if they already exist
  const fieldsNow = (await admin.call('GET', '/api/fields')).json.fields || []
  for (const f of fieldsNow) {
    if (/^E2E/i.test(String(f.fieldName))) await admin.call('DELETE', `/api/fields/${f.id}`)
  }
  for (const term of ['E2E', 'Formula Test', '9900', '9999']) {
    const found = await admin.call('GET', `/api/records?search=${encodeURIComponent(term)}&start=0&end=50`)
    for (const row of found.json.rows || []) {
      const lr = Number(row.lrNo ?? 0)
      if (String(row.partyName || '').includes('E2E') || String(row.partyName || '').includes('Formula') || lr >= 99000) {
        await admin.call('DELETE', `/api/records/${row.id}`)
      }
    }
  }

  const r1b = await makeClient().login('admin@npl.com', 'WRONG')
  ok('wrong password rejected 401', r1b === 401)

  const r1c = await admin.call('GET', '/api/auth/me')
  ok('session persists', r1c.status === 200 && r1c.json.user?.email === 'admin@npl.com')

  const anon = makeClient()
  const r1d = await anon.call('GET', '/api/records?start=0&end=5')
  ok('unauthenticated blocked 401', r1d.status === 401)

  // ------------------------------------------------ RBAC
  console.log('\n[2] Role-based access control')
  const viewer = makeClient()
  await viewer.login('viewer@npl.com', 'Viewer@123')
  const operator = makeClient()
  await operator.login('user@npl.com', 'User@123')
  const manager = makeClient()
  await manager.login('manager@npl.com', 'Manager@123')

  ok('VIEWER cannot create', (await viewer.call('POST', '/api/records', { values: {} })).status === 403)
  ok('VIEWER cannot add fields', (await viewer.call('POST', '/api/fields', { fieldName: 'X', dataType: 'TEXT' })).status === 403)
  ok('VIEWER cannot view audit', (await viewer.call('GET', '/api/audit')).status === 403)
  ok('VIEWER cannot import', (await viewer.call('POST', '/api/import/preview')).status === 400 || (await viewer.call('POST', '/api/import/preview')).status === 403)
  ok('VIEWER can export', (await viewer.call('POST', '/api/export', {})).status === 200)
  ok('OPERATOR cannot delete', (await operator.call('DELETE', '/api/records/xxx')).status === 403 || (await operator.call('DELETE', '/api/records/xxx')).status === 404)
  ok('OPERATOR cannot manage users', (await operator.call('GET', '/api/users')).status === 403)
  ok('OPERATOR cannot manage fields', (await operator.call('POST', '/api/fields', { fieldName: 'Y', dataType: 'TEXT' })).status === 403)
  ok('MANAGER can view records', (await manager.call('GET', '/api/records?start=0&end=1')).status === 200)

  // ------------------------------------------------ list / filter / search / sort
  console.log('\n[3] Listing, filtering, search, sort')
  const list = await admin.call('GET', '/api/records?start=0&end=50')
  ok('list with pagination', list.status === 200 && list.json.rows?.length === 50 && list.json.total === 340)

  const search = await admin.call('GET', '/api/records?start=0&end=10&search=Meerut%20Automobiles')
  ok('global search', search.json.total === 12)

  const fDest = await admin.call('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ destination: { filterType: 'text', type: 'equals', filter: 'Delhi' } }))}`)
  ok('text filter (Delhi)', fDest.json.total === 20)

  const fDate = await admin.call('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ lrDate: { filterType: 'date', type: 'inRange', dateFrom: '2026-08-01', dateTo: '2026-08-05' } }))}`)
  ok('date range filter', fDate.json.total === 76)

  const fNum = await admin.call('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ totalQuantity: { filterType: 'number', type: 'greaterThan', filter: 5000 } }))}`)
  ok('number filter (qty > 5000)', fNum.json.total === 10)

  const fCombo = await admin.call('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ destination: { filterType: 'text', type: 'equals', filter: 'Delhi' }, loadType: { filterType: 'text', type: 'equals', filter: 'FTL' } }))}`)
  ok('combined filters (Delhi AND FTL = 0 — data has no overlap)', fCombo.json.total === 0)

  const sorted = await admin.call('GET', `/api/records?start=0&end=3&sort=${encodeURIComponent(JSON.stringify([{ colId: 'bucket', sort: 'desc' }]))}`)
  ok('server-side sort (bucket desc)', sorted.json.rows[0]?.bucket >= (sorted.json.rows[1]?.bucket ?? 0))

  // ------------------------------------------------ CRUD + optimistic concurrency
  console.log('\n[4] CRUD and optimistic concurrency')
  const create = await admin.call('POST', '/api/records', {
    values: {
      pickupLocation: 'Sonipat', partyName: 'E2E Test Logistics Pvt LTD', destination: 'Testburg',
      invoiceNumber: 'E2E-001', lrNo: 99001, lrDate: '2026-09-11',
      materialDetails: 'TATA Genius DEF (4*5) - PVBU', transporterName: 'Drona Logitech',
      bucket: 2, totalQuantity: 40, loadType: 'PTL', deliveryStatus: 'Pending',
      lrStatus: 'To be Billed', damage: 'No', podStatus: 'WH',
    },
  })
  const recId = create.json.record?.id
  ok('create record', create.status === 201 && recId && create.json.record.version === 1)

  const missingRequired = await admin.call('POST', '/api/records', { values: { partyName: 'No LR' } })
  ok('required fields enforced', missingRequired.status === 400)

  const badDropdown = await admin.call('POST', '/api/records', { values: { partyName: 'X Co', destination: 'Y', lrNo: 5, lrDate: '2026-09-11', loadType: 'NOT-A-LOAD-TYPE' } })
  ok('dropdown validation (server-side)', badDropdown.status === 400)

  const badDate = await admin.call('POST', '/api/records', { values: { partyName: 'X Co', destination: 'Y', lrNo: 6, lrDate: 'not-a-date' } })
  ok('date validation', badDate.status === 400)

  // concurrent edit conflict
  const clientA = makeClient()
  await clientA.login('manager@npl.com', 'Manager@123')
  const clientB = makeClient()
  await clientB.login('user@npl.com', 'User@123')

  const updA = await clientA.call('PATCH', `/api/records/${recId}`, { version: 1, values: { bucket: 5 } })
  ok('client A edits (v1 → v2)', updA.status === 200 && updA.json.record?.version === 2 && updA.json.record?.bucket === 5)

  const updB = await clientB.call('PATCH', `/api/records/${recId}`, { version: 1, values: { bucket: 99 } })
  ok('client B stale edit → 409 VERSION_CONFLICT', updB.status === 409 && updB.json.code === 'VERSION_CONFLICT' && updB.json.current?.version === 2)
  ok('conflict payload includes current values + who/when', updB.json.current?.updatedBy === 'Anmol Madhav' && !!updB.json.current?.updatedAt)

  const rebase = await clientB.call('PATCH', `/api/records/${recId}`, { version: 2, values: { bucket: 7 } })
  ok('client B retries on v2 → success', rebase.status === 200 && rebase.json.record?.version === 3)

  // ------------------------------------------------ dynamic fields
  console.log('\n[5] Dynamic MIS fields')
  const addField = await admin.call('POST', '/api/fields', { fieldName: 'E2E Driver Phone', dataType: 'TEXT' })
  const fieldKey = addField.json.field?.fieldKey
  ok('add dynamic column', addField.status === 201 && !!fieldKey)

  const dupField = await admin.call('POST', '/api/fields', { fieldName: 'E2E Driver Phone', dataType: 'TEXT' })
  ok('duplicate column name rejected', dupField.status === 409)

  const addDd = await admin.call('POST', '/api/fields', { fieldName: 'E2E Seal Status', dataType: 'DROPDOWN', options: ['Intact', 'Broken'] })
  ok('add dropdown column', addDd.status === 201 && addDd.json.field?.options?.length === 2)

  const setDyn = await admin.call('PATCH', `/api/records/${recId}`, { version: 3, values: { [fieldKey]: '9812345678', [addDd.json.field.fieldKey]: 'Intact' } })
  ok('set dynamic values on record', setDyn.status === 200 && setDyn.json.record?.[fieldKey] === '9812345678')

  const filterDyn = await admin.call('GET', `/api/records?start=0&end=5&filter=${encodeURIComponent(JSON.stringify({ [fieldKey]: { filterType: 'text', type: 'contains', filter: '98123' } }))}`)
  ok('filter by dynamic field (EAV)', filterDyn.json.total === 1 && filterDyn.json.rows[0]?.[fieldKey] === '9812345678')

  const searchDyn = await admin.call('GET', `/api/records?start=0&end=5&search=9812345678`)
  ok('global search covers dynamic fields', searchDyn.json.total === 1)

  const fieldsAfter = await admin.call('GET', '/api/fields')
  ok('field registry grew to 40 (38 core incl. latest-workbook fields + 2 dynamic)', fieldsAfter.json.fields?.length === 40)

  // ------------------------------------------------ Excel export
  console.log('\n[6] Filtered Excel export')
  const expAll = await admin.call('POST', '/api/export', { includeSummary: true })
  ok('full export', expAll.status === 200 && (expAll.buffer?.length ?? 0) > 5000)
  const expFilter = await admin.call('POST', '/api/export', {
    filterModel: { destination: { filterType: 'text', type: 'equals', filter: 'Delhi' } },
    includeSummary: true,
  })
  ok('filtered export (20 Delhi rows)', expFilter.status === 200 && (expFilter.buffer?.length ?? 0) > 3000)
  // exported buffer verified later via ExcelJS re-read

  // ------------------------------------------------ Excel import
  console.log('\n[7] Excel import — preview & conflict detection')
  // Build a workbook to import: modify the Delhi export
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(expFilter.buffer as Buffer)
  const ws = wb.getWorksheet('MIS')!
  const maxCol = ws.columnCount
  const sysIdCol = maxCol - 1
  const sysVerCol = maxCol
  const colIndexOf = (header: string) => {
    const hr = ws.getRow(2)
    for (let c = 1; c <= maxCol; c++) if (hr.getCell(c).value === header) return c
    return -1
  }
  const lrNoCol = colIndexOf('LR. NO.')
  const qtyCol = colIndexOf('TOTAL QUANTITY IN LTRS')
  const bucketCol = colIndexOf('Bucket')
  const remarkCol = colIndexOf('Remark')

  // Originals of the two rows this section mutates — [13] restores them so the
  // suite is safely RE-RUNNABLE (the constants below assume the seeded
  // baseline, and a previous run's leftovers would break change detection).
  const row3Id = String(ws.getRow(3).getCell(sysIdCol).value)
  const row4Id = String(ws.getRow(4).getCell(sysIdCol).value)
  const origRow3Bucket = ws.getRow(3).getCell(bucketCol).value
  const origRow3Qty = ws.getRow(3).getCell(qtyCol).value
  const origRow4Qty = ws.getRow(4).getCell(qtyCol).value
  const origRow4Remark = remarkCol > 0 ? ws.getRow(4).getCell(remarkCol).value : null

  // changed row (row 3)
  ws.getRow(3).getCell(bucketCol).value = 111
  ws.getRow(3).getCell(qtyCol).value = 2220
  // stale row (row 4) — value changed, version left at 1; we will bump DB version after upload
  ws.getRow(4).getCell(qtyCol).value = 777
  // new row without SYS id (row 23)
  const headerValues: string[] = []
  ws.getRow(2).eachCell((c) => headerValues.push(String(c.value)))
  const newRow = ws.getRow(23)
  newRow.getCell(1).value = 21
  newRow.getCell(colIndexOf('PICKUP LOCATION')).value = 'Sonipat'
  newRow.getCell(colIndexOf('PARTY NAME')).value = 'E2E Imported Party'
  newRow.getCell(colIndexOf('DESTINATION')).value = 'Delhi'
  newRow.getCell(colIndexOf('INVOICE NUMBER')).value = 'E2E-IMP-1'
  newRow.getCell(lrNoCol).value = 99002
  newRow.getCell(colIndexOf('LR DATE')).value = new Date('2026-09-11T00:00:00.000Z')
  newRow.getCell(colIndexOf('MATERIAL DETAILS')).value = 'TATA Genius DEF (4*5) - PVBU'
  newRow.getCell(bucketCol).value = 4
  newRow.getCell(qtyCol).value = 80
  // invalid row (row 24)
  const badRow = ws.getRow(24)
  badRow.getCell(colIndexOf('PARTY NAME')).value = 'E2E Invalid'
  badRow.getCell(lrNoCol).value = 'not-a-number'
  badRow.getCell(qtyCol).value = 'abc'
  const importBuffer = Buffer.from(await wb.xlsx.writeBuffer())

  // bump row 4's record version in DB to create a stale-version conflict
  const staleId = String(ws.getRow(4).getCell(sysIdCol).value)
  const staleGet = await admin.call('GET', `/api/records/${staleId}`)
  const staleVer = staleGet.json.record?.version
  await admin.call('PATCH', `/api/records/${staleId}`, { version: staleVer, values: { remark: 'Dispatch' } })

  const form = new FormData()
  form.append('file', new Blob([importBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'e2e_import.xlsx')
  const preview = await admin.call('POST', '/api/import/preview', form)
  const stats = preview.json.stats
  ok('preview analyzed', preview.status === 200 && stats?.detected === 22)
  ok('detects CHANGED', stats?.changed === 1, JSON.stringify(stats))
  ok('detects CONFLICT (stale version)', stats?.conflicts === 1)
  ok('detects NEW', stats?.new === 1)
  ok('detects INVALID', stats?.invalid === 1)
  ok('detects UNCHANGED', stats?.unchanged === 18, JSON.stringify(stats))

  const conflictRow = (preview.json.rows || []).find((r: any) => r.kind === 'CONFLICT')
  ok('conflict shows DB vs file detail', !!conflictRow?.dbVersion && conflictRow.dbVersion === staleVer + 1 && conflictRow.fileVersion === staleVer, JSON.stringify(conflictRow)?.slice(0, 160))

  // invalid file type
  const badForm = new FormData()
  badForm.append('file', new Blob([Buffer.from('not excel')], { type: 'text/plain' }), 'bad.txt')
  const badFile = await admin.call('POST', '/api/import/preview', badForm)
  ok('non-xlsx rejected', badFile.status === 400)

  // ------------------------------------------------ import confirm (transaction)
  console.log('\n[8] Import confirm — atomic apply')
  const changedIdx = (preview.json.rows || []).filter((r: any) => r.kind === 'CHANGED').map((r: any) => r.rowIndex)
  const newIdx = (preview.json.rows || []).filter((r: any) => r.kind === 'NEW').map((r: any) => r.rowIndex)
  const confirm = await admin.call('POST', '/api/import/confirm', {
    jobId: preview.json.jobId,
    resolutions: { [conflictRow.recordId]: 'mine' },
    newRows: newIdx,
    changedRows: changedIdx,
    deletions: [],
  })
  ok('confirm applies atomically', confirm.status === 200 && confirm.json.result?.applied === 3, JSON.stringify(confirm.json).slice(0,200))
  ok('created/updated counts', confirm.json.result?.created === 1 && confirm.json.result?.updated === 2)

  const reConfirm = await admin.call('POST', '/api/import/confirm', { jobId: preview.json.jobId, resolutions: {}, newRows: [], changedRows: [], deletions: [] })
  ok('double-confirm rejected', reConfirm.status === 409)

  const imported = await admin.call('GET', `/api/records?start=0&end=3&filter=${encodeURIComponent(JSON.stringify({ lrNo: { filterType: 'number', type: 'equals', filter: 99002 } }))}`)
  ok('imported new record present', imported.json.total === 1 && imported.json.rows[0]?.partyName === 'E2E Imported Party')

  // ------------------------------------------------ audit
  console.log('\n[9] Audit trail')
  const audit = await admin.call('GET', '/api/audit?pageSize=50&search=E2E')
  ok('audit records E2E actions', (audit.json.total ?? 0) >= 2)
  const auditImport = await admin.call('GET', '/api/audit?pageSize=10&action=IMPORT')
  ok('IMPORT action audited', auditImport.json.total >= 1)
  const auditUpdate = await admin.call('GET', '/api/audit?pageSize=10&action=RECORD_UPDATE&search=Bucket')
  ok('field-level diffs audited (old → new)', auditUpdate.json.logs?.some((l: any) => l.oldValue && l.newValue))

  // ------------------------------------------------ soft delete
  console.log('\n[10] Soft delete')
  const del = await admin.call('DELETE', `/api/records/${recId}`)
  ok('delete record', del.status === 200)
  const gone = await admin.call('GET', `/api/records/${recId}`)
  ok('deleted record not found', gone.status === 404)
  const auditDelete = await admin.call('GET', '/api/audit?pageSize=10&action=RECORD_DELETE')
  ok('deletion audited', auditDelete.json.total >= 1)

  // ------------------------------------------------ dashboard / reports
  console.log('\n[11] Dashboard & live reports')
  const dash = await admin.call('GET', '/api/dashboard')
  // qty math: 180885 base + 80 (import new) + (2220-180) changed + (777-500) conflict-mine
  // (the +40 created record was soft-deleted in step 10, so it is excluded)
  const expectedQty = 180885 + 80 + (2220 - 180) + (777 - 500)
  ok('dashboard aggregates', dash.status === 200 && dash.json.totalRecords === 341 && dash.json.totalQuantity === expectedQty,
    `got ${dash.json.totalRecords}/${dash.json.totalQuantity} expected 341/${expectedQty}`)
  const rep = await admin.call('GET', '/api/reports?type=pending')
  ok('pending report (live summary)', rep.status === 200 && Array.isArray(rep.json.rows))
  const repDest = await admin.call('GET', '/api/reports?type=destination')
  ok('destination report', repDest.status === 200 && repDest.json.rows?.length > 50)

  // ------------------------------------------------ field management
  console.log('\n[12] Field management lifecycle')
  const deact = await admin.call('PATCH', `/api/fields/${addField.json.field.id}`, { active: false })
  ok('deactivate dynamic field', deact.status === 200 && deact.json.field?.active === false)
  const delField = await admin.call('DELETE', `/api/fields/${addField.json.field.id}`)
  ok('delete dynamic field', delField.status === 200)
  const coreField = (await admin.call('GET', '/api/fields')).json.fields.find((f: any) => f.fieldKey === 'partyName')
  const delCore = await admin.call('DELETE', `/api/fields/${coreField.id}`)
  ok('core field deletion blocked', delCore.status === 400)

  // ------------------------------------------------ cleanup (re-runnability)
  console.log('\n[13] Cleanup — restore import-test side effects')
  try {
    // Revert the two mutated Delhi rows to their pre-test values (versions
    // keep bumping — harmless, every version check in this suite is relative).
    const restores: Array<[string, Record<string, unknown>]> = [
      [row3Id, { bucket: origRow3Bucket, totalQuantity: origRow3Qty }],
      [row4Id, { totalQuantity: origRow4Qty, ...(remarkCol > 0 ? { remark: origRow4Remark } : {}) }],
    ]
    for (const [rid, values] of restores) {
      const cur = await admin.call('GET', `/api/records/${rid}`)
      if (cur.status === 200) {
        await admin.call('PATCH', `/api/records/${rid}`, { version: cur.json.record?.version, values })
      }
    }
    // Remove the import test record (soft delete: excluded from active
    // views, and the released identity lets the next run create it again).
    const e2eImp = await admin.call('GET', `/api/records?start=0&end=3&filter=${encodeURIComponent(JSON.stringify({ lrNo: { filterType: 'number', type: 'equals', filter: 99002 } }))}`)
    for (const r of e2eImp.json.rows || []) await admin.call('DELETE', `/api/records/${r.id}`)
    console.log('  cleanup done — baseline values restored, test record removed')
  } catch (e) {
    console.log('  cleanup warning (non-fatal):', e)
  }

  // ------------------------------------------------ summary
  console.log('\n' + '='.repeat(72))
  console.log(`RESULT: ${passed} passed, ${failed} failed`)
  if (failures.length) {
    console.log('Failures:')
    failures.forEach((f) => console.log('  - ' + f))
  }
  console.log('='.repeat(72))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Test suite crashed:', e)
  process.exit(1)
})
