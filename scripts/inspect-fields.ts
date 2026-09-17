import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const fields = await db.misField.findMany({ orderBy: { position: 'asc' } })
  for (const f of fields) {
    console.log(`${String(f.position).padStart(2)} ${f.fieldKey.padEnd(22)} ${f.dataType.padEnd(10)} req=${f.required ? 'Y' : 'n'} def=${JSON.stringify(f.defaultValue)} sys=${f.isSystem ? 'Y' : 'n'} core=${f.isCore ? 'Y' : 'n'} opts=${f.options ? JSON.parse(f.options).length : 0}`)
  }
  const total = await db.misRecord.count()
  console.log(`records=${total}`)
}
main().finally(() => db.$disconnect())
