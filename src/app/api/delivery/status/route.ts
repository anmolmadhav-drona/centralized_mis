import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, ApiError } from '@/lib/api'
import { deliverySummary, lookupDelivery } from '@/lib/services/delivery'

/**
 * Delivery-status API.
 *  GET /api/delivery/status?trackingId=LR-1359   → live status of a shipment
 *  GET /api/delivery/status?id=<recordId>        → same, by record id
 *  GET /api/delivery/status?mode=summary         → counts per status (quick tabs)
 */
export const GET = route(async (req: NextRequest) => {
  await requirePermission('records:view')
  const url = new URL(req.url)
  if (url.searchParams.get('mode') === 'summary') {
    const summary = await deliverySummary()
    return NextResponse.json(summary)
  }
  const trackingId = url.searchParams.get('trackingId') || undefined
  const recordId = url.searchParams.get('id') || undefined
  if (!trackingId && !recordId) {
    throw new ApiError(400, 'Provide ?trackingId=LR-… or ?id=<recordId> (or ?mode=summary).')
  }
  const delivery = await lookupDelivery({ trackingId, recordId })
  if (!delivery) throw new ApiError(404, 'No shipment found for this tracking / record ID.')
  return NextResponse.json({ delivery })
})
