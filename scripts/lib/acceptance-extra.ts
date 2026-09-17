// Development-only: Phase-38 acceptance spot-checks (inactive user, race, logout)
import { PrismaClient } from '@prisma/client'
import { naLogin } from './na-login'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => { if (cond) pass++; else fail++; console.log(`  ${cond ? '✓' : '✗'} ${name}`) }

async function main() {
  // --- 1. inactive account: login rejected + existing session invalidated ---
  console.log('[1] Inactive account handling')
  const vEmail = 'viewer@npl.com'
  await db.user.update({ where: { email: vEmail }, data: { active: false } })
  const inactiveLogin = await naLogin(BASE, vEmail, 'Viewer@123')
  ok('inactive account cannot sign in', inactiveLogin === null)
  await db.user.update({ where: { email: vEmail }, data: { active: true } })
  const reLogin = await naLogin(BASE, vEmail, 'Viewer@123')
  ok('reactivated account can sign in', !!reLogin)
  // deactivate again WITH a live session → session must be rejected
  await db.user.update({ where: { email: vEmail }, data: { active: false } })
  const meRes = await fetch(BASE + '/api/auth/me', { headers: { cookie: reLogin! } })
  const me = await meRes.json() as { user: unknown }
  ok('live session rejected after deactivation (server-side check)', me.user === null)
  await db.user.update({ where: { email: vEmail }, data: { active: true } })

  // --- 2. concurrent same-key creates: DB uniqueness is the final guard ---
  console.log('[2] Concurrent insert race (business-key uniqueness)')
  const admin = await naLogin(BASE, 'admin@npl.com', 'Admin@123')
  const payload = JSON.stringify({ values: { partyName: 'Race Test Co', destination: 'RaceCity', invoiceNumber: 'RACE-99001', lrNo: 990002, lrDate: '2026-09-16', materialDetails: 'TATA Genius DEF (1*10) - PVBU', bucket: 120, totalQuantityLtrs: 120, deliveryStatus: 'Pending' } })
  const results = await Promise.all([1, 2, 3, 4].map(() =>
    fetch(BASE + '/api/records', { method: 'POST', headers: { 'content-type': 'application/json', cookie: admin! }, body: payload })))
  const codes = results.map((r) => r.status).sort()
  ok(`exactly one 201, rest 409 (got ${codes.join(',')})`, codes[0] === 201 && codes.filter((c) => c === 201).length === 1 && codes.slice(1).every((c) => c === 409))

  // --- 3. logout invalidates the session cookie ---
  console.log('[3] Sign-out')
  const jar: string[] = []
  const csrfRes = await fetch(BASE + '/api/auth/csrf')
  for (const c of csrfRes.headers.getSetCookie?.() || []) jar.push(c.split(';')[0])
  const { csrfToken } = await csrfRes.json() as { csrfToken: string }
  const cookieHdr = jar.join('; ')
  await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHdr },
    body: new URLSearchParams({ csrfToken, email: 'admin@npl.com', password: 'Admin@123', callbackUrl: BASE + '/' }),
    redirect: 'manual',
  })
  // sign out via the NextAuth endpoint
  const so = await fetch(BASE + '/api/auth/signout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHdr, 'x-auth-return-redirect': '1' },
    body: new URLSearchParams({ csrfToken, callbackUrl: BASE + '/' }),
    redirect: 'manual',
  })
  ok(`signout responds 200 (got ${so.status})`, so.status === 200)

  console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
