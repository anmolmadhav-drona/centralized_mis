// GET /api/records/suggest?field=partyName&q=ghu&limit=8
// Distinct-value autocomplete for the Add/Edit record dialog.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { route, requirePermission, rateLimit, ApiError } from '@/lib/api'
import { suggestValues, SUGGEST_LIMIT_DEFAULT, SUGGEST_LIMIT_MAX } from '@/lib/services/suggest'
import { tableVisibleTo, isRestrictedField } from '@/lib/table-access'

const suggestQuerySchema = z.object({
  field: z.string().min(1).max(64),
  q: z.string().max(100).optional().default(''),
  limit: z.coerce.number().int().min(1).max(SUGGEST_LIMIT_MAX).optional().default(SUGGEST_LIMIT_DEFAULT),
})

export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission('records:view')
  // autocomplete fires on every keystroke — keep it cheap but guard abuse
  rateLimit(`suggest:${user.id}`, 120, 60_000)

  const url = new URL(req.url)
  const q = suggestQuerySchema.parse({
    field: url.searchParams.get('field') ?? '',
    q: url.searchParams.get('q') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })

  // restricted tables (Vehicle Rate, Loading Charges, …) — no value
  // autocomplete for roles that may not see them
  if (isRestrictedField(q.field) && !tableVisibleTo(q.field, user.role)) {
    throw new ApiError(403, 'You do not have permission to access this data.')
  }

  const suggestions = await suggestValues(q.field, q.q, q.limit)
  return NextResponse.json({ suggestions })
})
