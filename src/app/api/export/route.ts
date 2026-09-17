import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent } from '@/lib/api'
import { exportSchema } from '@/lib/validation'
import { getFieldsForRole } from '@/lib/services/fields'
import { buildExportWorkbook } from '@/lib/excel/export'
import { writeAudit } from '@/lib/services/audit'
import { db } from '@/lib/db'
import { assertQueryModelAllowed } from '@/lib/table-access'

export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('excel:export')
  const input = exportSchema.parse(await req.json())
  // restricted tables (Vehicle Rate, Loading Charges) are excluded from
  // exports for roles that may not see them — no columns, no values, and no
  // filtering/sorting on them either (value oracle)
  assertQueryModelAllowed(input.filterModel as Record<string, unknown> | undefined, input.sortModel, user.role)
  const fields = await getFieldsForRole(user.role)

  const buffer = await buildExportWorkbook({
    fields,
    search: input.search,
    filterModel: input.filterModel as never,
    sortModel: input.sortModel,
    includeSummary: input.includeSummary !== false,
  })

  // audit with the active filter description
  const activeFilters = Object.keys(input.filterModel || {}).length
  await writeAudit([{
    userId: user.id, userName: user.name, action: 'EXPORT', entity: 'EXPORT',
    newValue: `${buffer.byteLength} bytes • filters on ${activeFilters} column(s)${input.search ? ` • search "${input.search}"` : ''}`,
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }])

  // keep a light history of exports for the Import/Export screen
  await db.importJob.count() // touch to warm connection (cheap)

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const fileName = `MIS_Export_${stamp}.xlsx`

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'content-length': String(buffer.byteLength),
      'x-file-name': fileName,
    },
  })
})
