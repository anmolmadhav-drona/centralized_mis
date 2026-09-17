// Development-only: verify the realtime chain (app → /emit → Socket.IO client)
import { io } from 'socket.io-client'
import { naLogin } from './na-login'

const BASE = 'http://localhost:3000'
const COOKIE = await naLogin(BASE, 'admin@npl.com', 'Admin@123')
if (!COOKIE) { console.log('login failed'); process.exit(1) }

const received: unknown[] = []
const socket = io('http://localhost:3003', { path: '/', transports: ['websocket', 'polling'] })
await new Promise<void>((resolve) => socket.on('connect', resolve))
console.log('socket connected:', socket.id)
socket.on('mis-event', (e) => received.push(e))

setTimeout(() => {
  console.log('events received:', received.length)
  console.log(JSON.stringify(received.slice(0, 2)))
  socket.disconnect()
  process.exit(received.length > 0 ? 0 : 1)
}, 6000)

// trigger a business mutation → the app should emit a realtime event
const res = await fetch(BASE + '/api/records', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: COOKIE },
  body: JSON.stringify({ values: { partyName: 'RT Test Co', destination: 'SocketCity', lrNo: 980001, lrDate: '2026-09-16', bucket: 110, deliveryStatus: 'Pending' } }),
})
console.log('record create:', res.status)
