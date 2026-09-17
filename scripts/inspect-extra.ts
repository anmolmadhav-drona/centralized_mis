import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const recs = await db.misRecord.findMany({ orderBy: { id: 'desc' }, take: 10, select: { id: true, lrNo: true, partyName: true, createdAt: true, updatedAt: true, version: true } })
  for (const r of recs) console.log(JSON.stringify({ id: r.id, srNo: r.srNo, lrNo: r.lrNo, party: r.partyName, v: r.version, created: r.createdAt?.toISOString() }))
}
main().finally(() => db.$disconnect())
