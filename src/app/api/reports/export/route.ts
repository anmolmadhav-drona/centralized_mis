import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { db, rawQuery } from '@/lib/db'
import { route, requirePermission } from '@/lib/api'
import { normalizeMeasurement } from '@/lib/services/measurement'

const HEADER_FILL = 'FF9FC5E8'
const HEADER_TEXT = 'FF240B55'
const BORDER = 'FFD9D9D9'

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge = { style: 'thin' as const, color: { argb: BORDER } }
  return { top: edge, left: edge, bottom: edge, right: edge }
}

// Aggregates (MIN/MAX/SUM/COUNT) can return BigInt from raw SQL — normalize
// safely. Mirrors the helpers in /api/reports so both endpoints agree.
function isoDate(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const n = Number(v)
  if (Number.isFinite(n) && n > 946684800000) return new Date(n).toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}
function epochOf(v: unknown): number | null {
  if (v == null) return null
  if (v instanceof Date) return v.getTime()
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface PendingRow {
  party: string
  destination: string
  lrNo: number
  qty: number
  measurement: string
  lines: number
  lrDate: string | null
  expected: string | null
  status: string
  pod: string
  ageDays: number
}

// Quantity is measurement-aware: rows are only aggregated within the same
// normalized measurement, and every quantity is shown alongside its unit.
// (See src/lib/services/measurement.ts — no fuzzy unit merging.)

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
    { header: 'Measurement', key: 'measurement', width: 16 },
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
  })
  ws.getRow(1).height = 36

  // Data rows
  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.party
    row.getCell(2).value = rec.destination
    row.getCell(3).value = rec.lrNo
    row.getCell(4).value = rec.qty
    row.getCell(5).value = rec.measurement
    row.getCell(6).value = rec.lines
    row.getCell(7).value = rec.lrDate ?? null
    row.getCell(8).value = rec.expected ?? null
    row.getCell(9).value = rec.status
    row.getCell(10).value = rec.ageDays
    row.getCell(7).numFmt = 'mm-dd-yy'
    row.getCell(8).numFmt = 'mm-dd-yy'
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(4).alignment = { horizontal: 'right' }
    row.getCell(10).alignment = { horizontal: 'right' }
    for (let c = 1; c <= 10; c++) row.getCell(c).font = { size: 10 }
    if (ri % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FC' } }
      })
    }
    row.eachCell((c) => { c.border = thinBorder() })
    row.height = 16
  })

  // autofilter
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 2 + rows.length, column: 10 },
    }
  }
}

function buildDestinationSheet(
  wb: ExcelJS.Workbook,
  rows: { destination: string; measurement: string; count: number; qty: number; buckets: number }[]
): void {
  const ws = wb.addWorksheet('Destination-wise', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Destination', key: 'destination', width: 30 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Measurement', key: 'measurement', width: 16 },
    { header: 'Buckets', key: 'buckets', width: 10, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.destination
    row.getCell(2).value = rec.count
    row.getCell(3).value = rec.qty
    row.getCell(4).value = rec.measurement
    row.getCell(5).value = rec.buckets
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(5).alignment = { horizontal: 'right' }
    for (let c = 1; c <= 5; c++) row.getCell(c).font = { size: 10 }
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
      to: { row: 2 + rows.length, column: 5 },
    }
  }
}

function buildVendorRouteSheet(
  wb: ExcelJS.Workbook,
  rows: { vendor: string; route: string; measurement: string; count: number; qty: number }[]
): void {
  const ws = wb.addWorksheet('Vendor-Route', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Vendor', key: 'vendor', width: 28 },
    { header: 'Route', key: 'route', width: 14 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Measurement', key: 'measurement', width: 16 },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.vendor
    row.getCell(2).value = rec.route
    row.getCell(3).value = rec.count
    row.getCell(4).value = rec.qty
    row.getCell(5).value = rec.measurement
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(4).alignment = { horizontal: 'right' }
    for (let c = 1; c <= 5; c++) row.getCell(c).font = { size: 10 }
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
      to: { row: 2 + rows.length, column: 5 },
    }
  }
}

function buildPartySheet(
  wb: ExcelJS.Workbook,
  rows: { party: string; measurement: string; count: number; qty: number }[]
): void {
  const ws = wb.addWorksheet('Party-wise', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Party Name', key: 'party', width: 34 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Measurement', key: 'measurement', width: 16 },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.party
    row.getCell(2).value = rec.count
    row.getCell(3).value = rec.qty
    row.getCell(4).value = rec.measurement
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    for (let c = 1; c <= 4; c++) row.getCell(c).font = { size: 10 }
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

function buildMaterialSheet(
  wb: ExcelJS.Workbook,
  rows: { material: string; measurement: string; count: number; qty: number; buckets: number }[]
): void {
  const ws = wb.addWorksheet('Material-wise', {
    views: [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activeCell: 'A3' }],
  })
  ws.columns = [
    { header: 'Material', key: 'material', width: 34 },
    { header: 'Records', key: 'count', width: 12, style: { alignment: { horizontal: 'right' } } },
    { header: 'Quantity', key: 'qty', width: 16, style: { alignment: { horizontal: 'right' } } },
    { header: 'Measurement', key: 'measurement', width: 16 },
    { header: 'Buckets', key: 'buckets', width: 10, style: { alignment: { horizontal: 'right' } } },
  ]

  // Header row
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = thinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  ws.getRow(1).height = 36

  rows.forEach((rec, ri) => {
    const row = ws.getRow(2 + ri)
    row.getCell(1).value = rec.material
    row.getCell(2).value = rec.count
    row.getCell(3).value = rec.qty
    row.getCell(4).value = rec.measurement
    row.getCell(5).value = rec.buckets
    row.getCell(2).alignment = { horizontal: 'right' }
    row.getCell(3).alignment = { horizontal: 'right' }
    row.getCell(5).alignment = { horizontal: 'right' }
    for (let c = 1; c <= 5; c++) row.getCell(c).font = { size: 10 }
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
      to: { row: 2 + rows.length, column: 5 },
    }
  }
}

// ----- main export builder -----

export const GET = route(async () => {
  await requirePermission('reports:view')

  // Reuse the exact same query logic as /api/reports (all five datasets),
  // measurement-aware: quantities are only summed within the same normalized
  // measurement, never across different units.
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
      const raw = await rawQuery<
        Array<{
          partyName: string | null
          destination: string | null
          lrNo: number | null
          measurement: string | null
          qty: number | bigint | null
          count: number | bigint
          lrDate: unknown
          expectedDeliveryDate: unknown
          deliveryStatus: string | null
          podStatus: string | null
        }>
      >(
        `SELECT "partyName", "destination", "lrNo", "measurement",
                SUM("totalQuantity") as qty, COUNT(*) as count,
                MIN("lrDate") as lrDate, MIN("expectedDeliveryDate") as expectedDeliveryDate,
                MAX("deliveryStatus") as deliveryStatus, MAX("podStatus") as podStatus
         FROM "MisRecord"
         WHERE "deletedAt" IS NULL AND "deliveryStatus" IN ('Pending', 'In transit')
         GROUP BY "partyName", "destination", "lrNo", "measurement"
         ORDER BY "partyName" ASC, "destination" ASC, "lrNo" ASC`
      )
      type Acc = {
        party: string; destination: string; lrNo: number; measurement: string
        qty: number; lines: number; lrEpoch: number | null; expEpoch: number | null
        status: string; pod: string
      }
      const acc = new Map<string, Acc>()
      for (const r of raw) {
        const measurement = normalizeMeasurement(r.measurement)
        const key = `${r.partyName ?? ''}\u0000${r.destination ?? ''}\u0000${r.lrNo ?? 0}\u0000${measurement}`
        const lrEpoch = epochOf(r.lrDate)
        const expEpoch = epochOf(r.expectedDeliveryDate)
        const cur = acc.get(key)
        if (!cur) {
          acc.set(key, {
            party: r.partyName ?? '',
            destination: r.destination ?? '',
            lrNo: r.lrNo ?? 0,
            measurement,
            qty: Number(r.qty ?? 0),
            lines: Number(r.count ?? 0),
            lrEpoch,
            expEpoch,
            status: r.deliveryStatus ?? '',
            pod: r.podStatus ?? '',
          })
        } else {
          cur.qty += Number(r.qty ?? 0)
          cur.lines += Number(r.count ?? 0)
          if (lrEpoch != null && (cur.lrEpoch == null || lrEpoch < cur.lrEpoch)) cur.lrEpoch = lrEpoch
          if (expEpoch != null && (cur.expEpoch == null || expEpoch < cur.expEpoch)) cur.expEpoch = expEpoch
          if ((r.deliveryStatus ?? '') > cur.status) cur.status = r.deliveryStatus ?? ''
          if ((r.podStatus ?? '') > cur.pod) cur.pod = r.podStatus ?? ''
        }
      }
      return [...acc.values()].map((v) => ({
        party: v.party,
        destination: v.destination,
        lrNo: v.lrNo,
        qty: v.qty,
        measurement: v.measurement,
        lines: v.lines,
        lrDate: isoDate(v.lrEpoch),
        expected: isoDate(v.expEpoch),
        status: v.status,
        pod: v.pod,
        ageDays: v.lrEpoch ? Math.max(0, Math.floor((Date.now() - v.lrEpoch) / 86400000)) : 0,
      }))
    })(),
    // destination
    (async () => {
      const raw = await db.misRecord.groupBy({
        by: ['destination', 'measurement'],
        where: { ...notDeleted, destination: { not: null } },
        _count: true,
        _sum: { totalQuantity: true, bucket: true },
      })
      const acc = new Map<string, { destination: string; measurement: string; count: number; qty: number; buckets: number }>()
      for (const r of raw) {
        const measurement = normalizeMeasurement(r.measurement)
        const key = `${r.destination ?? ''}\u0000${measurement}`
        const cur = acc.get(key) ?? { destination: r.destination ?? '', measurement, count: 0, qty: 0, buckets: 0 }
        cur.count += r._count
        cur.qty += r._sum.totalQuantity ?? 0
        cur.buckets += r._sum.bucket ?? 0
        acc.set(key, cur)
      }
      return [...acc.values()].sort((a, b) => b.qty - a.qty)
    })(),
    // vendor
    (async () => {
      const raw = await db.misRecord.groupBy({
        by: ['vendorName', 'routeCode2', 'measurement'],
        where: { ...notDeleted, vendorName: { not: null } },
        _count: true,
        _sum: { totalQuantity: true },
      })
      const acc = new Map<string, { vendor: string; route: string; measurement: string; count: number; qty: number }>()
      for (const r of raw) {
        const measurement = normalizeMeasurement(r.measurement)
        const vendor = r.vendorName ?? ''
        const routeVal = r.routeCode2 ?? '—'
        const key = `${vendor}\u0000${routeVal}\u0000${measurement}`
        const cur = acc.get(key) ?? { vendor, route: routeVal, measurement, count: 0, qty: 0 }
        cur.count += r._count
        cur.qty += r._sum.totalQuantity ?? 0
        acc.set(key, cur)
      }
      return [...acc.values()].sort((a, b) => b.qty - a.qty)
    })(),
    // party
    (async () => {
      const raw = await db.misRecord.groupBy({
        by: ['partyName', 'measurement'],
        where: { ...notDeleted, partyName: { not: null } },
        _count: true,
        _sum: { totalQuantity: true },
      })
      const acc = new Map<string, { party: string; measurement: string; count: number; qty: number }>()
      for (const r of raw) {
        const measurement = normalizeMeasurement(r.measurement)
        const party = r.partyName ?? ''
        const key = `${party}\u0000${measurement}`
        const cur = acc.get(key) ?? { party, measurement, count: 0, qty: 0 }
        cur.count += r._count
        cur.qty += r._sum.totalQuantity ?? 0
        acc.set(key, cur)
      }
      return [...acc.values()].sort((a, b) => b.qty - a.qty)
    })(),
    // material
    (async () => {
      const raw = await db.misRecord.groupBy({
        by: ['materialDetails', 'measurement'],
        where: { ...notDeleted, materialDetails: { not: null } },
        _count: true,
        _sum: { totalQuantity: true, bucket: true },
      })
      const acc = new Map<string, { material: string; measurement: string; count: number; qty: number; buckets: number }>()
      for (const r of raw) {
        const measurement = normalizeMeasurement(r.measurement)
        const material = r.materialDetails ?? ''
        const key = `${material}\u0000${measurement}`
        const cur = acc.get(key) ?? { material, measurement, count: 0, qty: 0, buckets: 0 }
        cur.count += r._count
        cur.qty += r._sum.totalQuantity ?? 0
        cur.buckets += r._sum.bucket ?? 0
        acc.set(key, cur)
      }
      return [...acc.values()].sort((a, b) => b.qty - a.qty)
    })(),
  ])

  const wb = new ExcelJS.Workbook()
  wb.creator = 'NPL MIS Portal'
  wb.created = new Date()

  // Build all 5 sheets
  buildPendingSheet(wb, pendingRows)
  buildDestinationSheet(wb, destRows)
  buildVendorRouteSheet(wb, vendorRows)
  buildPartySheet(wb, partyRows)
  buildMaterialSheet(wb, materialRows)

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
