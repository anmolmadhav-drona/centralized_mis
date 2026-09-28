import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission } from '@/lib/api'
import { sheetRecordUpdateSchema } from '@/lib/validation'
import { updateSheetRecord, deleteSheetRecord } from '@/lib/services/sheets'

type Ctx = { params: Promise<{ id: string; recordId: string }> }

// Update a record (optimistic concurrency via version).
export const PATCH = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('records:edit')
  const { id, recordId } = await ctx.params
  const body = sheetRecordUpdateSchema.parse(await req.json())
  const record = await updateSheetRecord(id, recordId, body.version, body.data, user)
  return NextResponse.json({ record })
})

// Soft-delete a record.
export const DELETE = route<Ctx>(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('records:delete')
  const { id, recordId } = await ctx.params
  await deleteSheetRecord(id, recordId, user)
  return NextResponse.json({ ok: true })
})
