import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  for (const key of ['deliveryStatus', 'podStatus', 'lrStatus', 'damage', 'loadType', 'vendorName']) {
    const f = await db.misField.findUnique({ where: { fieldKey: key } })
    console.log(key, '→', f?.options)
  }
}
main().finally(() => db.$disconnect())
