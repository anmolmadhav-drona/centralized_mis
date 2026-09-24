import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { route, requirePermission } from '@/lib/api'
import { isoDate, epochOf } from '@/lib/services/reports-query'
import { fmtNum, fmtDate, deliveryStatusTone } from '@/lib/client/format'

const HEADER_FILL = 'FF9FC5E8'
const HEADER_TEXT = 'FF240B55'
const BORDER = 'FFD9D9D9'

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge = { style: 'thin' as const, color: { argb: BORDER } }
  return { top: edge, left: edge, bottom: edge, right: edge }
}

interface PendingRow {
  party: string
  destination: string
  lrNo: number
  qty: number
  lines: number
  lrDate: string | null
  expected: string | null
  status: string
  pod: string
  ageDays: number
}

interface GroupRow {
  [k: string]: string | number
}

// ----- helpers to build each sheet -----

function buildPendingSheet(
  wb: ExcelJS.Workbook,
  rows: PendingRow[]
): void {
  const ws = wb.addWorksheet('Pending Deliveries', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Party Name', key: 'party', width: 30 },
    { header: 'Destination', key: 'destination', width: 25 },
    { header: 'LR No', key: 'lrNo', width: 14, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Lines', key: 'lines', width: 10 },
    { header: 'LR Date', key: 'lrDate', width: 14 },
    { header: 'Expected', key: 'expected', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Age', key: 'ageDays', width: 8, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row (row 1)
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  ws.getRow(1).height = 36

  // Data rows
  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.party
    row.getCell(2).value = rec.destination
    row.getCell(3).value = rec.lrNo
    row.getCell(4).value = rec.qty
    row.getCell(5).value = rec.lines
    row.getCell(6).value = rec.lrDate ?? null
    row.getCell(7).value = rec.expected ?? null
    row.getCell(8).value = rec.status
    row.getCell(9).value = rec.ageDays
    row.getCell(6).numFmt = 'mm-dd-yy'
    row.getCell(7).numFmt = 'mm-dd-yy'
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(4).alignment = { horizontal: 'right' }
    row.getCell(9).alignment = { horizontal: 'right' }
    row.getCell(1).font = { size: 10 }
    row.getCell(2).font = { size: 10 }
    row.getCell(3).font = { size: 10 }
    row.getCell(4).font = { size: 10 }
    row.getCell(5).font = { size: 10 }
    row.getCell(6).font = { size: 10 }
    row.getCell(7).font = { size: 10 }
    row.getCell(8).font = { size: 10 }
    row.getCell(9).font = { size: 10 }
    if (ri % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FC' } }
      })
    }
    row.eachCell((c) => { c.border = thinBorder() })
    row.height = 16
  }

  // autofilter
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 2 + rows.length, column: 9 },
    }
  }
}

function buildDestinationSheet(
  wb: ExcelJS.Workbook,
  rows: { destination: string; count: number; qty: number; buckets: number }[]
): void {
  const ws = wb.addWorksheet('Destination-wise', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Destination', key: 'destination', width: 30 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity (L)', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Buckets', key: 'buckets', width: 10, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.destination
    row.getCell(2).value = rec.count
    row.getCell(3).value = rec.qty
    row.getCell(4).value = rec.buckets
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(4).alignment = { horizontal: 'right' }
    row.getCell(1).font = { size: 10 }
    row.getCell(2).font = { size: 10 }
    row.getCell(3).font = { size: 10 }
    row.getCell(4).font = { size: 10 }
    if (ri % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FC' } }
      })
    }
    row.eachCell((c) => { c.border = thinBorder() })
    row.height = 16
  })

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 2 + rows.length, column: 4 },
    }
  }
}

function buildVendorRouteSheet(
  wb: ExcelJS.Workbook,
  rows: { vendor: string; route: string; count: number; qty: number }[]
): void {
  const ws = wb.addWorksheet('Vendor-Route', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Vendor', key: 'vendor', width: 28 },
    { header: 'Route', key: 'route', width: 14 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity (L)', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.vendor
    row.getCell(2).value = rec.route
    row.getCell(3).value = rec.count
    row.getCell(4).value = rec.qty
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(4).alignment = { horizontal: 'right' }
    row.getCell(1).font = { size: 10 }
    row.getCell(2).font = { size: 10 }
    row.getCell(3).font = { size: 10 }
    row.getCell(4).font = { size: 10 }
    if (ri % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FC' } }
      })
    }
    row.eachCell((c) => { c.border = thinBorder() })
    row.height = 16
  })

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 2 + rows.length, column: 4 },
    }
  }
}

function buildPartySheet(
  wb: ExcelJS.Workbook,
  rows: { party: string; count: number; qty: number }[]
): void {
  const ws = wb.addWorksheet('Party-wise', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Party Name', key: 'party', width: 34 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity (L)', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.party
    row.getCell(2).value = rec.count
    row.getCell(3).value = rec.qty
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(1).font = { size: 10 }
    row.getCell(2).font = { size: 10 }
    row.getCell(3).font = { size: 10 }
    if (ri % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FC' } }
      })
    }
    row.eachCell((c) => { c.border = thinBorder() })
    row.height = 16
  })

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 2 + rows.length, column: 3 },
    }
  }
}

function buildMaterialSheet(
  wb: ExcelJS.Workbook,
  rows: { material: string; count: number; qty: number; buckets: number }[]
): void {
  const ws = wb.addWorksheet('Material-wise', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Material', key: 'material', width: 34 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity (L)', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Buckets', key: 'buckets', width: 10, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.material
    row.getCell(2).value = rec.count
    row.getCell(3).value = rec.qty
    row.getCell(4).value = rec.buckets
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(4).alignment = { horizontal: 'right' }
    row.getCell(1).font = { size: 10 }
    row.getCell(2).font = { size: 10 }
    row.getCell(3).font = { size: 10 }
    row.getCell(4).font = { size: 10 }
    if (ri % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FC' } }
      })
    }
    row.eachCell((c) => { c.border = thinBorder() })
    row.height = 16
  })

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 2 + rows.length, column: 4 },
    }
  }
}

// ----- main export builder -----

export const GET = route(async (req: NextRequest) => {
  await requirePermission('reports:view')

  // Reuse the exact same query logic as /api/reports?type=...
  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'pending'

  const notDeleted = { deletedAt: null }

  // ----- fetch all 5 report types from the live DB -----
  const [
    pendingRows,
    destRows,
    vendorRows,
    partyRows,
    materialRows,
  ] = await Promise.all([
    // pending
    (async () => {
      const rows = await new Promise<
        Array<{
          partyName: string | null
          destination: string | null
          lrNo: number | null
          qty: number | bigint | null
          count: number | bigint
          lrDate: unknown
          expectedDeliveryDate: unknown
          deliveryStatus: string | null
          podStatus: string | null
        }>>(
          `SELECT "partyName", "destination", "lrNo", SUM("totalQuantityLtrs") as qty, COUNT(*) as count,
           MIN("lrDate") as lrDate, MIN("expectedDeliveryDate") as expectedDeliveryDate,
           MAX("deliveryStatus") as deliveryStatus, MAX("podStatus") as podStatus
           FROM "MisRecord" WHERE "deletedAt" IS NULL AND "deliveryStatus" IN ('Pending', 'In transit')
           GROUP BY "partyName", "destination", "lrNo"
           ORDER BY "partyName" ASC, "destination" ASC, "lrNo" ASC`
        )
        return rows.map((r: any) => ({
          party: r.partyName ?? '',
          destination: r.destination ?? '',
          lrNo: r.lrNo ?? 0,
          qty: Number(r.qty ?? 0),
          lines: Number(r.count ?? 0),
          lrDate: isoDate(r.lrDate),
          expected: isoDate(r.expectedDeliveryDate),
          status: r.deliveryStatus ?? '',
          pod: r.podStatus ?? '',
          ageDays: r.lrEpoch
            ? Math.max(0, Math.floor((Date.now() - isoDate(r.lrDate).slice(0, 10)?.endsWith('T00:00:00.000Z') ? isoDate(r.lrDate).slice(0, 10) : isoDate(r.lrDate)) / 86400000))
            : 0,
        }))
    })(),
    // destination
    (async () => {
      const rows = await db.misRecord.groupBy({
        by: ['destination'],
        where: { ...notDeleted, destination: { not: null } },
        _count: true,
        _sum: { totalQuantityLtrs: true, bucket: true },
      })
      return rows
        .map((r: any) => ({
          destination: r.destination ?? '',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
          buckets: r._sum.bucket ?? 0,
        }))
        .sort((a: any, b: any) => b.qty - a.qty)
    })(),
    // vendor
    (async () => {
      const rows = await db.misRecord.groupBy({
        by: ['vendorName', 'routeCode2'],
        where: { ...notDeleted, vendorName: { not: null } },
        _count: true,
        _sum: { totalQuantityLtrs: true },
      })
      return rows
        .map((r: any) => ({
          vendor: r.vendorName ?? '',
          route: r.routeCode2 ?? '—',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
        }))
        .sort((a: any, b: any) => b.qty - a.qty)
    })(),
    // party
    (async () => {
      const rows = await db.misRecord.groupBy({
        by: ['partyName'],
        where: { ...notDeleted, partyName: { not: null } },
        _count: true,
        _sum: { totalQuantityLtrs: true },
      })
      return rows
        .map((r: any) => ({
          party: r.partyName ?? '',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
        }))
        .sort((a: any, b: any) => b.qty - a.qty)
    })(),
    // material
    (async () => {
      const rows = await db.misRecord.groupBy({
        by: ['materialDetails'],
        where: { ...notDeleted, materialDetails: { not: null } },
        _count: true,
        _sum: { totalQuantityLtrs: true, bucket: true },
      })
      return rows
        .map((r: any) => ({
          material: r.materialDetails ?? '',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
          buckets: r._sum.bucket ?? 0,
        }))
        .sort((a: any, b: any) => b.qty - a.qty)
    })(),
  ])

  const wb = new ExcelJS.Workbook()
  wb.creator = 'NPL MIS Portal'
  wb.created = new Date()

  // Build all 5 sheets
  buildPendingSheet(wb, pendingRows as PendingRow[])
  buildDestinationSheet(wb, destRows as { destination: string; count: number; qty: number; buckets: number }[])
  buildVendorRouteSheet(wb, vendorRows as { vendor: string; route: string; count: number; qty: number }[])
  buildPartySheet(wb, partyRows as { party: string; count: number; qty: number }[])
  buildMaterialSheet(wb, materialRows as { material: string; count: number; qty: number; buckets: number }[])

  // Return as XLSX download
  const buffer = await wb.xlsx.writeBuffer()
  const fileName = 'Reports_and_Summaries.xlsx'

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'content-length': String(buffer.byteLength),
      'x-file-name': fileName,
    },
  })
})