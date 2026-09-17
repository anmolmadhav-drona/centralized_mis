/**
 * One-time data migration: SQLite (db/custom.db) → PostgreSQL (DATABASE_URL).
 *
 * Development/deployment tool — NOT part of the application runtime.
 * Copies every table in FK-safe order, preserving ids, timestamps, and the
 * business-key identity columns exactly as they are. Idempotent guard: it
 * refuses to run if the target already contains records (unless --force).
 *
 * Run: DATABASE_URL=postgresql://… bun scripts/migrate-sqlite-to-postgres.ts
 */
import { PrismaClient } from '@prisma/client'
// SQLite client generated from prisma/schema.sqlite.bak.prisma into a
// sidecar output so both clients can coexist during the migration window.
import { PrismaClient as SqliteClient } from '../node_modules/.prisma/client-sqlite'

const pg = new PrismaClient()
const SQLITE_URL = process.env.SQLITE_URL || 'file:/home/z/my-project/db/custom.db'
const lite = new SqliteClient({ datasources: { db: { url: SQLITE_URL } } })

async function main() {
  const force = process.argv.includes('--force')

  // ---- guard: never clobber an already-populated PostgreSQL ----
  const existing = await pg.misRecord.count()
  if (existing > 0 && !force) {
    console.log(`Target PostgreSQL already has ${existing} MisRecords — nothing to do (use --force to re-copy).`)
    return
  }
  if (existing > 0 && force) {
    console.log(`--force: clearing ${existing} MisRecords (and dependents) from PostgreSQL…`)
    await pg.importJob.deleteMany({})
    await pg.auditLog.deleteMany({})
    await pg.misValue.deleteMany({})
    await pg.misFormula.deleteMany({})
    await pg.misRecord.deleteMany({})
    await pg.misField.deleteMany({})
    await pg.user.deleteMany({})
  }

  // ---- source counts ----
  const [users, fields, records, formulas, values, audits, jobs] = await Promise.all([
    lite.user.count(), lite.misField.count(), lite.misRecord.count(),
    lite.misFormula.count(), lite.misValue.count(), lite.auditLog.count(), lite.importJob.count(),
  ])
  console.log(`SQLite source: ${users} users, ${fields} fields, ${records} records, ${formulas} formulas, ${values} values, ${audits} audit logs, ${jobs} import jobs`)
  if (records === 0) { console.log('Source is empty — nothing to migrate.'); return }

  // ---- copy in FK-safe order, inside one transaction ----
  await pg.$transaction(async (tx) => {
    const txUsers = await lite.user.findMany()
    for (const u of txUsers) {
      await tx.user.create({ data: { ...u } })
    }
    console.log(`  users: ${txUsers.length}`)

    const allFields = await lite.misField.findMany()
    for (const f of allFields) {
      await tx.misField.create({ data: { ...f } })
    }
    console.log(`  fields: ${allFields.length}`)

    const allRecords = await lite.misRecord.findMany()
    for (const r of allRecords) {
      await tx.misRecord.create({ data: { ...r } })
    }
    console.log(`  records: ${allRecords.length}`)

    const allFormulas = await lite.misFormula.findMany()
    for (const f of allFormulas) {
      await tx.misFormula.create({ data: { ...f } })
    }
    console.log(`  formulas: ${allFormulas.length}`)

    // EAV values in chunks (largest table)
    const CHUNK = 2000
    let copied = 0
    let cursor: string | null = null
    while (true) {
      const batch = await lite.misValue.findMany({ take: CHUNK, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: 'asc' } })
      if (batch.length === 0) break
      await tx.misValue.createMany({ data: batch.map((v) => ({ ...v })) })
      copied += batch.length
      cursor = batch[batch.length - 1].id
      if (batch.length < CHUNK) break
    }
    console.log(`  values: ${copied}`)

    const allAudits = await lite.auditLog.findMany()
    for (const a of allAudits) {
      await tx.auditLog.create({ data: { ...a } })
    }
    console.log(`  audit logs: ${allAudits.length}`)

    const allJobs = await lite.importJob.findMany()
    for (const j of allJobs) {
      await tx.importJob.create({ data: { ...j } })
    }
    console.log(`  import jobs: ${allJobs.length}`)
  })

  // ---- verify ----
  const [u2, f2, r2, v2] = await Promise.all([
    pg.user.count(), pg.misField.count(), pg.misRecord.count(), pg.misValue.count(),
  ])
  const keyed = await pg.misRecord.count({ where: { businessKey: { not: null } } })
  const dupes = await pg.misRecord.groupBy({ by: ['businessKey', 'lineKey'], where: { businessKey: { not: null }, deletedAt: null }, _count: true })
  const dupGroups = dupes.filter((g) => g._count > 1).length
  console.log(`\nPostgreSQL target: ${u2} users, ${f2} fields, ${r2} records, ${v2} values`)
  console.log(`Active records with businessKey: ${keyed}; duplicate (businessKey,lineKey) groups among active: ${dupGroups}`)
  if (u2 !== users || f2 !== fields || r2 !== records) {
    throw new Error('COUNT MISMATCH — migration incomplete, inspect the target database.')
  }
  if (dupGroups > 0) {
    throw new Error('Duplicate business-key groups detected in target — the unique constraint would reject re-imports. Resolve before going live.')
  }
  console.log('\nMigration verified OK.')
}

main()
  .catch((e) => { console.error('MIGRATION FAILED:', e); process.exitCode = 1 })
  .finally(async () => { await pg.$disconnect(); await lite.$disconnect() })
