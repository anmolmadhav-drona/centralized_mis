// NPL MIS Portal — realtime notification service (Socket.IO)
//
// Production architecture (Coolify):
//   - This service runs as its OWN Coolify application, next to the web app.
//   - Socket.IO listens on REALTIME_PORT (default 3003) — exposed through the
//     Coolify proxy on the realtime domain.
//   - The internal admin endpoint listens on REALTIME_ADMIN_PORT (default
//     3004), bound to REALTIME_ADMIN_BIND (default 127.0.0.1). The Next.js
//     API layer POSTs events to /emit on that port, guarded by a shared
//     secret. NEVER expose the admin port publicly.
//
// Environment:
//   REALTIME_PORT           — public Socket.IO port            (default 3003)
//   REALTIME_ADMIN_PORT     — internal admin port              (default 3004)
//   REALTIME_ADMIN_BIND     — admin bind address               (default 127.0.0.1)
//   REALTIME_SECRET         — shared secret for /emit          (REQUIRED in production)
//   REALTIME_ALLOWED_ORIGIN — allowed CORS origin for Socket.IO (REQUIRED in production,
//                             e.g. https://mis.example.com; comma-separated for multiple)
import { createServer } from 'http'
import { Server } from 'socket.io'

const IS_PROD = process.env.NODE_ENV === 'production'

const IO_PORT = Number(process.env.REALTIME_PORT || 3003)
const ADMIN_PORT = Number(process.env.REALTIME_ADMIN_PORT || 3004)
const ADMIN_BIND = process.env.REALTIME_ADMIN_BIND || '127.0.0.1'
const SECRET = process.env.REALTIME_SECRET || ''
const ALLOWED_ORIGIN_RAW = process.env.REALTIME_ALLOWED_ORIGIN || ''

// ---- fail-closed configuration (no insecure development fallbacks) ----
if (IS_PROD && !SECRET) {
  console.error('[realtime] FATAL: REALTIME_SECRET is not set. Refusing to start in production without a shared secret.')
  process.exit(1)
}
if (IS_PROD && !ALLOWED_ORIGIN_RAW) {
  console.error('[realtime] FATAL: REALTIME_ALLOWED_ORIGIN is not set. Refusing to start in production with wildcard CORS.')
  process.exit(1)
}
if (!IS_PROD && !SECRET) {
  console.warn('[realtime] WARNING: REALTIME_SECRET not set — /emit requests will be rejected until it is set.')
}

// CORS: restricted to the configured web origin(s). Production REQUIRES the
// explicit allowlist (fail-closed above). Development reflects the request
// origin (sandbox preview origins are dynamic; connections arrive same-origin
// through the gateway).
const allowedOrigins = ALLOWED_ORIGIN_RAW
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const corsOrigin: string[] | boolean =
  allowedOrigins.length > 0 ? allowedOrigins : !IS_PROD ? true : false

// Max accepted /emit body (defense against accidental or hostile oversize posts)
const MAX_EMIT_BYTES = 64 * 1024

// ---------- Socket.IO (public port) ----------
const ioServer = createServer()
const io = new Server(ioServer, {
  // The sandbox gateway forwards on '/'; a dedicated realtime domain works
  // with the same root path. Do not change without updating the client hook.
  path: '/',
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
})

io.on('connection', (socket) => {
  socket.emit('hello', { ok: true, at: new Date().toISOString() })
})

ioServer.listen(IO_PORT, '0.0.0.0', () => {
  console.log(`[realtime] socket.io listening on 0.0.0.0:${IO_PORT} (origins: ${Array.isArray(corsOrigin) ? corsOrigin.join(', ') : '*'})`)
})

// ---------- internal admin endpoint (POST /emit, GET /health) ----------
const admin = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/emit') {
    // secret first — constant-shape rejection, no body read
    if (!SECRET || req.headers['x-rt-secret'] !== SECRET) {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    // content type must be JSON
    const ct = String(req.headers['content-type'] || '')
    if (!ct.toLowerCase().includes('application/json')) {
      res.writeHead(415, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unsupported media type' }))
      return
    }
    // bounded body
    let body = ''
    let oversized = false
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_EMIT_BYTES) {
        oversized = true
        req.destroy()
      }
    })
    req.on('end', () => {
      if (oversized) return // connection already destroyed
      try {
        const event = JSON.parse(body)
        if (event == null || typeof event !== 'object' || Array.isArray(event)) {
          throw new Error('not an object')
        }
        io.emit('mis-event', event)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid json' }))
      }
    })
    return
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }))
    return
  }
  res.writeHead(404)
  res.end()
})

admin.listen(ADMIN_PORT, ADMIN_BIND, () => {
  console.log(`[realtime] admin emit endpoint on ${ADMIN_BIND}:${ADMIN_PORT} (internal only)`)
})
