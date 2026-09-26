import { NextRequest, NextResponse } from 'next/server'
import { db, rawQuery } from '@/lib/db'
import { route, requirePermission } from '@/lib/api'
import { normalizeMeasurement } from '@/lib/services/measurement'

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
    // Live recreation of the original Summary intent: outstanding deliveries
    // grouped by Party → Destination → LR No. Now measurement-aware: a single
    // LR that carries multiple measurements is split by normalized unit so
    // incompatible quantities are never summed together.
    const raw = await rawQuery<Array<{
      partyName: string | null; destination: string | null; lrNo: number | null
      measurement: string | null
      qty: number | bigint | null; count: number | bigint; lrDate: unknown
      expectedDeliveryDate: unknown; deliveryStatus: string | null; podStatus: string | null
    }>>(
      `SELECT "partyName", "destination", "lrNo", "measurement",
              SUM("totalQuantity") as qty, COUNT(*) as count,
              MIN("lrDate") as lrDate, MIN("expectedDeliveryDate") as expectedDeliveryDate,
              MAX("deliveryStatus") as deliveryStatus, MAX("podStatus") as podStatus
       FROM "MisRecord"
       WHERE "deletedAt" IS NULL AND "deliveryStatus" IN ('Pending', 'In transit')
       GROUP BY "partyName", "destination", "lrNo", "measurement"
       ORDER BY "partyName" ASC, "destination" ASC, "lrNo" ASC`
    )

    // Fold case/spacing variants of the measurement together (SQL GROUP BY is
    // case-sensitive; e.g. "ltr" and "LTR" arrive as separate groups).
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

    return NextResponse.json({
      type,
      rows: [...acc.values()].map((v) => ({
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
      })),
    })
  }

  if (type === 'destination') {
    const raw = await db.misRecord.groupBy({
      by: ['destination', 'measurement'], where: { ...notDeleted, destination: { not: null } },
      _count: true, _sum: { totalQuantity: true, bucket: true },
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
    return NextResponse.json({ type, rows: [...acc.values()].sort((a, b) => b.qty - a.qty) })
  }

  if (type === 'vendor') {
    const raw = await db.misRecord.groupBy({
      by: ['vendorName', 'routeCode2', 'measurement'], where: { ...notDeleted, vendorName: { not: null } },
      _count: true, _sum: { totalQuantity: true },
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
    return NextResponse.json({ type, rows: [...acc.values()].sort((a, b) => b.qty - a.qty) })
  }

  if (type === 'party') {
    const raw = await db.misRecord.groupBy({
      by: ['partyName', 'measurement'], where: { ...notDeleted, partyName: { not: null } },
      _count: true, _sum: { totalQuantity: true },
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
    return NextResponse.json({ type, rows: [...acc.values()].sort((a, b) => b.qty - a.qty) })
  }

  if (type === 'material') {
    const raw = await db.misRecord.groupBy({
      by: ['materialDetails', 'measurement'], where: { ...notDeleted, materialDetails: { not: null } },
      _count: true, _sum: { totalQuantity: true, bucket: true },
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
    return NextResponse.json({ type, rows: [...acc.values()].sort((a, b) => b.qty - a.qty) })
  }

  return NextResponse.json({ error: 'Unknown report type.' }, { status: 400 })
})
