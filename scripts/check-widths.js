import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const fields = await p.misField.findMany({ where: { dataType: { in: ['DATE', 'DATETIME'] } }, select: { fieldKey: true, displayName: true, dataType: true, width: true } });
  console.log(JSON.stringify(fields, null, 1));
  await p.$disconnect();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
