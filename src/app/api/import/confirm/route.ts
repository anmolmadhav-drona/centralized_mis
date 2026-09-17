import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent } from '@/lib/api'
import { importConfirmSchema } from '@/lib/validation'
import { applyImport } from '@/lib/excel/import-apply'

export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('excel:import')
  const input = importConfirmSchema.parse(await req.json())
  const result = await applyImport(input, user, {
    ip: clientIp(req), userAgent: clientAgent(req), requestId: req.headers.get('x-request-id'),
  })
  return NextResponse.json({ result })
})
