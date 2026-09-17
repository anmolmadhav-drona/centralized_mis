// Liveness probe — process alive. No database, no secrets, no diagnostics.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true })
}
