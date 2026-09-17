import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent } from '@/lib/api'
import { listQuerySchema } from '@/lib/validation'
import { listRecords } from '@/lib/services/records-query'
import { createRecord } from '@/lib/services/records-mutations'
import { recordCreateSchema } from '@/lib/validation'
import { stripRestrictedFields, stripRestrictedFieldsFromRows, assertQueryModelAllowed } from '@/lib/table-access'

export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission('records:view')
  const url = new URL(req.url)
  const q = listQuerySchema.parse({
    start: url.searchParams.get('start') ?? 0,
    end: url.searchParams.get('end') ?? 100,
    search: url.searchParams.get('search') || undefined,
    filterModel: url.searchParams.get('filter')
      ? JSON.parse(url.searchParams.get('filter') as string)
      : undefined,
    sortModel: url.searchParams.get('sort')
      ? JSON.parse(url.searchParams.get('sort') as string)
      : undefined,
  })
  // restricted tables (Vehicle Rate, Loading Charges) — filtering/sorting on
  // a hidden column is a value oracle → 403 for roles that may not see them
  assertQueryModelAllowed(q.filterModel as Record<string, unknown> | undefined, q.sortModel, user.role)
  const { rows, total } = await listRecords({
    start: q.start,
    end: q.end,
    search: q.search,
    filterModel: q.filterModel as never,
    sortModel: q.sortModel,
  })
  // restricted tables (Vehicle Rate, Loading Charges) — values never leave
  // the server for roles that cannot see them
  stripRestrictedFieldsFromRows(rows, user.role)
  return NextResponse.json({ rows, total })
})

export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('records:create')
  const body = recordCreateSchema.parse(await req.json())
  const record = await createRecord(body.values, user, {
    source: 'PORTAL', ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  }, body.formulas)
  stripRestrictedFields(record, user.role)
  return NextResponse.json({ record }, { status: 201 })
})
