// Focused debug: replicate the e2e import fixture and inspect the preview response
const BASE = 'http://localhost:3000'

function makeClient() {
  const cookies: string[] = []
  return {
    async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; buffer?: Buffer }> {
      const headers: Record<string, string> = {}
      if (cookies.length) headers.cookie = cookies.join('; ')
      let payload: BodyInit | undefined
      if (body !== undefined) {
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
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('json')) return { status: res.status, json: await res.json().catch(() => ({})) }
      const buf = Buffer.from(await res.arrayBuffer())
      return { status: res.status, json: {}, buffer: buf }
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
  const admin = makeClient()
  await admin.login('admin@npl.com', 'Admin@123')

  const expFilter = await admin.call('POST', '/api/export', {
    filterModel: { destination: { filterType: 'text', type: 'equals', filter: 'Delhi' } },
    includeSummary: true,
  })
  console.log('export status:', expFilter.status, 'bytes:', expFilter.buffer?.length)

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(expFilter.buffer as Buffer)
  const ws = wb.getWorksheet('MIS')!
  const maxCol = ws.columnCount
  const colIndexOf = (header: string) => {
    const hr = ws.getRow(2)
    for (let c = 1; c <= maxCol; c++) if (hr.getCell(c).value === header) return c
    return -1
  }
  const bucketCol = colIndexOf('Bucket')
  const qtyCol = colIndexOf('TOTAL QUANTITY IN LTRS')
  console.log('sheets:', wb.worksheets.map((w) => w.name).join(','), '| cols:', maxCol, '| bucketCol:', bucketCol)

  ws.getRow(3).getCell(bucketCol).value = 111
  ws.getRow(3).getCell(qtyCol).value = 2220
  ws.getRow(4).getCell(qtyCol).value = 777
  const newRow = ws.getRow(23)
  newRow.getCell(1).value = 21
  newRow.getCell(colIndexOf('PICKUP LOCATION')).value = 'Sonipat'
  newRow.getCell(colIndexOf('PARTY NAME')).value = 'E2E Imported Party'
  newRow.getCell(colIndexOf('DESTINATION')).value = 'Delhi'
  newRow.getCell(colIndexOf('LR. NO.')).value = 99002
  newRow.getCell(bucketCol).value = 10
  newRow.getCell(qtyCol).value = 80
  // clear SYS id/version on the new row so it's classified NEW
  newRow.getCell(maxCol - 1).value = null
  newRow.getCell(maxCol).value = null

  // bump row 4's DB version AFTER upload (stale) — replicate: upload first, then bump
  const buf = await wb.xlsx.writeBuffer()
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'e2e-import.xlsx')
  const res = await fetch(BASE + '/api/import/preview', { method: 'POST', body: form, headers: { cookie: (await loginCookie()) } })
  const preview = await res.json()
  console.log('preview status:', res.status)
  console.log('stats:', JSON.stringify(preview.stats))
  const kinds: Record<string, number> = {}
  for (const r of preview.rows || []) kinds[r.kind] = (kinds[r.kind] || 0) + 1
  console.log('row kinds:', JSON.stringify(kinds))
  for (const r of (preview.rows || []).filter((x: any) => x.kind === 'CHANGED')) {
    console.log('CHANGED row', r.rowIndex, 'lr:', r.values?.lrNo, '| diffs:', JSON.stringify(r.diffs).slice(0, 300))
  }
  const firstConflict = (preview.rows || []).find((r: any) => r.kind === 'CONFLICT')
  console.log('first CONFLICT:', JSON.stringify(firstConflict)?.slice(0, 200))
  // cleanup job
  if (preview.jobId) await admin.call('POST', '/api/import/confirm', { jobId: preview.jobId, resolutions: {}, newRows: [], changedRows: [], deletions: [] })
}

let cachedCookie: string | null = null
async function loginCookie(): Promise<string> {
  if (cachedCookie) return cachedCookie
  cachedCookie = (await naLogin(BASE, 'admin@npl.com', 'Admin@123')) ?? ''
  return cachedCookie
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
