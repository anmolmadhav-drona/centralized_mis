// Next.js instrumentation hook — runs ONCE per server start (node runtime).
// Used for fail-fast environment validation before the first request.
// See src/lib/env.ts for the validation rules.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateServerEnv } = await import('./lib/env')
    validateServerEnv()
  }
}
