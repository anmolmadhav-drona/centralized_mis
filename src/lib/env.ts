// Centralized server-side environment validation.
//
// Design goals (see docs/local-development.md → "Environment validation"):
//   • FATAL in production only for variables the app genuinely cannot boot
//     without: DATABASE_URL, AUTH_SECRET. The failure message names the
//     variable and the reason — NEVER the value.
//   • Non-fatal production problems (realtime wiring, SMTP) are logged once
//     as clear errors; the app boots and the affected feature degrades
//     loudly instead of silently.
//   • Development never crashes on missing integrations — safe local
//     defaults are documented in .env.example and applied by the consumers.
//   • Optional integration groups (SMTP) are validated only when their
//     primary variable is present, so an unconfigured feature adds no noise.
//
// This module is SERVER-ONLY (no "use client" consumers; it never runs in
// the browser and never exposes values through NEXT_PUBLIC_*).
import { z } from 'zod'

const IS_PROD = process.env.NODE_ENV === 'production'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const postgresUrl = z
  .string()
  .min(1, 'is not set')
  .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), 'must start with postgresql://')
  .refine((v) => {
    try {
      const u = new URL(v)
      return !!u.hostname && !!u.pathname.slice(1)
    } catch {
      return false
    }
  }, 'is not a valid connection URL (postgresql://user:password@host:5432/dbname)')

const httpUrl = z
  .string()
  .min(1, 'is not set')
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }, 'must be a valid http(s) URL')

const port = z
  .string()
  .refine((v) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= 65535
  }, 'must be an integer between 1 and 65535')

const secretMin = (min: number) =>
  z.string().refine((v) => v.length >= min, `must be at least ${min} characters (generate with: openssl rand -base64 32)`)

const email = z.string().refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'must be a valid email address')

// ---------------------------------------------------------------------------
// Validation result plumbing
// ---------------------------------------------------------------------------

export interface EnvIssue {
  variable: string
  problem: string
  severity: 'fatal' | 'error' | 'warn'
}

const issues: EnvIssue[] = []

function check(variable: string, severity: EnvIssue['severity'], schema: z.ZodType, raw: string | undefined): void {
  if (raw === undefined || raw === '') {
    issues.push({ variable, problem: 'is not set', severity })
    return
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    issues.push({ variable, problem: parsed.error.issues[0]?.message ?? 'is invalid', severity })
  }
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

/**
 * Validate the server environment. Called once at server start
 * (src/instrumentation.ts). Throws in production only when the app truly
 * cannot start; otherwise collects issues and reports them.
 */
export function validateServerEnv(): EnvIssue[] {
  issues.length = 0

  // ---- FATAL in production: the app cannot boot without these ----
  check('DATABASE_URL', IS_PROD ? 'fatal' : 'warn', postgresUrl, process.env.DATABASE_URL)
  check('AUTH_SECRET', IS_PROD ? 'fatal' : 'warn', secretMin(32), process.env.AUTH_SECRET)

  // ---- Realtime wiring: app boots, feature degrades loudly ----
  // (local development defaults: http://127.0.0.1:3004 + same-origin client)
  if (process.env.REALTIME_URL !== undefined && process.env.REALTIME_URL !== '') {
    check('REALTIME_URL', 'error', httpUrl, process.env.REALTIME_URL)
  } else if (IS_PROD) {
    issues.push({
      variable: 'REALTIME_URL',
      problem: 'is not set — realtime events will be attempted against the local default (http://127.0.0.1:3004); set it to the realtime service\u2019s internal address',
      severity: 'error',
    })
  }
  if (process.env.REALTIME_PUBLIC_URL !== undefined && process.env.REALTIME_PUBLIC_URL !== '') {
    check('REALTIME_PUBLIC_URL', 'error', httpUrl, process.env.REALTIME_PUBLIC_URL)
  } else if (IS_PROD) {
    issues.push({
      variable: 'REALTIME_PUBLIC_URL',
      problem: 'is not set — browsers will fall back to same-origin realtime; required for the Coolify two-domain architecture',
      severity: 'error',
    })
  }
  if (process.env.REALTIME_SECRET !== undefined && process.env.REALTIME_SECRET !== '') {
    check('REALTIME_SECRET', 'error', secretMin(24), process.env.REALTIME_SECRET)
  } else if (IS_PROD) {
    issues.push({
      variable: 'REALTIME_SECRET',
      problem: 'is not set — realtime events will NOT be delivered (the realtime service rejects unauthenticated /emit calls)',
      severity: 'error',
    })
  }

  // ---- SMTP (optional group — validated only when configured) ----
  // Password reset emails require SMTP. Without SMTP the app runs fine;
  // reset requests are accepted (anti-enumeration) but mail delivery fails
  // loudly in the server logs. See src/lib/services/mail.ts.
  if (process.env.SMTP_HOST) {
    check('SMTP_PORT', 'error', port, process.env.SMTP_PORT || '587')
    if (process.env.SMTP_FROM) check('SMTP_FROM', 'error', email, process.env.SMTP_FROM)
    if (!process.env.SMTP_USER !== !process.env.SMTP_PASSWORD) {
      // exactly one of user/password set — almost certainly a misconfiguration
      issues.push({
        variable: 'SMTP_USER / SMTP_PASSWORD',
        problem: 'must be set together (currently exactly one is set)',
        severity: 'error',
      })
    }
  } else if (IS_PROD) {
    issues.push({
      variable: 'SMTP_HOST',
      problem: 'is not set — password reset emails cannot be sent until SMTP is configured',
      severity: 'warn',
    })
  }

  report()
  return [...issues]
}

function report(): void {
  const fatals = issues.filter((i) => i.severity === 'fatal')
  const errors = issues.filter((i) => i.severity === 'error')
  const warns = issues.filter((i) => i.severity === 'warn')

  const line = (i: EnvIssue) => `  [env] ${i.variable} ${i.problem}`

  if (fatals.length > 0) {
    const msg =
      '\n' +
      '┌──────────────────────────────────────────────────────────────┐\n' +
      '│  REFUSING TO START — required environment variables failed  │\n' +
      '└──────────────────────────────────────────────────────────────┘\n' +
      fatals.map(line).join('\n') +
      '\n  Fix the listed variables (see .env.example for documentation) and restart.\n' +
      '  Secret values are never printed.\n'
    console.error(msg)
    throw new Error(`Environment validation failed: ${fatals.map((f) => f.variable).join(', ')}`)
  }
  for (const e of errors) console.error(line(e))
  for (const w of warns) console.warn(line(w))
  if (errors.length === 0 && warns.length === 0 && process.env.NODE_ENV !== 'test') {
    console.log('[env] environment validation passed')
  }
}
