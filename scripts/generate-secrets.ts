#!/usr/bin/env bun
/**
 * Generate cryptographically secure secrets for the NPL MIS Portal.
 *
 *   bun scripts/generate-secrets.ts            → print all three secrets
 *   bun scripts/generate-secrets.ts auth       → AUTH_SECRET only (base64, 32 bytes)
 *   bun scripts/generate-secrets.ts realtime   → REALTIME_SECRET only (hex, 24 bytes)
 *   bun scripts/generate-secrets.ts admin      → admin initial password (base64, 18 bytes)
 *
 * Uses node:crypto randomBytes — cryptographically secure. Values are printed
 * to stdout only (never logged anywhere else). Copy them straight into your
 * environment store (.env locally, Coolify environment variables in
 * production) and close the terminal afterwards.
 *
 * Rotation notes:
 *   • AUTH_SECRET — rotating invalidates every signed session (all users
 *     sign in again). Safe, but announce it.
 *   • REALTIME_SECRET — must be changed on BOTH the web app and the realtime
 *     service (identical value), ideally in the same deployment window.
 */
import { randomBytes } from 'node:crypto'

const what = process.argv[2] || 'all'

function emit(label: string, value: string, hint: string) {
  console.log(`${label}=${value}`)
  console.log(`# ${hint}`)
  console.log()
}

if (what === 'auth' || what === 'all') {
  emit('AUTH_SECRET', randomBytes(32).toString('base64'), 'Web app — signs JWT session cookies (openssl-equivalent: openssl rand -base64 32)')
}
if (what === 'realtime' || what === 'all') {
  emit('REALTIME_SECRET', randomBytes(24).toString('hex'), 'Web app AND realtime service — identical value on both (openssl-equivalent: openssl rand -hex 24)')
}
if (what === 'admin' || what === 'all') {
  emit('ADMIN_INITIAL_PASSWORD', randomBytes(18).toString('base64'), 'First administrator password for scripts/create-admin.mjs — store securely, not recoverable')
}
if (!['auth', 'realtime', 'admin', 'all'].includes(what)) {
  console.error(`unknown argument "${what}" — use: auth | realtime | admin | all`)
  process.exit(1)
}
