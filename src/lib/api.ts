// API helpers — uniform envelope, auth guards, safe error handling
import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getSessionUser } from '@/lib/auth'
import { requestIp, requestUserAgent } from '@/lib/net'
import { RateLimitError } from '@/lib/rate-limit'
import { can, type Permission } from '@/lib/rbac'
import type { SessionUser } from '@/lib/types'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function errorId(): string {
  return `ERR-${Date.now().toString(36).toUpperCase()}`
}

/** Correlation ID assigned by the API middleware (or a fresh local one). */
function requestIdOf(req: NextRequest): string {
  return req.headers.get('x-request-id') || errorId()
}

/** Wrap a route handler with uniform error translation (never leak stack traces). */
export function route<Ctx>(handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        )
      }
      if (err instanceof RateLimitError) {
        return NextResponse.json(
          { error: err.message, code: 'RATE_LIMITED' },
          { status: 429 }
        )
      }
      if (err instanceof ZodError) {
        const first = err.issues[0]
        return NextResponse.json(
          { error: `Validation failed: ${first?.path.join('.') || 'input'} — ${first?.message || 'invalid value'}` },
          { status: 400 }
        )
      }
      const id = requestIdOf(req)
      console.error(`[api:${id}]`, err)
      const res = NextResponse.json(
        { error: 'Something went wrong while processing your request. Please try again.', requestId: id },
        { status: 500 }
      )
      res.headers.set('x-request-id', id)
      return res
    }
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new ApiError(401, 'Your session has expired. Please sign in again.')
  return user
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user.role, permission)) {
    throw new ApiError(403, 'You do not have permission to perform this action.')
  }
  return user
}

/** Client IP / user-agent for audit logs (proxy-aware — see @/lib/net). */
export function clientIp(req: NextRequest): string | null {
  return requestIp(req.headers)
}

export function clientAgent(req: NextRequest): string | null {
  return requestUserAgent(req.headers)
}

// Rate limiter lives in @/lib/rate-limit (shared with the Auth.js
// credentials provider) — re-exported here for existing imports.
export { rateLimit } from '@/lib/rate-limit'
