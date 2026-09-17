// Restore the pristine dataset state after test runs:
// 340 records / 180,885 L, only core registry fields, no test formulas.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  // 1. remove ALL non-core (dynamic) fields + their values + formulas
  const dynFields = await db.misField.findMany({ where: { isCore: false }, select: { id: true, fieldKey: true } })
  for (const f of dynFields) {
    await db.misValue.deleteMany({ where: { fieldId: f.id } })
    await db.misFormula.deleteMany({ where: { fieldKey: f.fieldKey } })
    await db.misField.delete({ where: { id: f.id } })
  }

  // 2. remove test records (LR >= 999000 and known test parties) incl. soft-deleted
  const testRecords = await db.misRecord.findMany({
    where: {
      OR: [
        { lrNo: { gte: 999000 } },
        { partyName: { in: ['Test Party', 'Formula Test Co', 'Formula Test Co 2', 'Dbg Co', 'Dbg2', 'E2E Import Party', 'Concurrent Co'] } },
        { destination: { in: ['UserA-Edit', 'UserB-Edit', 'Testville', 'X'] } },
      ],
    },
    select: { id: true },
  })
  for (const r of testRecords) {
    await db.misFormula.deleteMany({ where: { recordId: r.id } })
    await db.misValue.deleteMany({ where: { recordId: r.id } })
    await db.misRecord.delete({ where: { id: r.id } })
  }

  // 3. wipe all formulas from remaining records (pristine state has none)
  await db.misFormula.deleteMany({})

  // 4. clear import jobs from tests
  await db.importJob.deleteMany({})

  // 5. verify
  const active = await db.misRecord.findMany({ where: { deletedAt: null }, select: { totalQuantityLtrs: true, lrNo: true } })
  const total = active.reduce((s, r) => s + (r.totalQuantityLtrs || 0), 0)
  const all = await db.misRecord.count()
  console.log(`active=${active.length} totalQty=${total} allRecords(incl. soft-deleted)=${all}`)
  console.log(`dynamic fields removed: ${dynFields.length}, test records removed: ${testRecords.length}`)
  const nonPristineLr = active.filter((r) => (r.lrNo ?? 0) >= 999000)
  console.log('remaining test LRs:', nonPristineLr.length)
  await db.$disconnect()
}

main()
