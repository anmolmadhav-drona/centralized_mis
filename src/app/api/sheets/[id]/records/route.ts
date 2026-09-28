import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission } from '@/lib/api'
import { sheetRecordCreateSchema } from '@/lib/validation'
import { listSheetRecords, createSheetRecord } from '@/lib/services/sheets'

type Ctx = { params: Promise<{ id: string }> }

// List a sheet's records (generic runtime data).
export const GET = route<Ctx>(async (_req: NextRequest, ctx: Ctx) => {
  await requirePermission('records:view')
  const { id } = await ctx.params
  const records = await listSheetRecords(id)
  return NextResponse.json({ records })
})

// Create a record in a sheet.
export const POST = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('records:create')
  const { id } = await ctx.params
  const body = sheetRecordCreateSchema.parse(await req.json())
  const record = await createSheetRecord(id, body.data, user)
  return NextResponse.json({ record }, { status: 201 })
})
