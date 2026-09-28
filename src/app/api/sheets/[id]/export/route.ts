import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission } from '@/lib/api'
import { buildSheetWorkbook } from '@/lib/services/sheet-export'

type Ctx = { params: Promise<{ id: string }> }

// Export one in-app sheet's records as an .xlsx, generated from its column
// metadata. GET download (anchor-friendly). NPL uses /api/export instead.
export const GET = route<Ctx>(async (_req: NextRequest, ctx: Ctx) => {
  await requirePermission('excel:export')
  const { id } = await ctx.params
  const { buffer, fileName } = await buildSheetWorkbook(id)
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'content-length': String(buffer.byteLength),
      'x-file-name': fileName,
    },
  })
})
