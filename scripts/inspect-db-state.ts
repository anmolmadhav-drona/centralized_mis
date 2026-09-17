// inspect-db-state.ts — check DB cleanliness after test runs
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const active = await db.misRecord.count({ where: { deletedAt: null } })
  const deleted = await db.misRecord.count({ where: { deletedAt: { not: null } } })
  const formulas = await db.misFormula.count()
  const fields = await db.misField.count()
  const e2eFields = await db.misField.count({ where: { OR: [{ fieldKey: { contains: 'E2E' } }, { displayName: { contains: 'E2E' } }] } })
  const versions = await db.misRecord.groupBy({ by: ['version'], where: { deletedAt: null }, _count: true, orderBy: { version: 'asc' } })
  const users = await db.user.count()
  console.log(JSON.stringify({
    activeRecords: active,
    deletedRecords: deleted,
    formulas,
    fields,
    e2eFields,
    users,
    versionHistogram: versions.map((v) => `${v.version}:${v._count}`),
  }, null, 2))
  await db.$disconnect()
}
main()
