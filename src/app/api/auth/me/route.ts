import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { route } from '@/lib/api'

export const GET = route(async (_req: NextRequest) => {
  const user = await getSessionUser()
  return NextResponse.json({ user })
})
