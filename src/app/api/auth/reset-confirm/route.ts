// POST /api/auth/reset-confirm — complete a password reset.
//
// PUBLIC endpoint (no session — the user cannot sign in, that is the point).
//   • Rate limited: 10 attempts / 10 minutes / IP.
//   • Token + new password in the body; the token is consumed atomically
//     (single use). Uniform error message for invalid/expired/used tokens —
//     the client never learns which.
//   • Password minimum 8 chars (same rule as user management).
//   • The new password is never logged; the audit event records the reset,
//     not the credential.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { requestIp, requestUserAgent } from '@/lib/net'
import { confirmPasswordReset } from '@/lib/services/password-reset'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  token: z.string().min(10).max(512),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export const POST = route(async (req: NextRequest) => {
  const ip = requestIp(req.headers) || 'anon'
  rateLimit(`reset-confirm:${ip}`, 10, 10 * 60_000)

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid or expired reset link.', code: 'RESET_INVALID' },
      { status: 400 }
    )
  }

  const result = await confirmPasswordReset(parsed.data.token, parsed.data.password, {
    ip,
    userAgent: requestUserAgent(req.headers),
    requestId: req.headers.get('x-request-id'),
    origin: '',
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Invalid or expired reset link.', code: 'RESET_INVALID' },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true, message: 'Password updated. You can sign in with your new password now.' })
})
