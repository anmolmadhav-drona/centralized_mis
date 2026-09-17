import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const cols = ['pickupLocation','transporterName','lrStatus','damage','vehicleType','loadType','ply']
  for (const col of cols) {
    const rows = await db.$queryRawUnsafe(`SELECT ${col} as v, COUNT(*) as c FROM MisRecord GROUP BY ${col} ORDER BY c DESC LIMIT 3`) as Array<{ v: unknown; c: bigint }>
    console.log(col, rows.map(r => `${String(r.v)}:${Number(r.c)}`).join(', '))
  }
}
main().finally(() => db.$disconnect())
