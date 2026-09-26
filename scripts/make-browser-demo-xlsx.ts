// Build a small browser-demo workbook: one new row + its exact duplicate
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const fields = await db.misField.findMany({
  where: { active: true }, orderBy: { position: 'asc' },
  select: { fieldKey: true, fieldName: true, isSystem: true },
})
const active = fields.filter((f) => !f.isSystem)
const headers = active.map((f) => f.fieldName)
const row: Record<string, unknown> = {
  lrNo: 970099, invoiceNumber: 'BROWSER26/000099', partyName: 'Browser Demo Co',
  materialDetails: 'TATA MOTORS HP GENUINE DEF - 1*20L', bucket: 50, totalQuantity: 1000,
  destination: 'JAMSHEDPUR', pickupLocation: 'SONGIR', lrDate: '2026-08-20',
  loadType: 'FTL', deliveryStatus: 'Pending', podStatus: 'POD Pending',
}
const aoa: unknown[][] = [headers, active.map((f) => row[f.fieldKey] ?? null), active.map((f) => row[f.fieldKey] ?? null)]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'MIS')
XLSX.writeFile(wb, '/tmp/browser-demo.xlsx')
console.log('written /tmp/browser-demo.xlsx (2 rows: 1 new + 1 exact duplicate)')
await db.$disconnect()
