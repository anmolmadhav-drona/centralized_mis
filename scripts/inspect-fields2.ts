import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const fields = await db.misField.findMany({ orderBy: { position: 'asc' }, select: { fieldKey: true, displayName: true, dataType: true } })
  for (const f of fields) console.log(`${f.fieldKey.padEnd(22)} ${f.displayName}`)
  // most common values for default candidates
  const groups: Array<[string, string]> = [
    ['pickupLocation', 'pickupLocation'], ['transporterName', 'transporterName'],
    ['lrStatus', 'lrStatus'], ['damage', 'damage'], ['vehicleType', 'vehicleType'],
    ['loadType', 'loadType'], ['ply', 'ply'],
  ]
  for (const [k, col] of groups) {
    const rows = await db.$queryRawUnsafe(`SELECT ${col} as v, COUNT(*) as c FROM MisRecord GROUP BY ${col} ORDER BY c DESC LIMIT 3`)
    console.log(k, JSON.stringify(rows))
  }
}
main().finally(() => db.$disconnect())
