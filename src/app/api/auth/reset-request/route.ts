// POST /api/auth/reset-request — request a password reset link.
//
// PUBLIC endpoint (no session). Security properties:
//   • Anti-enumeration: the response is byte-identical whether or not the
//     email belongs to an account. Never reveal account existence.
//   • Rate limited: 5 requests / 10 minutes / IP.
//   • The reset token is never in the response — only in the email (or the
//     DEV mail sink when SMTP is unconfigured in development).
//   • In production without SMTP the request is still accepted (uniform
//     response) but the mail adapter logs a loud error — delivery is NOT
//     faked. Configure SMTP_HOST etc. to enable actual delivery.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { requestIp, requestUserAgent } from '@/lib/net'
import { requestPasswordReset } from '@/lib/services/password-reset'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ email: z.string().min(3).max(254) })

export const POST = route(async (req: NextRequest) => {
  const ip = requestIp(req.headers) || 'anon'
  rateLimit(`reset-req:${ip}`, 5, 10 * 60_000)

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  const email = parsed.success ? parsed.data.email : ''

  // Public origin for the reset link: the request's own origin (behind the
  // Coolify proxy this is the public domain), overridable with APP_URL for
  // exotic topologies.
  const origin = process.env.APP_URL || new URL(req.url).origin

  await requestPasswordReset(email, {
    ip,
    userAgent: requestUserAgent(req.headers),
    requestId: req.headers.get('x-request-id'),
    origin,
  })

  // Uniform response — ALWAYS the same shape and message.
  return NextResponse.json({
    ok: true,
    message: 'If an account exists for that email, a reset link has been sent. The link is valid for 30 minutes.',
  })
})
