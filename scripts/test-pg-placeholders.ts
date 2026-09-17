// Development-only diagnostic: verify $queryRawUnsafe `?` placeholder behavior on PostgreSQL
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const r1 = await db.$queryRawUnsafe<{ one: number }[]>('SELECT 1 as one')
  console.log('plain select:', JSON.stringify(r1))
  try {
    const r2 = await db.$queryRawUnsafe<{ c: number | bigint }[]>(
      'SELECT COUNT(*) as c FROM "MisRecord" WHERE "deletedAt" IS NULL AND "id" != ?', 'nonexistent'
    )
    console.log('? placeholder:', JSON.stringify(r2))
  } catch (e) {
    console.log('? placeholder FAILED:', (e as Error).message.slice(0, 200))
  }
  try {
    const r3 = await db.$queryRawUnsafe<{ c: number | bigint }[]>(
      'SELECT COUNT(*) as c FROM "MisRecord" WHERE "deletedAt" IS NULL AND "id" != $1', 'nonexistent'
    )
    console.log('$1 placeholder:', JSON.stringify(r3))
  } catch (e) {
    console.log('$1 placeholder FAILED:', (e as Error).message.slice(0, 200))
  }
  // boolean + LOWER LIKE checks
  try {
    const r4 = await db.$queryRawUnsafe<{ c: number | bigint }[]>(
      'SELECT COUNT(*) as c FROM "MisField" WHERE "active" = true AND LOWER("displayName") LIKE LOWER(?)', '%p%'
    )
    console.log('boolean+LOWER LIKE:', JSON.stringify(r4))
  } catch (e) {
    console.log('boolean+LOWER FAILED:', (e as Error).message.slice(0, 200))
  }
}
main().finally(() => db.$disconnect())
