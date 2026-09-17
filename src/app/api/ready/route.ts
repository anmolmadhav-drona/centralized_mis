// Readiness probe — the application AND its database are reachable.
// Returns 503 when the database is unavailable. Never exposes connection
// strings, stack traces, or environment details.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, database: 'up' })
  } catch {
    return NextResponse.json({ ok: false, database: 'down' }, { status: 503 })
  }
}
