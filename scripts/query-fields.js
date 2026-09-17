import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const fields = await p.misField.findMany({ orderBy: { position: 'asc' }, select: { fieldKey: true, displayName: true, dataType: true } });
  console.log(fields.map(f => `${f.fieldKey}(${f.displayName}):${f.dataType}`).join('\n'));
  await p.$disconnect();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
