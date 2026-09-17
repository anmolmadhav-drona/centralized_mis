// Clean leftover e2e artifacts: 'E2E Seal Status' field + any test records
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

// find records created after the seed (seed ran 2026-09-10; show newest 5)
const newest = await db.misRecord.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, lrNo: true, partyName: true, destination: true, createdAt: true, createdBy: true },
})
console.log('newest records:', JSON.stringify(newest, null, 1))

// leftover e2e field + its EAV values
const e2eField = await db.misField.findFirst({ where: { fieldKey: 'e2eSealStatus' } })
if (e2eField) {
  const vals = await db.misValue.count({ where: { fieldId: e2eField.id } })
  console.log(`e2eSealStatus values: ${vals}`)
  await db.misValue.deleteMany({ where: { fieldId: e2eField.id } })
  await db.misField.delete({ where: { id: e2eField.id } })
  console.log('deleted e2eSealStatus field')
}

// delete records whose partyName marks them as test artifacts
const test = await db.misRecord.findMany({
  where: { OR: [{ partyName: { contains: 'E2E' } }, { partyName: { contains: 'Test' } }] },
  select: { id: true, lrNo: true, partyName: true, createdAt: true },
})
console.log('records w/ Test party names:', JSON.stringify(test, null, 1))

const total = await db.misRecord.count({ where: { deletedAt: null } })
console.log('active records now:', total)
await db.$disconnect()
