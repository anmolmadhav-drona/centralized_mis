import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent } from '@/lib/api'
import { bulkUpdateSchema } from '@/lib/validation'
import { bulkUpdateRecords } from '@/lib/services/records-mutations'
import { stripRestrictedFields } from '@/lib/table-access'

/** Batch cell saves (paste / fill-down / spreadsheet recalculation) — each
 *  record keeps its own optimistic-version guard; per-item results. */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('records:edit')
  const body = bulkUpdateSchema.parse(await req.json())
  const results = await bulkUpdateRecords(body.changes, user, {
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  })
  // restricted tables (Vehicle Rate, Loading Charges) — strip values from any
  // returned records for roles that may not see them
  for (const r of results) {
    if (r.record) stripRestrictedFields(r.record, user.role)
    if (r.conflict) stripRestrictedFields(r.conflict, user.role)
  }
  const ok = results.filter((r) => r.ok).length
  const conflicts = results.filter((r) => r.conflict).length
  return NextResponse.json({ results, ok, conflicts })
})
