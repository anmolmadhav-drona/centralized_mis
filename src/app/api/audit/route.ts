import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route, requirePermission } from '@/lib/api'
import { auditQuerySchema } from '@/lib/validation'
import type { Prisma } from '@prisma/client'

export const GET = route(async (req: NextRequest) => {
  await requirePermission('audit:view')
  const url = new URL(req.url)
  const q = auditQuerySchema.parse({
    page: url.searchParams.get('page') ?? 1,
    pageSize: url.searchParams.get('pageSize') ?? 25,
    action: url.searchParams.get('action') || undefined,
    entity: url.searchParams.get('entity') || undefined,
    userId: url.searchParams.get('userId') || undefined,
    search: url.searchParams.get('search') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
  })

  const where: Prisma.AuditLogWhereInput = {}
  if (q.action) where.action = q.action
  if (q.entity) where.entity = q.entity
  if (q.userId) where.userId = q.userId
  if (q.from || q.to) {
    where.createdAt = {}
    if (q.from) where.createdAt.gte = new Date(q.from)
    if (q.to) where.createdAt.lte = new Date(q.to)
  }
  if (q.search) {
    const s = q.search
    where.OR = [
      { userName: { contains: s } },
      { fieldName: { contains: s } },
      { oldValue: { contains: s } },
      { newValue: { contains: s } },
      { entityId: { contains: s } },
    ]
  }

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.auditLog.count({ where }),
  ])

  return NextResponse.json({
    logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  })
})
