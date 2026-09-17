// API middleware — assigns a request/correlation ID to every API request.
//
// The ID is forwarded to the route handlers via the x-request-id request
// header, returned to the client on every response, used in server error
// logs ([api:<id>]) and recorded in audit-log metadata. If the trusted
// upstream proxy already provided an ID it is preserved.
import { NextResponse, type NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const existing = req.headers.get('x-request-id')
  const requestId = existing && existing.length <= 64 ? existing : crypto.randomUUID()

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('x-request-id', requestId)
  return res
}

export const config = {
  matcher: '/api/:path*',
}
