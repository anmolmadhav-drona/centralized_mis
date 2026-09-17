// Quick DB inspection: status distributions + field registry
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const statuses = await db.misRecord.groupBy({ by: ['deliveryStatus'], where: { deletedAt: null }, _count: true })
  console.log('DELIVERY STATUS:', JSON.stringify(statuses))
  const pods = await db.misRecord.groupBy({ by: ['podStatus'], where: { deletedAt: null }, _count: true })
  console.log('POD STATUS:', JSON.stringify(pods))
  const lr = await db.misRecord.groupBy({ by: ['lrStatus'], where: { deletedAt: null }, _count: true })
  console.log('LR STATUS:', JSON.stringify(lr))
  const fields = await db.misField.findMany({ orderBy: { position: 'asc' }, select: { fieldKey: true, fieldName: true, dataType: true, isCore: true, isSystem: true, active: true, options: true } })
  console.log('FIELDS:', JSON.stringify(fields, null, 1))
  const cnt = await db.misRecord.count({ where: { deletedAt: null } })
  console.log('RECORDS:', cnt)
  await db.$disconnect()
}
main()
