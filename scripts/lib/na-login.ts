// Shared Auth.js credentials-login helper for DEVELOPMENT test scripts.
// (scripts/ is excluded from the production type-check and Docker image)
//
// Performs the standard NextAuth browser flow: GET /api/auth/csrf, then
// POST /api/auth/callback/credentials with the CSRF token — maintaining a
// cookie jar across both requests.
//
// Usage:
//   const cookie = await naLogin('http://localhost:3000', 'admin@npl.com', 'Admin@123')
//   if (!cookie) throw new Error('login failed')
//   fetch(url, { headers: { cookie } })
export async function naLogin(base: string, email: string, password: string): Promise<string | null> {
  const jar: string[] = []
  const cookieHeader = (): Record<string, string> => (jar.length ? { cookie: jar.join('; ') } : {})
  const absorb = (res: Response): void => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const kv = c.split(';')[0]
      const name = kv.split('=')[0]
      const i = jar.findIndex((x) => x.split('=')[0] === name)
      if (i >= 0) jar[i] = kv
      else jar.push(kv)
    }
  }

  const csrfRes = await fetch(base + '/api/auth/csrf', { headers: cookieHeader() })
  absorb(csrfRes)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }

  const res = await fetch(base + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base + '/' }),
    redirect: 'manual',
  })
  absorb(res)

  const token =
    jar.find((x) => x.startsWith('authjs.session-token=')) ||
    jar.find((x) => x.startsWith('__Secure-authjs.session-token='))
  return token ?? null
}
