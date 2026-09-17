import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route, requirePermission, clientIp, clientAgent, ApiError } from '@/lib/api'
import { userUpdateSchema } from '@/lib/validation'
import { hashPassword } from '@/lib/auth'
import { writeAudit } from '@/lib/services/audit'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const actor = await requirePermission('users:manage')
  const { id } = await ctx.params
  const input = userUpdateSchema.parse(await req.json())

  const target = await db.user.findUnique({ where: { id } })
  if (!target) throw new ApiError(404, 'User not found.')

  // guard: cannot deactivate or demote yourself
  if (target.id === actor.id) {
    if (input.active === false) throw new ApiError(400, 'You cannot deactivate your own account.')
    if (input.role && input.role !== 'ADMIN') throw new ApiError(400, 'You cannot demote your own admin role.')
  }
  // guard: at least one active ADMIN must remain
  if ((input.active === false || (input.role && input.role !== 'ADMIN')) && target.role === 'ADMIN' && target.active) {
    const activeAdmins = await db.user.count({ where: { role: 'ADMIN', active: true, NOT: { id: target.id } } })
    if (activeAdmins === 0) throw new ApiError(400, 'At least one active administrator is required.')
  }

  const data: Record<string, unknown> = {}
  if (input.name != null) data.name = input.name.trim()
  if (input.role != null) data.role = input.role
  if (input.active != null) data.active = input.active
  if (input.password) data.passwordHash = await hashPassword(input.password)

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
  })

  await writeAudit([{
    userId: actor.id, userName: actor.name, action: 'USER_UPDATE', entity: 'USER', entityId: id,
    oldValue: JSON.stringify({ role: target.role, active: target.active, name: target.name }),
    newValue: JSON.stringify({ role: updated.role, active: updated.active, name: updated.name }) + (input.password ? ' • password reset' : ''),
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }])
  return NextResponse.json({ user: updated })
})
