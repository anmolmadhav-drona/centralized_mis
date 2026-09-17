// Password reset — server-side foundation.
//
// Flow:  request(email) → token generation → persistence (SHA-256 hash only)
//        → email adapter (SMTP or dev sink) → user opens link
//        → confirm(token, newPassword) → single-use atomic claim → Argon2id
//
// Security properties:
//   • Anti-enumeration: requestPasswordReset() NEVER reveals whether the
//     email exists — the API responds identically either way. The token is
//     only created for a real, active user.
//   • Tokens are 256-bit random (node:crypto), stored ONLY as SHA-256 hashes.
//   • Single use: the claim is an atomic conditional UPDATE — two concurrent
//     confirms with the same token can never both succeed.
//   • Expiry: 30 minutes, checked at claim time.
//   • Reset tokens are never logged. Audit events record who/when, not how.
//   • Old sessions: JWT sessions cannot be revoked without a denylist (see
//     docs/production-checklist.md — OPTIONAL/FUTURE). Sessions expire after
//     at most 7 days; the password change takes effect on next sign-in.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { sendMail, smtpConfigured, MailNotConfiguredError } from '@/lib/services/mail'
import { writeAudit } from '@/lib/services/audit'

const TOKEN_TTL_MINUTES = 30
const TOKEN_BYTES = 32 // 256-bit

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface ResetRequestContext {
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
  /** Public origin for the reset link (scheme+host, e.g. https://mis.example.com). */
  origin: string
}

/**
 * Request a password reset. Returns nothing user-differentiable — callers
 * must respond with a generic success regardless of the outcome.
 */
export async function requestPasswordReset(emailRaw: string, ctx: ResetRequestContext): Promise<void> {
  const email = String(emailRaw || '').trim().toLowerCase()

  // Housekeeping: drop expired/used tokens (cheap, keeps the table small).
  await db.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  })

  if (!email) return
  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.active) return // uniform outcome — no enumeration

  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
    },
  })

  const link = `${ctx.origin.replace(/\/+$/, '')}/reset-password?token=${token}`
  const subject = 'Reset your Drona Centralized MIS password'
  const text =
    `Hello ${user.name},\n\n` +
    `A password reset was requested for your account (${user.email}).\n` +
    `This link is valid for ${TOKEN_TTL_MINUTES} minutes and can be used once:\n\n${link}\n\n` +
    `If you did not request this, you can ignore this email — your password stays unchanged.\n`
  const html =
    `<p>Hello ${escapeHtml(user.name)},</p>` +
    `<p>A password reset was requested for your account (<code>${escapeHtml(user.email)}</code>).</p>` +
    `<p>This link is valid for ${TOKEN_TTL_MINUTES} minutes and can be used once:</p>` +
    `<p><a href="${link}">Reset your password</a></p>` +
    `<p>If you did not request this, you can ignore this email — your password stays unchanged.</p>`

  try {
    const result = await sendMail({ to: user.email, subject, text, html })
    if (!result.ok) {
      console.error(`[password-reset] mail delivery failed for a reset request (reason: ${result.error}). The request was accepted but the email was NOT sent.`)
    }
  } catch (err) {
    if (err instanceof MailNotConfiguredError) {
      // Uniform anti-enumeration response is preserved — but the failure is
      // logged loudly. Delivery is NEVER faked.
      console.error(
        '[password-reset] SMTP is not configured — the reset request was accepted but NO email was sent. ' +
        'Configure SMTP_HOST / SMTP_PORT / SMTP_FROM (see .env.example) to enable delivery.'
      )
    } else {
      throw err
    }
  }

  await writeAudit([{
    userId: user.id, userName: user.name, action: 'PASSWORD_RESET_REQUESTED', entity: 'AUTH',
    source: 'PORTAL', ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId,
  }])
}

export type ResetConfirmResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * Confirm a password reset: consume the token (atomically, single-use) and
 * set the new Argon2id password hash.
 */
export async function confirmPasswordReset(
  tokenRaw: string,
  newPassword: string,
  ctx: ResetRequestContext
): Promise<ResetConfirmResult> {
  const token = String(tokenRaw || '').trim()
  if (!token) return { ok: false, reason: 'invalid' }
  if (typeof newPassword !== 'string' || newPassword.length < 8) return { ok: false, reason: 'invalid' }

  const tokenHash = sha256(token)
  const stored = await db.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } })
  if (!stored) return { ok: false, reason: 'invalid' }

  // Expiry — checked against the stored row BEFORE claiming (a used token is
  // also "invalid" to the outside world; the distinction stays server-side).
  if (stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  // Atomic single-use claim: only succeeds if still unused. Two concurrent
  // requests with the same token → exactly one update matches.
  const claimed = await db.passwordResetToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count !== 1) return { ok: false, reason: 'expired' }

  await db.user.update({
    where: { id: stored.userId },
    data: { passwordHash: await hashPassword(newPassword) },
  })

  // Defense in depth: invalidate any OTHER pending tokens for this user.
  await db.passwordResetToken.deleteMany({ where: { userId: stored.userId, usedAt: null } })

  await writeAudit([{
    userId: stored.userId, userName: stored.user.name, action: 'PASSWORD_RESET', entity: 'AUTH',
    source: 'PORTAL', ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId,
  }])
  return { ok: true }
}

/** Constant-time comparison helper exposed for tests. */
export function tokenMatches(raw: string, hash: string): boolean {
  const a = createHash('sha256').update(raw).digest()
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
