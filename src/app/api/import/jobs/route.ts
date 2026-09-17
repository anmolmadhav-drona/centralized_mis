import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route, requirePermission } from '@/lib/api'

export const GET = route(async (_req: NextRequest) => {
  await requirePermission('excel:import')
  const jobs = await db.importJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, fileName: true, userName: true, status: true, stats: true,
      result: true, createdAt: true, confirmedAt: true,
    },
  })
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      ...j,
      stats: j.stats ? JSON.parse(j.stats) : null,
      result: j.result ? JSON.parse(j.result) : null,
    })),
  })
})
