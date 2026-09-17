// Public runtime configuration for the browser client. Keeps deploy-time
// settings (realtime endpoint) out of the build — Coolify injects env vars
// at runtime, and NEXT_PUBLIC_* inlining would freeze them into the image.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    // Public Socket.IO endpoint of the realtime service (browser-facing).
    // Null in local development → the client falls back to same-origin.
    realtimeUrl: process.env.REALTIME_PUBLIC_URL || null,
  })
}
