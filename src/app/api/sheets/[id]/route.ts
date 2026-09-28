import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission } from '@/lib/api'
import { getSheetWithColumns } from '@/lib/services/sheets'

type Ctx = { params: Promise<{ id: string }> }

// Sheet meta + its column definitions — the generic runtime's source of truth.
export const GET = route<Ctx>(async (_req: NextRequest, ctx: Ctx) => {
  await requirePermission('records:view')
  const { id } = await ctx.params
  const result = await getSheetWithColumns(id)
  return NextResponse.json(result)
})
