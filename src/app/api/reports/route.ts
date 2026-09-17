import { NextRequest, NextResponse } from 'next/server'
import { db, rawQuery } from '@/lib/db'
import { route, requirePermission } from '@/lib/api'

export const GET = route(async (req: NextRequest) => {
  await requirePermission('reports:view')
  const type = new URL(req.url).searchParams.get('type') || 'pending'
  const notDeleted = { deletedAt: null }

  /** SQLite aggregates (MIN/MAX/SUM/COUNT) can return BigInt — normalize safely. */
  const isoDate = (v: unknown): string | null => {
    if (v == null) return null
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const n = Number(v)
    if (Number.isFinite(n) && n > 946684800000) return new Date(n).toISOString().slice(0, 10)
    return String(v).slice(0, 10)
  }
  const epochOf = (v: unknown): number | null => {
    if (v == null) return null
    if (v instanceof Date) return v.getTime()
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  if (type === 'pending') {
    // Live recreation of the original Summary intent: outstanding
    // deliveries grouped by Party → Destination → LR No.
    const rows = await rawQuery<Array<{
      partyName: string | null; destination: string | null; lrNo: number | null
      qty: number | bigint | null; count: number | bigint; lrDate: unknown
      expectedDeliveryDate: unknown; deliveryStatus: string | null; podStatus: string | null
    }>>(
      `SELECT "partyName", "destination", "lrNo", SUM("totalQuantityLtrs") as qty, COUNT(*) as count,
              MIN("lrDate") as lrDate, MIN("expectedDeliveryDate") as expectedDeliveryDate,
              MAX("deliveryStatus") as deliveryStatus, MAX("podStatus") as podStatus
       FROM "MisRecord"
       WHERE "deletedAt" IS NULL AND "deliveryStatus" IN ('Pending', 'In transit')
       GROUP BY "partyName", "destination", "lrNo"
       ORDER BY "partyName" ASC, "destination" ASC, "lrNo" ASC`
    )
    return NextResponse.json({
      type,
      rows: rows.map((r) => {
        const lrEpoch = epochOf(r.lrDate)
        return {
          party: r.partyName ?? '',
          destination: r.destination ?? '',
          lrNo: r.lrNo ?? 0,
          qty: Number(r.qty ?? 0),
          lines: Number(r.count ?? 0),
          lrDate: isoDate(r.lrDate),
          expected: isoDate(r.expectedDeliveryDate),
          status: r.deliveryStatus ?? '',
          pod: r.podStatus ?? '',
          ageDays: lrEpoch ? Math.max(0, Math.floor((Date.now() - lrEpoch) / 86400000)) : 0,
        }
      }),
    })
  }

  if (type === 'destination') {
    const rows = await db.misRecord.groupBy({
      by: ['destination'], where: { ...notDeleted, destination: { not: null } },
      _count: true, _sum: { totalQuantityLtrs: true, bucket: true },
    })
    return NextResponse.json({
      type,
      rows: rows
        .map((r) => ({
          destination: r.destination ?? '',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
          buckets: r._sum.bucket ?? 0,
        }))
        .sort((a, b) => b.qty - a.qty),
    })
  }

  if (type === 'vendor') {
    const rows = await db.misRecord.groupBy({
      by: ['vendorName', 'routeCode2'], where: { ...notDeleted, vendorName: { not: null } },
      _count: true, _sum: { totalQuantityLtrs: true },
    })
    return NextResponse.json({
      type,
      rows: rows
        .map((r) => ({
          vendor: r.vendorName ?? '',
          route: r.routeCode2 ?? '—',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
        }))
        .sort((a, b) => b.qty - a.qty),
    })
  }

  if (type === 'party') {
    const rows = await db.misRecord.groupBy({
      by: ['partyName'], where: { ...notDeleted, partyName: { not: null } },
      _count: true, _sum: { totalQuantityLtrs: true },
    })
    return NextResponse.json({
      type,
      rows: rows
        .map((r) => ({ party: r.partyName ?? '', count: r._count, qty: r._sum.totalQuantityLtrs ?? 0 }))
        .sort((a, b) => b.qty - a.qty),
    })
  }

  if (type === 'material') {
    const rows = await db.misRecord.groupBy({
      by: ['materialDetails'], where: { ...notDeleted, materialDetails: { not: null } },
      _count: true, _sum: { totalQuantityLtrs: true, bucket: true },
    })
    return NextResponse.json({
      type,
      rows: rows
        .map((r) => ({
          material: r.materialDetails ?? '',
          count: r._count,
          qty: r._sum.totalQuantityLtrs ?? 0,
          buckets: r._sum.bucket ?? 0,
        }))
        .sort((a, b) => b.qty - a.qty),
    })
  }

  return NextResponse.json({ error: 'Unknown report type.' }, { status: 400 })
})
