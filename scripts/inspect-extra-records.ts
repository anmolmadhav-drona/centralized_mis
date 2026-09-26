// Inspect the 14 keyless + recently created records (are they test junk?)
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const noKey = await db.misRecord.findMany({
  where: { businessKey: null },
  orderBy: { createdAt: 'asc' },
  select: { id: true, lrNo: true, invoiceNumber: true, partyName: true, materialDetails: true, bucket: true, totalQuantity: true, createdAt: true, createdBy: true, deletedAt: true },
})
console.log(`keyless: ${noKey.length}`)
for (const r of noKey) {
  console.log(`  lr=${r.lrNo} inv=${r.invoiceNumber} party=${r.partyName} mat=${r.materialDetails} b=${r.bucket} q=${r.totalQuantity} created=${r.createdAt.toISOString()} by=${r.createdBy} del=${!!r.deletedAt}`)
}

const byDate = await db.misRecord.findMany({
  where: { createdAt: { gte: new Date('2026-09-15T00:00:00Z') } },
  orderBy: { createdAt: 'asc' },
  select: { id: true, lrNo: true, partyName: true, invoiceNumber: true, createdAt: true, createdBy: true, deletedAt: true, businessKey: true },
})
console.log(`\ncreated since Sep 15: ${byDate.length}`)
for (const r of byDate) {
  console.log(`  lr=${r.lrNo} party=${r.partyName} inv=${r.invoiceNumber} created=${r.createdAt.toISOString()} by=${r.createdBy} del=${!!r.deletedAt} key=${r.businessKey ? 'yes' : 'null'}`)
}

const total = await db.misRecord.count()
const deleted = await db.misRecord.count({ where: { deletedAt: { not: null } } })
console.log(`\ntotal=${total} (incl soft-deleted ${deleted}) active=${total - deleted}`)
await db.$disconnect()
