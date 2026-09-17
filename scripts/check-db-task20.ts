// quick DB sanity check (Task 20)
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const [active, formulas, users, jobs] = await Promise.all([
  db.misRecord.count({ where: { deletedAt: null } }),
  db.misFormula.count(),
  db.user.count(),
  (db as any).misImportJob ? (db as any).misImportJob.count() : Promise.resolve(0),
])
console.log(`DB: ${active} active records, ${formulas} formulas, ${users} users, ${jobs} import jobs`)
await db.$disconnect()
