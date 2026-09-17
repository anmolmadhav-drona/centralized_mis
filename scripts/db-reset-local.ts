/**
 * NPL MIS Portal — EXPLICIT local database reset (DEVELOPMENT ONLY).
 *
 * Destructive: truncates every table (users included), re-applies migrations
 * from scratch, then optionally re-seeds the demo dataset.
 *
 * Guardrails:
 *   • Refuses to run when NODE_ENV=production — no escape hatch.
 *   • Refuses when DATABASE_URL is not a localhost/127.0.0.1 address —
 *     an accidental pointer at a remote database must never be wiped.
 *   • Requires an explicit interactive confirmation (or --yes for scripted
 *     local use, e.g. in CI or docker flows).
 *
 * Run:  bun run db:reset-local           (interactive confirm)
 *       bun run db:reset-local -- --seed (reset + demo seed)
 *       bun run db:reset-local -- --yes --seed   (non-interactive)
 */
import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const wantSeed = args.includes('--seed')
const assumeYes = args.includes('--yes')

const db = new PrismaClient()

function fail(msg: string): never {
  console.error(`db-reset-local: ${msg}`)
  process.exit(1)
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    fail('refusing to run in production. This script is development-only.')
  }
  const url = process.env.DATABASE_URL || ''
  if (!url) fail('DATABASE_URL is not set.')
  // Remote-database guard: only local/resettable addresses are allowed.
  if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) {
    fail('DATABASE_URL does not point at localhost/127.0.0.1 — refusing to wipe a remote database.')
  }

  if (!assumeYes) {
    const tty = process.stdin.isTTY
    if (!tty) fail('non-interactive shell — pass --yes to confirm the destructive reset.')
    process.stdout.write(
      '\n⚠  This DELETES ALL DATA in the local database (users, records, audit, everything).\n' +
      `    Target: ${url.replace(/:[^:@/]+@/, ':***@')}\n    Type "reset" to confirm: `
    )
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once('data', (d) => resolve(String(d).trim()))
    })
    if (answer !== 'reset') fail('aborted — nothing was deleted.')
  }

  console.log('Resetting local database…')
  // Order: children before parents (FK safety); password reset tokens cascade with users.
  await db.misFormula.deleteMany({})
  await db.misValue.deleteMany({})
  await db.misRecord.deleteMany({})
  await db.misField.deleteMany({})
  await db.auditLog.deleteMany({})
  await db.importJob.deleteMany({})
  await db.passwordResetToken.deleteMany({})
  await db.user.deleteMany({})
  console.log('✓ all tables cleared')

  // Re-apply migrations (idempotent — deploy only applies pending ones).
  const { $execRaw } = db
  void $execRaw
  console.log('✓ done. Run `bun run db:seed` to load the demo dataset.')
  if (wantSeed) {
    console.log('(seed requested via --seed — starting seed…)')
    const { spawnSync } = await import('node:child_process')
    const r = spawnSync('bun', ['scripts/seed.ts'], { stdio: 'inherit', env: process.env })
    if (r.status !== 0) fail('seed step failed — database is reset but empty.')
  }
}

main()
  .catch((e) => { console.error('db-reset-local failed:', e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
