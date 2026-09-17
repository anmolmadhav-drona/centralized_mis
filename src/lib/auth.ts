// Authentication — Auth.js v5 (NextAuth) with a credentials provider.
//
// This is the single authoritative authentication mechanism:
//   • Credentials sign-in (email + password) → JWT session cookie
//   • Argon2id password hashing (hash-wasm — pure WASM, no native deps)
//   • Legacy bcrypt hashes are verified and transparently re-hashed with
//     Argon2id on the next successful login (no forced password resets)
//   • Login rate limiting per client IP (10 failures / minute)
//   • Inactive accounts are rejected at sign-in AND at every request
//   • LOGIN / LOGIN_FAILED audit events
//
// Security notes:
//   • AUTH_SECRET must be provided in production (Auth.js fails closed).
//   • Sessions are HttpOnly cookies, SameSite=Lax, Secure in production,
//     expiring after 7 days; role/id live in the signed JWT only.
//   • Role claims are never trusted from the client — server-side
//     authorization (requirePermission) always re-reads the user.
import NextAuth, { type DefaultSession } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { argon2id, argon2Verify } from 'hash-wasm'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit, RateLimitError } from '@/lib/rate-limit'
import { writeAudit } from '@/lib/services/audit'
import { requestIp, requestUserAgent } from '@/lib/net'
import type { Role, SessionUser } from '@/lib/types'

// ---------------------------------------------------------------------------
// Password hashing — Argon2id (OWASP-aligned parameters)
// ---------------------------------------------------------------------------
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 2, // time cost
  memorySize: 19456, // 19 MiB
  hashLength: 32,
} as const

/** Hash a password with Argon2id (encoded, self-describing format). */
export async function hashPassword(plain: string): Promise<string> {
  return argon2id({
    password: plain,
    salt: randomBytes(16),
    ...ARGON2_PARAMS,
    outputType: 'encoded',
  })
}

/** True when the stored hash is a legacy bcrypt hash awaiting upgrade. */
export function isLegacyBcryptHash(hash: string): boolean {
  return hash.startsWith('$2')
}

/**
 * Verify a password against a stored hash.
 * Supports Argon2id (current) and bcrypt (legacy accounts).
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    if (hash.startsWith('$argon2')) return await argon2Verify({ password: plain, hash })
    if (isLegacyBcryptHash(hash)) return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
  return false
}

// ---------------------------------------------------------------------------
// Errors surfaced to the client (safe codes only — never reveal which part
// of the credentials was wrong)
// ---------------------------------------------------------------------------
import { CredentialsSignin } from 'next-auth'

class TooManyAttemptsError extends CredentialsSignin {
  code = 'too_many_attempts'
}

// ---------------------------------------------------------------------------
// Auth.js configuration
// ---------------------------------------------------------------------------
export const { handlers, signIn, signOut, auth } = NextAuth({
  // The app runs behind reverse proxies (Coolify in production, the sandbox
  // gateway locally) — trust the forwarded host headers.
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days (matches the previous session TTL)
  },
  // The portal renders its own login view; Auth.js's built-in pages stay
  // unused. Client flows use signIn('credentials', { redirect: false }).
  pages: { signIn: '/' },
  providers: [
    Credentials({
      credentials: { email: { label: 'Email' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials, request) {
        const reqHeaders = request instanceof Request ? request.headers : new Headers()
        const ip = requestIp(reqHeaders)
        const userAgent = requestUserAgent(reqHeaders)
        const requestId = reqHeaders.get('x-request-id')

        // rate limit BEFORE touching the database
        try {
          rateLimit(`login:${ip || 'anon'}`, 10, 60_000)
        } catch (err) {
          if (err instanceof RateLimitError) throw new TooManyAttemptsError()
          throw err
        }

        const email = String(credentials?.email ?? '').trim().toLowerCase()
        const password = String(credentials?.password ?? '')
        if (!email || !password) return null

        const user = await db.user.findUnique({ where: { email } })
        const ok = user && user.active ? await verifyPassword(password, user.passwordHash) : false

        if (!ok || !user) {
          await writeAudit([{
            userId: user?.id ?? null, userName: email, action: 'LOGIN_FAILED', entity: 'AUTH',
            source: 'PORTAL', ip, userAgent, requestId,
          }])
          // uniform message — do not reveal which part was wrong
          return null
        }

        // transparent hash upgrade: bcrypt → Argon2id on successful login
        if (isLegacyBcryptHash(user.passwordHash)) {
          try {
            await db.user.update({
              where: { id: user.id },
              data: { passwordHash: await hashPassword(password) },
            })
          } catch {
            // non-fatal — the old hash remains valid for next time
          }
        }

        await writeAudit([{
          userId: user.id, userName: user.name, action: 'LOGIN', entity: 'AUTH',
          source: 'PORTAL', ip, userAgent, requestId,
        }])

        // returned object becomes the JWT `user` claim
        return { id: user.id, email: user.email, name: user.name, role: user.role as Role }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as SessionUser).role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? '')
        session.user.role = (token.role as Role) ?? 'VIEWER'
      }
      return session
    },
  },
})

// ---------------------------------------------------------------------------
// Server-side session accessor — used by every API route.
// Re-checks the database so deactivated accounts lose access immediately,
// even with a still-valid signed session cookie.
// ---------------------------------------------------------------------------
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  const su = session?.user
  if (!su?.id) return null
  const dbUser = await db.user.findUnique({ where: { id: su.id } })
  if (!dbUser || !dbUser.active) return null
  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role as Role,
  }
}

// Type re-exports for the rest of the app
export type { DefaultSession }
