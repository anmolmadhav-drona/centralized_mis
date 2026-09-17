import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent } from '@/lib/api'
import { syncAllDelivery } from '@/lib/services/delivery'

/** Recompute the live delivery status of every active record (ADMIN/MANAGER). */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('records:edit')
  const result = await syncAllDelivery(user)
  return NextResponse.json(result)
})
