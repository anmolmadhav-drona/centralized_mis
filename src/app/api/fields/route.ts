import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route, requirePermission, clientIp, clientAgent, ApiError } from '@/lib/api'
import { fieldCreateSchema } from '@/lib/validation'
import { getFields, getFieldsForRole, invalidateFieldCache, mapFieldRow } from '@/lib/services/fields'
import { writeAudit } from '@/lib/services/audit'
import { emitRealtime } from '@/lib/services/realtime'

export const GET = route(async (_req: NextRequest) => {
  const user = await requirePermission('fields:view')
  // restricted tables (Vehicle Rate, Loading Charges) are not part of the
  // schema USER/VIEWER may see — they vanish from grid, forms, filters,
  // column chooser and settings alike
  const fields = await getFieldsForRole(user.role, true)
  return NextResponse.json({ fields })
})

function slugify(name: string): string {
  // camelCase-ish machine key from the Excel header
  const words = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  if (words.length === 0) return 'field'
  return words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
    .slice(0, 40)
}

export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('fields:manage')
  const input = fieldCreateSchema.parse(await req.json())

  if (input.dataType === 'DROPDOWN' && (!input.options || input.options.length === 0)) {
    throw new ApiError(400, 'Dropdown fields need at least one option.')
  }

  // uniqueness of Excel header name + machine key
  const existing = await db.misField.findMany()
  const nameLower = input.fieldName.trim().toLowerCase()
  if (existing.some((f) => f.fieldName.toLowerCase() === nameLower)) {
    throw new ApiError(409, `A column named "${input.fieldName}" already exists.`)
  }
  let fieldKey = slugify(input.fieldName)
  while (existing.some((f) => f.fieldKey === fieldKey)) fieldKey = `${fieldKey}_2`

  const maxPos = existing.reduce((m, f) => Math.max(m, f.position), -1)

  const field = await db.misField.create({
    data: {
      fieldKey,
      fieldName: input.fieldName.trim(),
      displayName: input.displayName?.trim() || input.fieldName.trim(),
      dataType: input.dataType,
      required: input.required ?? false,
      defaultValue: input.defaultValue?.trim() || null,
      options: input.options ? JSON.stringify(input.options) : null,
      position: maxPos + 1,
      isCore: false,
      isSystem: false,
      active: true,
      width: input.width ?? 18,
      createdBy: user.name,
    },
  })

  invalidateFieldCache()
  await writeAudit([{
    userId: user.id, userName: user.name, action: 'FIELD_ADD', entity: 'FIELD', entityId: field.id,
    fieldName: field.displayName,
    newValue: `${field.displayName} (${field.dataType}${field.required ? ', required' : ''})`,
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }])
  await emitRealtime({ type: 'field_changed', by: user.name, detail: `Column "${field.displayName}" added`, source: 'PORTAL' })

  return NextResponse.json({ field: mapFieldRow(field) }, { status: 201 })
})
