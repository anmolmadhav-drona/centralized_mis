/**
 * NPL MIS Portal — Password Reset E2E test.
 * Run: bun run test:reset     (production server must run on :3000)
 *
 * Covers (Phase 11 spec):
 *  1  reset request for a REAL user → 200 + uniform message
 *  2  reset request for an UNKNOWN user → 200 + byte-identical message (anti-enumeration)
 *  3  request creates a hashed token row in the database (raw token never stored)
 *  4  malformed body → still uniform 200 (no information leak)
 *  5  rate limit: 6th request within the window → 429
 *  6  confirm with a valid token → 200, password actually changes (new login works)
 *  7  old password no longer works after reset
 *  8  token is single-use → second confirm → 400
 *  9  expired token → 400
 * 10  garbage token → 400
 * 11  weak new password (<8 chars) → 400
 * 12  audit trail: PASSWORD_RESET_REQUESTED + PASSWORD_RESET events exist
 *
 * SMTP is not configured in the test environment — the request flow is still
 * exercised (token rows are created; the dev sink / loud error path handles
 * delivery absence). The confirm flow is driven with directly-inserted token
 * rows so no email access is ever required.
 */
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`) }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/** Credentials login — success = session cookie present (naLogin helper). */
async function tryLogin(email: string, password: string): Promise<boolean> {
  const { naLogin } = await import('./lib/na-login')
  return (await naLogin(BASE, email, password)) !== null
}

// Per-run client IP: the request/confirm rate limits (5/10min, 10/10min) are
// keyed per IP — a fresh random IP per run keeps the test rerunnable within
// the window without restarting the server.
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function main() {
  console.log('Password Reset E2E')
  console.log('===================')

  // --- test user (restored at the end) ---
  const TEST_EMAIL = 'viewer@npl.com'
  const user = await db.user.findUnique({ where: { email: TEST_EMAIL } })
  if (!user) {
    console.error(`setup: ${TEST_EMAIL} not found — seed the database first (bun run db:seed)`)
    process.exit(1)
  }
  const originalHash = user.passwordHash

  // Clean slate for this user's tokens
  await db.passwordResetToken.deleteMany({ where: { userId: user.id } })

  // ------------------------------------------------------------------
  // 1-4: request flow (uniform anti-enumeration responses)
  // ------------------------------------------------------------------
  console.log('\n-- request flow --')
  const real = await postJson('/api/auth/reset-request', { email: TEST_EMAIL })
  ok('1. real user → 200 ok', real.status === 200 && real.json.ok === true, `got ${real.status}`)

  const unknown = await postJson('/api/auth/reset-request', { email: 'nobody@nowhere.test' })
  ok(
    '2. unknown user → 200 + byte-identical message (anti-enumeration)',
    unknown.status === 200 && JSON.stringify(unknown.json) === JSON.stringify(real.json),
    `bodies differ: ${JSON.stringify(unknown.json)} vs ${JSON.stringify(real.json)}`
  )

  const tokenRow = await db.passwordResetToken.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  ok('3. token row created (hash stored, not raw token)', !!tokenRow && /^[0-9a-f]{64}$/.test(tokenRow.tokenHash))
  ok('3b. token expiry ≈ 30 minutes', !!tokenRow && tokenRow.expiresAt.getTime() - Date.now() > 25 * 60_000)

  const malformed = await postJson('/api/auth/reset-request', {})
  ok('4. malformed body → uniform 200', malformed.status === 200, `got ${malformed.status}`)

  // ------------------------------------------------------------------
  // 5: rate limit (5/10min per IP — requests above already consumed 3)
  // ------------------------------------------------------------------
  let got429 = false
  for (let i = 0; i < 4; i++) {
    const r = await postJson('/api/auth/reset-request', { email: 'rate-probe@nowhere.test' })
    if (r.status === 429) { got429 = true; break }
  }
  ok('5. rate limit engages → 429', got429)

  // ------------------------------------------------------------------
  // 6-11: confirm flow with directly-inserted tokens (no email needed)
  // ------------------------------------------------------------------
  console.log('\n-- confirm flow --')
  const goodToken = randomBytes(32).toString('base64url')
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(goodToken), expiresAt: new Date(Date.now() + 30 * 60_000) },
  })

  const NEW_PASSWORD = 'ResetTest#99'
  const confirm = await postJson('/api/auth/reset-confirm', { token: goodToken, password: NEW_PASSWORD })
  ok('6. valid token + new password → 200', confirm.status === 200 && confirm.json.ok === true, `got ${confirm.status} ${JSON.stringify(confirm.json)}`)

  const loginNew = await tryLogin(TEST_EMAIL, NEW_PASSWORD)
  ok('6b. login with NEW password succeeds', loginNew)

  const loginOld = await tryLogin(TEST_EMAIL, 'Viewer@123')
  ok('7. old password rejected', !loginOld, `loginOld=${loginOld}`)

  const reuse = await postJson('/api/auth/reset-confirm', { token: goodToken, password: 'Another#Pass1' })
  ok('8. token is single-use → second confirm 400', reuse.status === 400, `got ${reuse.status}`)

  const expiredToken = randomBytes(32).toString('base64url')
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(expiredToken), expiresAt: new Date(Date.now() - 60_000) },
  })
  const expired = await postJson('/api/auth/reset-confirm', { token: expiredToken, password: 'Some#Pass99' })
  ok('9. expired token → 400', expired.status === 400, `got ${expired.status}`)

  const garbage = await postJson('/api/auth/reset-confirm', { token: 'x'.repeat(43), password: 'Some#Pass99' })
  ok('10. garbage token → 400 uniform message', garbage.status === 400 && garbage.json.error === expired.json.error)

  const weak = await postJson('/api/auth/reset-confirm', { token: randomBytes(32).toString('base64url'), password: 'short' })
  ok('11. weak password (<8 chars) → 400', weak.status === 400, `got ${weak.status}`)

  // ------------------------------------------------------------------
  // 12: audit trail
  // ------------------------------------------------------------------
  const audits = await db.auditLog.findMany({
    where: { userId: user.id, action: { in: ['PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET'] } },
    orderBy: { createdAt: 'desc' }, take: 5,
  })
  ok(
    '12. audit events written (requested + completed)',
    audits.some((a) => a.action === 'PASSWORD_RESET_REQUESTED') && audits.some((a) => a.action === 'PASSWORD_RESET')
  )

  // ------------------------------------------------------------------
  // restore: original password hash + clean tokens (leave no test state)
  // ------------------------------------------------------------------
  await db.user.update({ where: { id: user.id }, data: { passwordHash: originalHash } })
  await db.passwordResetToken.deleteMany({ where: { userId: user.id } })
  await db.auditLog.deleteMany({ where: { userId: user.id, action: { in: ['PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET'] } } })
  console.log('\n(test user password restored, tokens cleared)')

  console.log(`\n================================\nPASSWORD RESET E2E: ${passed} pass / ${failed} fail\n================================`)
  if (failed > 0) { console.log(failures.join('\n')); process.exit(1) }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
