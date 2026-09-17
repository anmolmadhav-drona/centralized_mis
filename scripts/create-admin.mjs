/**
 * Production-safe initial administrator bootstrap.
 *
 * Plain ESM JavaScript (no TypeScript) on purpose: it must run with plain
 * `node` inside the production container (node:22-slim, no bun, no tsc) AND
 * with `bun` on the developer machine.
 *
 * Creates (or refuses to create) the first ADMIN account using environment
 * variables — no default passwords, ever. Idempotent: if an active admin
 * already exists, it exits without touching anything.
 *
 * Usage:
 *   ADMIN_EMAIL="ops@example.com" \
 *   ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 24)" \
 *   ADMIN_NAME="Operations Admin" \
 *   DATABASE_URL="postgresql://…" \
 *   node scripts/create-admin.mjs        (or: bun scripts/create-admin.mjs)
 *
 * In Coolify: web application → Terminal (or a one-off command) — the image
 * ships this file plus the Prisma CLI and the generated client.
 *
 * Exit codes: 0 = created (or already present), 1 = misconfiguration.
 */
import { PrismaClient } from '@prisma/client'
import { argon2id } from 'hash-wasm'
import { randomBytes } from 'node:crypto'

const db = new PrismaClient()

// Keep these parameters identical to src/lib/auth.ts (hashPassword).
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 2, // time cost
  memorySize: 19456, // 19 MiB
  hashLength: 32,
}

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_INITIAL_PASSWORD || ''
  const name = process.env.ADMIN_NAME || 'Administrator'
  const role = process.env.ADMIN_ROLE === 'MANAGER' ? 'MANAGER' : 'ADMIN'

  if (!process.env.DATABASE_URL) {
    console.error('create-admin: DATABASE_URL is not set — point it at the target database.')
    process.exitCode = 1
    return
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('create-admin: ADMIN_EMAIL is required (a valid email address).')
    process.exitCode = 1
    return
  }
  if (password.length < 8) {
    console.error('create-admin: ADMIN_INITIAL_PASSWORD is required and must be at least 8 characters.')
    console.error('               Generate one with: openssl rand -base64 24')
    process.exitCode = 1
    return
  }

  // Idempotency guard: never overwrite an existing production admin.
  const existingAdmin = await db.user.findFirst({ where: { role: 'ADMIN', active: true } })
  if (existingAdmin) {
    console.log(`create-admin: an active administrator already exists (${existingAdmin.email}) — nothing to do.`)
    return
  }
  const existingUser = await db.user.findUnique({ where: { email } })
  if (existingUser) {
    console.error(`create-admin: a user with this email already exists (${email}) but is not an active admin — resolve manually.`)
    process.exitCode = 1
    return
  }

  await db.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: await argon2id({
        password,
        salt: randomBytes(16),
        ...ARGON2_PARAMS,
        outputType: 'encoded',
      }),
    },
  })
  console.log(`create-admin: created ${role} account ${email}.`)
  console.log('create-admin: store the password securely now — it is not recoverable from the database.')
}

main()
  .catch((e) => {
    console.error('create-admin failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
