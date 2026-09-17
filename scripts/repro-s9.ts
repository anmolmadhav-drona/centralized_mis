// Isolated S9 repro: preview the race-condition file and dump the raw response
import * as XLSX from 'xlsx'
import { naLogin } from './lib/na-login'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const rows = await db.misField.findMany({
  where: { active: true }, orderBy: { position: 'asc' },
  select: { fieldKey: true, fieldName: true, isSystem: true },
})
const active = rows.filter((f) => !f.isSystem)
const headers: string[] = active.map((f) => f.fieldName)
const line: Record<string, unknown> = {
  lrNo: 970010, invoiceNumber: 'E2ETEST26/000010', partyName: 'E2E Race Condition Co',
  materialDetails: 'TATA MOTORS HP GENUINE DEF - 1*20L', bucket: 50, totalQuantityLtrs: 1000,
  destination: 'JAMSHEDPUR', pickupLocation: 'SONGIR', lrDate: '2026-08-20',
  loadType: 'FTL', deliveryStatus: 'Pending', podStatus: 'POD Pending',
}
const aoa: unknown[][] = [headers, active.map((f) => line[f.fieldKey] ?? null)]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'MIS')
const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

const cookie = (await naLogin('http://localhost:3000', 'admin@npl.com', 'Admin@123')) ?? ''
console.log('login:', cookie ? 'ok' : 'FAILED')

const fd = new FormData()
fd.append('file', new Blob([new Uint8Array(buf)], {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}), 'repro-s9.xlsx')
const res = await fetch('http://localhost:3000/api/import/preview', { method: 'POST', headers: { cookie }, body: fd })
console.log('preview status:', res.status)
const text = await res.text()
console.log('body:', text.slice(0, 800))
await db.$disconnect()
