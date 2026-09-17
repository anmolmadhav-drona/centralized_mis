#!/usr/bin/env node
// ============================================================================
// NPL MIS Portal — PRODUCTION PREFLIGHT.
//
//   bun run preflight:prod                    (local, reads .env if present)
//   node  scripts/preflight-prod.mjs          (inside the production container)
//   node  scripts/preflight-prod.mjs --env-file=prod.env
//
// Validates the production environment CONTRACT without starting the app and
// WITHOUT EVER PRINTING SECRET VALUES (AUTH_SECRET, REALTIME_SECRET,
// SMTP_PASSWORD are only ever reported as "set / not set / length").
//
// Stricter than the boot-time validation (src/lib/env.ts): preflight FAILS on
// missing realtime wiring (the app would boot but silently degrade), and on
// any forbidden development setting.
//
// Exit codes: 0 = contract satisfied (warnings allowed) · 1 = errors found.
// ============================================================================
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------- env file --
// An explicit --env-file=PATH is honoured; otherwise ./.env is loaded IF it
// exists (plain `node` does not auto-load it; `bun run` does — in that case
// the values are already in process.env and take precedence).
const args = process.argv.slice(2)
let envFile = null
let envFileExplicit = false
for (const a of args) {
  if (a.startsWith('--env-file=')) {
    envFile = a.slice('--env-file='.length)
    envFileExplicit = true
  } else if (a === '--env-file' || a === '--help' || a === '-h') {
    console.log('usage: node scripts/preflight-prod.mjs [--env-file=<path>]')
    process.exit(0)
  } else {
    console.error(`unknown argument: ${a}`)
    process.exit(2)
  }
}
if (!envFile) {
  try {
    readFileSync(resolve('.env'))
    envFile = '.env'
  } catch {
    /* no .env — validate the real environment only */
  }
}
if (envFile) {
  let text = ''
  try {
    text = readFileSync(resolve(envFile), 'utf8')
  } catch {
    console.error(`preflight: cannot read env file: ${envFile}`)
    process.exit(2)
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // An EXPLICIT --env-file is authoritative (the user asked to validate
    // exactly that file — it overrides inherited environment values).
    // The implicit ./.env is a fallback only: real environment variables
    // (e.g. set by the platform) keep precedence, matching dotenv norms.
    if (envFileExplicit || process.env[key] === undefined) process.env[key] = val
  }
}

// ------------------------------------------------------------- check engine --
const results = [] // {state: 'ok'|'warn'|'error', line}
const ok = (line) => results.push({ state: 'ok', line })
const warn = (line) => results.push({ state: 'warn', line })
const error = (line) => results.push({ state: 'error', line })

const isSet = (v) => v !== undefined && v !== ''
const parseUrl = (v) => {
  try {
    return new URL(v)
  } catch {
    return null
  }
}
const isLocalhost = (host) => /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(host || '')
/** Show a database URL with credentials masked (host/db are not secret). */
const maskDbUrl = (v) => v.replace(/\/\/([^:@/]+):([^@]*)@/, '//$1:***@')

const IS_PROD = process.env.NODE_ENV === 'production'

// ------------------------------------------------------------------ checks --
// NODE_ENV (context only — never a failure: preflight can be dry-run locally)
if (!IS_PROD) {
  warn(`NODE_ENV is '${process.env.NODE_ENV || 'unset'}' — preflight validates the PRODUCTION contract; a dry-run with production-shaped values is fine`)
} else {
  ok('NODE_ENV is production')
}

// ---- DATABASE_URL (fatal) ----
{
  const v = process.env.DATABASE_URL
  if (!isSet(v)) error('DATABASE_URL is not set')
  else if (!/^(postgresql|postgres):\/\//.test(v)) {
    error(`DATABASE_URL must be a PostgreSQL URL (postgresql://user:password@host:5432/db) — got: ${maskDbUrl(v)}`)
  } else {
    const u = parseUrl(v)
    if (!u || !u.hostname || !u.pathname.slice(1)) error(`DATABASE_URL is not a valid connection URL — got: ${maskDbUrl(v)}`)
    else if (isLocalhost(u.hostname)) {
      error(`DATABASE_URL points at ${u.hostname} — the production database must be the dedicated Coolify PostgreSQL resource (internal hostname), not an in-container database`)
    } else {
      ok(`DATABASE_URL → ${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname} (credentials not shown)`)
    }
  }
}

// ---- AUTH_SECRET (fatal) ----
{
  const v = process.env.AUTH_SECRET
  if (!isSet(v)) error('AUTH_SECRET is not set (generate: openssl rand -base64 32)')
  else if (v.length < 32) error(`AUTH_SECRET is too short (${v.length} chars — minimum 32; generate: openssl rand -base64 32)`)
  else ok(`AUTH_SECRET is set (${v.length} chars — value not shown)`)
}

// ---- Realtime wiring (required — preflight is strict) ----
{
  const v = process.env.REALTIME_URL
  if (!isSet(v)) error('REALTIME_URL is not set — set it to the realtime service INTERNAL address (http://<realtime-service-host>:3004)')
  else {
    const u = parseUrl(v)
    if (!u || !/^https?:$/.test(u.protocol)) error('REALTIME_URL must be a valid http(s) URL')
    else if (isLocalhost(u.hostname)) warn(`REALTIME_URL points at ${u.hostname} — only correct when the realtime service runs on the same host; on Coolify use the service's internal hostname`)
    else ok(`REALTIME_URL → ${u.origin} (internal /emit endpoint)`)
  }
}
{
  const v = process.env.REALTIME_PUBLIC_URL
  if (!isSet(v)) error('REALTIME_PUBLIC_URL is not set — browsers need the realtime service public URL (e.g. https://rt.example.com)')
  else {
    const u = parseUrl(v)
    if (!u || !/^https?:$/.test(u.protocol)) error('REALTIME_PUBLIC_URL must be a valid http(s) URL')
    else if (u.protocol !== 'https:') warn('REALTIME_PUBLIC_URL is not https:// — mixed content will block it when the app is served over HTTPS')
    else ok(`REALTIME_PUBLIC_URL → ${u.origin} (browser Socket.IO endpoint)`)
  }
}
{
  const v = process.env.REALTIME_SECRET
  if (!isSet(v)) error('REALTIME_SECRET is not set — must match the realtime service exactly (generate: openssl rand -hex 24)')
  else if (v.length < 24) error(`REALTIME_SECRET is too short (${v.length} chars — minimum 24)`)
  else ok(`REALTIME_SECRET is set (${v.length} chars — value not shown)`)
}
{
  const v = process.env.REALTIME_ALLOWED_ORIGIN
  if (!isSet(v)) error('REALTIME_ALLOWED_ORIGIN is not set (realtime service side) — the web app public origin, comma-separated for multiple')
  else if (v.includes('*')) error('REALTIME_ALLOWED_ORIGIN must NOT use wildcards in production')
  else {
    const parts = v.split(',').map((s) => s.trim()).filter(Boolean)
    const bad = parts.filter((p) => {
      const u = parseUrl(p)
      return !u || !/^https?:$/.test(u.protocol) || !u.hostname
    })
    if (bad.length) error(`REALTIME_ALLOWED_ORIGIN contains invalid origin(s): ${bad.join(', ')}`)
    else ok(`REALTIME_ALLOWED_ORIGIN → ${parts.join(', ')}`)
  }
}

// ---- Forbidden development settings ----
let forbiddenClean = true
if (isSet(process.env.NEXT_PUBLIC_DEMO_LOGIN)) {
  error('NEXT_PUBLIC_DEMO_LOGIN is SET — demo quick-login must never be enabled in production (it is inlined into the client bundle at build time)')
  forbiddenClean = false
}
if (process.env.QUERY_LOG === '1') {
  error('QUERY_LOG=1 — query logging leaks row data into logs; never enable in production')
  forbiddenClean = false
}
if (isSet(process.env.ALLOW_PROD_SEED)) {
  error('ALLOW_PROD_SEED is SET — the development seed (known demo passwords) must never run against production')
  forbiddenClean = false
}
if (forbiddenClean) {
  ok('no forbidden development settings (NEXT_PUBLIC_DEMO_LOGIN / QUERY_LOG / ALLOW_PROD_SEED)')
}

// ---- Optional switches ----
{
  const v = process.env.MIGRATE_ON_START
  if (!isSet(v)) ok('MIGRATE_ON_START unset (default true — entrypoint runs prisma migrate deploy; single-replica recommended)')
  else if (v === 'true') ok('MIGRATE_ON_START=true (single replica: migrations apply at startup)')
  else if (v === 'false') ok('MIGRATE_ON_START=false (multi-replica: run migrations as an explicit deploy step)')
  else error(`MIGRATE_ON_START must be true|false (got an unrecognized value)`)
}
{
  const v = process.env.APP_URL
  if (!isSet(v)) ok('APP_URL unset (reset links use the request origin)')
  else {
    const u = parseUrl(v)
    if (!u || !/^https?:$/.test(u.protocol)) error('APP_URL must be a valid http(s) URL')
    else if (u.protocol !== 'https:' && IS_PROD) warn('APP_URL is not https:// in a production context')
    else ok(`APP_URL → ${u.origin}`)
  }
}

// ---- SMTP (optional group) ----
{
  const host = process.env.SMTP_HOST
  if (!isSet(host)) {
    warn('SMTP_HOST is not set — password-reset email stays dormant (requests accepted, nothing sent, loud server log)')
  } else {
    const port = process.env.SMTP_PORT || '587'
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      error(`SMTP_PORT must be an integer 1–65535 (got an invalid value)`)
    } else ok(`SMTP → ${host}:${port}`)
    const from = process.env.SMTP_FROM
    if (isSet(from) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) error('SMTP_FROM must be a valid email address')
    const user = isSet(process.env.SMTP_USER)
    const pass = isSet(process.env.SMTP_PASSWORD)
    if (user !== pass) error('SMTP_USER and SMTP_PASSWORD must be set together (currently exactly one is set)')
    else if (user) ok('SMTP credentials set (values not shown)')
    else warn('SMTP_USER/SMTP_PASSWORD unset — the server may reject relayed mail')
  }
}

// ------------------------------------------------------------------ report --
const errors = results.filter((r) => r.state === 'error')
const warns = results.filter((r) => r.state === 'warn')
const oks = results.filter((r) => r.state === 'ok')

const icon = { ok: '  ✓ ', warn: '  ⚠ ', error: '  ✗ ' }
const color = { ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' }
const reset = '\x1b[0m'
const tty = process.stdout.isTTY

console.log('\nNPL MIS Portal — production preflight')
console.log('  (validates the production environment contract; secret values are never printed)\n')
for (const r of results) {
  console.log(`${tty ? color[r.state] : ''}${icon[r.state]}${r.line}${tty ? reset : ''}`)
}
console.log('')
console.log(`  ${oks.length} passed · ${warns.length} warning(s) · ${errors.length} error(s)`)

if (envFile && errors.length === 0) {
  console.log(`  (values loaded from ${envFileExplicit ? 'the explicit env file' : 'env file'}: ${envFile}${envFileExplicit ? '' : '; real environment variables take precedence'})`)
}

if (errors.length > 0) {
  console.log('\n  PREFLIGHT FAILED — fix the ✗ items above (see .env.example and docs/coolify-deployment.md)\n')
  process.exit(1)
}
console.log('\n  PREFLIGHT PASSED\n')
