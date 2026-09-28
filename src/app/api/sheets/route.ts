import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission } from '@/lib/api'
import { sheetCreateSchema } from '@/lib/validation'
import { listSheets, createSheet } from '@/lib/services/sheets'

// List application sheets (NPL + created). Any signed-in role that can view
// records may see the sheet list (it drives navigation).
export const GET = route(async () => {
  await requirePermission('records:view')
  const sheets = await listSheets()
  return NextResponse.json({ sheets })
})

// Create a new application sheet — ADMIN-only (MANAGER/USER/VIEWER → 403).
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('sheets:create')
  const input = sheetCreateSchema.parse(await req.json())
  const sheet = await createSheet(input, user)
  return NextResponse.json({ sheet }, { status: 201 })
})
