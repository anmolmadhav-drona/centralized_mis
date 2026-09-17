import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route, requirePermission, clientIp, clientAgent, ApiError } from '@/lib/api'
import { fieldUpdateSchema } from '@/lib/validation'
import { invalidateFieldCache, mapFieldRow } from '@/lib/services/fields'
import { writeAudit } from '@/lib/services/audit'
import { emitRealtime } from '@/lib/services/realtime'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('fields:manage')
  const { id } = await ctx.params
  const input = fieldUpdateSchema.parse(await req.json())

  const field = await db.misField.findUnique({ where: { id } })
  if (!field) throw new ApiError(404, 'Field not found.')
  if (field.isCore && input.required === false && ['partyName', 'destination', 'lrNo', 'lrDate'].includes(field.fieldKey)) {
    throw new ApiError(400, 'This core field must remain required — it is essential to the MIS.')
  }
  if (input.options && field.dataType !== 'DROPDOWN') {
    throw new ApiError(400, 'Options can only be set on dropdown fields.')
  }

  const updated = await db.misField.update({
    where: { id },
    data: {
      displayName: input.displayName ?? undefined,
      required: input.required ?? undefined,
      defaultValue: input.defaultValue === undefined ? undefined : (input.defaultValue || null),
      options: input.options ? JSON.stringify(input.options) : undefined,
      active: input.active ?? undefined,
      width: input.width ?? undefined,
    },
  })

  invalidateFieldCache()
  await writeAudit([{
    userId: user.id, userName: user.name, action: 'FIELD_UPDATE', entity: 'FIELD', entityId: id,
    fieldName: field.displayName,
    oldValue: JSON.stringify({ displayName: field.displayName, required: field.required, active: field.active }),
    newValue: JSON.stringify({ displayName: updated.displayName, required: updated.required, active: updated.active }),
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }])
  await emitRealtime({ type: 'field_changed', by: user.name, detail: `Column "${updated.displayName}" updated`, source: 'PORTAL' })

  return NextResponse.json({ field: mapFieldRow(updated) })
})

export const DELETE = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requirePermission('fields:manage')
  const { id } = await ctx.params

  const field = await db.misField.findUnique({ where: { id } })
  if (!field) throw new ApiError(404, 'Field not found.')
  if (field.isCore) {
    throw new ApiError(400, 'Core columns from the original MIS cannot be deleted. You can deactivate them instead.')
  }

  await db.misField.delete({ where: { id } }) // cascades to MisValue rows

  invalidateFieldCache()
  await writeAudit([{
    userId: user.id, userName: user.name, action: 'FIELD_DELETE', entity: 'FIELD', entityId: id,
    fieldName: field.displayName,
    oldValue: `${field.displayName} (${field.dataType})`,
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }])
  await emitRealtime({ type: 'field_changed', by: user.name, detail: `Column "${field.displayName}" removed`, source: 'PORTAL' })

  return NextResponse.json({ ok: true })
})
