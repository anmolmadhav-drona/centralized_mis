import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route, requirePermission, clientIp, clientAgent, ApiError } from '@/lib/api'
import { userCreateSchema } from '@/lib/validation'
import { hashPassword } from '@/lib/auth'
import { writeAudit } from '@/lib/services/audit'

export const GET = route(async (_req: NextRequest) => {
  await requirePermission('users:view')
  const users = await db.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json({ users })
})

export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('users:manage')
  const input = userCreateSchema.parse(await req.json())

  const email = input.email.trim().toLowerCase()
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) throw new ApiError(409, 'A user with this email already exists.')

  const created = await db.user.create({
    data: {
      email,
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
  })

  await writeAudit([{
    userId: user.id, userName: user.name, action: 'USER_CREATE', entity: 'USER', entityId: created.id,
    newValue: `${created.email} — ${created.role}`,
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }])
  return NextResponse.json({ user: created }, { status: 201 })
})
