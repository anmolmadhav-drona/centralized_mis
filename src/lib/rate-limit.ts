// Simple in-memory rate limiter (per process) for sensitive endpoints.
// Kept in its own module so both the API wrapper and the Auth.js
// credentials provider can use it without import cycles.
//
// Note: per-process only — with multiple app replicas each process counts
// separately. The login limiter is a brute-force speed bump; the database
// and RBAC remain the real security boundary.
const buckets = new Map<string, { count: number; resetAt: number }>()

export class RateLimitError extends Error {
  status = 429
  constructor(message = 'Too many requests. Please wait a moment and try again.') {
    super(message)
    this.name = 'RateLimitError'
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  b.count++
  if (b.count > limit) {
    throw new RateLimitError()
  }
}
