import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  // remove leftover test fields
  const fields = await db.misField.findMany({ where: { isCore: false } , select: { id: true, fieldKey: true } })
  for (const f of fields) { await db.misValue.deleteMany({ where: { fieldId: f.id } }); await db.misFormula.deleteMany({ where: { fieldKey: f.fieldKey } }); await db.misField.delete({ where: { id: f.id } }) }
  // remove leftover test records (LR 999xxx)
  const recs = await db.misRecord.findMany({ where: { lrNo: { gte: 999000 } }, select: { id: true } })
  for (const r of recs) { await db.misFormula.deleteMany({ where: { recordId: r.id } }); await db.misValue.deleteMany({ where: { recordId: r.id } }); await db.misRecord.delete({ where: { id: r.id } }) }
  console.log(`cleanup: removed ${fields.length} test fields, ${recs.length} test records`)
  await db.$disconnect()
}
main()
