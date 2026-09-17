// Task 19 state check: DB columns, indexes, key coverage, duplicates
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const cols = await db.$queryRawUnsafe<{ name: string; type: string }[]>(
  "SELECT name, type FROM pragma_table_info('MisRecord') WHERE name IN ('businessKey','lineKey')"
)
console.log('columns:', cols.map(c => `${c.name}:${c.type}`).join(', ') || 'MISSING')

const idx = await db.$queryRawUnsafe<{ name: string; sql: string }[]>(
  "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='MisRecord' AND (sql LIKE '%businessKey%' OR name LIKE '%businessKey%')"
)
console.log('unique index:', idx.map(i => `${i.name} :: ${i.sql}`).join(' | ') || 'MISSING')

const stats = await db.$queryRawUnsafe<{ total: bigint; withKey: bigint; noKey: bigint }[]>(
  'SELECT COUNT(*) total, SUM(businessKey IS NOT NULL) withKey, SUM(businessKey IS NULL) noKey FROM MisRecord'
)
console.log('stats:', stats.map(s => ({ total: String(s.total), withKey: String(s.withKey), noKey: String(s.noKey) }))[0]
  ? `total=${stats[0].total} withKey=${stats[0].withKey} noKey=${stats[0].noKey}` : 'none')

const dups = await db.$queryRawUnsafe<{ businessKey: string; lineKey: string; c: bigint }[]>(
  'SELECT businessKey, lineKey, COUNT(*) c FROM MisRecord WHERE businessKey IS NOT NULL GROUP BY businessKey, lineKey HAVING COUNT(*) > 1'
)
console.log('existing dup (businessKey,lineKey) groups:', dups.length)
for (const d of dups.slice(0, 10)) console.log('  DUP:', d.businessKey, '|', d.lineKey, '| x', d.c)

const sample = await db.$queryRawUnsafe<{ businessKey: string; lineKey: string }[]>(
  'SELECT businessKey, lineKey FROM MisRecord WHERE businessKey IS NOT NULL LIMIT 3'
)
for (const s of sample) console.log('sample:', JSON.stringify(s.businessKey), '||', JSON.stringify(s.lineKey))

const jobs = await db.importJob.count()
console.log('ImportJob count:', jobs)
const lastJob = await db.importJob.findFirst({ orderBy: { createdAt: 'desc' } })
if (lastJob) console.log('last job:', lastJob.fileName, lastJob.status, lastJob.createdAt.toISOString())

await db.$disconnect()
