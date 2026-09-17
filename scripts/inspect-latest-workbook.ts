// Inspect the latest workbook headers + current DB field registry
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // ---- 1. workbook sheets + headers ----
  const wb = XLSX.readFile('/home/z/my-project/upload/Updated MIS NPL SONIPAT.xlsx', { cellDates: true })
  console.log('=== WORKBOOK SHEETS ===')
  console.log(wb.SheetNames.join(' | '))
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null })
    console.log(`\n--- sheet "${name}" (${rows.length} rows) ---`)
    // print first 4 rows to find the header row
    for (let i = 0; i < Math.min(4, rows.length); i++) {
      const nonEmpty = (rows[i] || []).filter((c) => c !== null && c !== undefined && String(c).trim() !== '')
      console.log(`row ${i}: [${nonEmpty.length} non-empty] ${(rows[i] || []).slice(0, 35).map((c) => (c == null ? '·' : String(c).trim().slice(0, 18))).join(' | ')}`)
    }
  }

  // ---- 2. current DB field registry ----
  console.log('\n=== DB FIELD REGISTRY (active) ===')
  const fields = await db.misField.findMany({ orderBy: { position: 'asc' } })
  for (const f of fields) {
    console.log(`${String(f.position).padStart(2)} key=${f.fieldKey.padEnd(20)} excel="${f.fieldName}" display="${f.displayName}" type=${f.dataType} core=${f.isCore} sys=${f.isSystem} active=${f.active}`)
  }
  console.log(`\ntotal fields: ${fields.length}`)

  // ---- 3. check for any existing dispatchFrom/vehicleRate/km/rate/totalRate-like fields ----
  console.log('\n=== DUPLICATE-PREVENTION SCAN ===')
  const suspects = ['dispatchfrom', 'dispatch from', 'vehiclerate', 'vehicle rate', 'km', 'rate', 'totalrate', 'total rate', 'remark', 'remarsk']
  for (const f of fields) {
    const hay = `${f.fieldKey} ${f.fieldName} ${f.displayName}`.toLowerCase()
    for (const s of suspects) {
      if (hay.includes(s)) {
        console.log(`MATCH "${s}" → key=${f.fieldKey} excel="${f.fieldName}" display="${f.displayName}" active=${f.active}`)
        break
      }
    }
  }

  // ---- 4. records with the potentially-new columns? ----
  const recs = await db.misRecord.findMany({ take: 1 })
  const cols = Object.keys(recs[0] ?? {})
  console.log('\n=== MisRecord columns ===')
  console.log(cols.join(', '))

  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
