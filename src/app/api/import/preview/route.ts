import { NextRequest, NextResponse } from 'next/server'
import { route, requirePermission, clientIp, clientAgent, ApiError, rateLimit } from '@/lib/api'
import { analyzeImportFile, MAX_UPLOAD_BYTES } from '@/lib/excel/import'

export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission('excel:import')
  rateLimit(`import:${user.id}`, 10, 60_000)

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    throw new ApiError(400, 'Expected a multipart file upload.')
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) {
    throw new ApiError(400, 'No file was uploaded. Choose an Excel file first.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'File is too large. Maximum upload size is 10 MB.')
  }
  const name = file.name.toLowerCase()
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    throw new ApiError(400, 'Only .xlsx Excel files are supported.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const preview = await analyzeImportFile(buffer, file.name, user)
  return NextResponse.json(preview)
})
