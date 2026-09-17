import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent, ApiError } from '@/lib/api'
import { recordUpdateSchema } from '@/lib/validation'
import { updateRecord, deleteRecord, VersionConflictError } from '@/lib/services/records-mutations'
import { getRecordDto } from '@/lib/services/records-query'
import { stripRestrictedFields } from '@/lib/table-access'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('records:view')
  const { id } = await ctx.params
  const record = await getRecordDto(id)
  if (!record) throw new ApiError(404, 'Record not found.')
  stripRestrictedFields(record, user.role)
  return NextResponse.json({ record })
})

export const PATCH = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('records:edit')
  const { id } = await ctx.params
  const body = recordUpdateSchema.parse(await req.json())
  try {
    const record = await updateRecord(id, body.version, body.values, user, {
      source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
    }, body.formulas)
    stripRestrictedFields(record, user.role)
    return NextResponse.json({ record })
  } catch (err) {
    if (err instanceof VersionConflictError) {
      // Optimistic concurrency conflict — return the current DB state so the
      // UI can present a side-by-side resolution dialog.
      if (err.current) stripRestrictedFields(err.current, user.role)
      return NextResponse.json(
        {
          error: 'This record was modified by another user while you were editing it.',
          code: 'VERSION_CONFLICT',
          current: err.current,
        },
        { status: 409 }
      )
    }
    throw err
  }
})

export const DELETE = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('records:delete')
  const { id } = await ctx.params
  await deleteRecord(id, user, {
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  })
  return NextResponse.json({ ok: true })
})
