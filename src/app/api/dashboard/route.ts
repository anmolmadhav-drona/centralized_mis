import { NextRequest, NextResponse } from 'next/server'
import { db, rawQuery } from '@/lib/db'
import { route, requirePermission } from '@/lib/api'
import type { DashboardData } from '@/lib/types'
import { getFields } from '@/lib/services/fields'
import { normalizeStatus } from '@/lib/services/status-normalizer'

export const GET = route(async (_req: NextRequest) => {
  await requirePermission('dashboard:view')
  const notDeleted = { deletedAt: null }

  // IST day/month boundaries (the operating timezone of the business)
  const now = new Date()
  const istOffsetMs = 5.5 * 3600 * 1000
  const istNow = new Date(now.getTime() + istOffsetMs)
  const istDayStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs)
  const istMonthStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - istOffsetMs)

  const [
    totalRecords, qtyAgg, loadGroups, statusGroups, podGroups,
    todayEntries, monthEntries, vendorGroups,
    onTimeRow, trendRows, pendingRows, fields,
  ] = await Promise.all([
    db.misRecord.count({ where: notDeleted }),
    db.misRecord.aggregate({ where: notDeleted, _sum: { totalQuantityLtrs: true, bucket: true } }),
    db.misRecord.groupBy({ by: ['loadType'], where: notDeleted, _count: true }),
    db.misRecord.groupBy({ by: ['deliveryStatus'], where: notDeleted, _count: true, _sum: { totalQuantityLtrs: true } }),
    db.misRecord.groupBy({ by: ['podStatus'], where: notDeleted, _count: true }),
    db.misRecord.count({ where: { ...notDeleted, createdAt: { gte: istDayStart } } }),
    db.misRecord.count({ where: { ...notDeleted, createdAt: { gte: istMonthStart } } }),
    db.misRecord.groupBy({ by: ['vendorName'], where: { ...notDeleted, vendorName: { not: null } }, _count: true, _sum: { totalQuantityLtrs: true } }),
    // column-to-column comparison — portable SQL
    rawQuery<{ ontime: number; delayed: number }[]>(
      `SELECT
        SUM(CASE WHEN "actualDeliveryDate" IS NOT NULL AND "expectedDeliveryDate" IS NOT NULL AND "actualDeliveryDate" <= "expectedDeliveryDate" THEN 1 ELSE 0 END) as ontime,
        SUM(CASE WHEN "actualDeliveryDate" IS NOT NULL AND "expectedDeliveryDate" IS NOT NULL AND "actualDeliveryDate" > "expectedDeliveryDate" THEN 1 ELSE 0 END) as delayed
       FROM "MisRecord" WHERE "deletedAt" IS NULL`
    ),
    // last 45 days of LR activity (windowed — cheap at any scale)
    rawQuery<{ d: Date; qty: number; c: number }[]>(
      `SELECT "lrDate" as d, SUM("totalQuantityLtrs") as qty, COUNT(*) as c
       FROM "MisRecord"
       WHERE "deletedAt" IS NULL AND "lrDate" IS NOT NULL AND "lrDate" >= ?
       GROUP BY "lrDate" ORDER BY "lrDate" ASC`,
      new Date(now.getTime() - 45 * 86400 * 1000)
    ),
    // pending / in-transit detail (broad LOWER match to catch casing variants)
    rawQuery<{ partyName: string; destination: string; lrNo: number; qty: number; lrDate: Date; expectedDeliveryDate: Date | null }[]>(
      `SELECT "partyName", "destination", "lrNo", "totalQuantityLtrs" as qty, "lrDate", "expectedDeliveryDate"
       FROM "MisRecord"
       WHERE "deletedAt" IS NULL AND LOWER(TRIM(COALESCE("deliveryStatus", ''))) IN ('pending', 'in transit')
       ORDER BY "lrDate" ASC`
    ),
    // fetch canonical delivery status options to drive normalisation
    getFields(),
  ])

  // top destinations
  const destGroups = await db.misRecord.groupBy({
    by: ['destination'], where: { ...notDeleted, destination: { not: null } },
    _count: true, _sum: { totalQuantityLtrs: true },
  })

  // Canonical options for deliveryStatus from the field registry
  const dsField = fields.find((f) => f.fieldKey === 'deliveryStatus')
  const canonicals = dsField?.options ?? []

  // Fold all raw deliveryStatus groups into canonicalized buckets so that
  // "DELIVERED", "Delievered", etc. all count toward "Delivered".
  const canonMap = new Map<string, { count: number; qty: number }>()
  for (const g of statusGroups) {
    const raw = g.deliveryStatus ?? '(blank)'
    const canon = raw === '(blank)'
      ? '(blank)'
      : (canonicals.length > 0 ? normalizeStatus(raw, canonicals) : raw)
    const existing = canonMap.get(canon) ?? { count: 0, qty: 0 }
    canonMap.set(canon, {
      count: existing.count + g._count,
      qty: existing.qty + Number(g._sum.totalQuantityLtrs ?? 0),
    })
  }

  const ftl = loadGroups.find((g) => g.loadType === 'FTL')
  const ptl = loadGroups.find((g) => g.loadType === 'PTL')
  const podReceived = podGroups
    .filter((g) => g.podStatus === 'Received' || g.podStatus === 'Received By NPL')
    .reduce((s, g) => s + g._count, 0)

  // Case-insensitive lookup so dashboard counts work regardless of how
  // Delivery Status is stored: "Delivered", "DELIVERED", "delivered", etc.
  const getStatusEntry = (status: string) => {
    const target = status.trim().toLowerCase()

    for (const [key, value] of canonMap.entries()) {
      if (key.trim().toLowerCase() === target) {
        return value
      }
    }

    return { count: 0, qty: 0 }
  }

  const deliveredEntry = getStatusEntry('Delivered')
  const pendingEntry = getStatusEntry('Pending')
  const inTransitEntry = getStatusEntry('In Transit')

  const data: DashboardData = {
    totalRecords,
    totalQuantityLtrs: Number(qtyAgg._sum.totalQuantityLtrs ?? 0),
    totalBuckets: Number(qtyAgg._sum.bucket ?? 0),
    deliveredCount: deliveredEntry.count,
    deliveredQty: deliveredEntry.qty,
    pendingCount: pendingEntry.count,
    pendingQty: pendingEntry.qty,
    inTransitCount: inTransitEntry.count,
    ftlCount: ftl?._count ?? 0,
    ptlCount: ptl?._count ?? 0,
    todayEntries,
    monthEntries,
    podReceivedCount: podReceived,
    onTimeCount: Number(onTimeRow[0]?.ontime ?? 0),
    delayedCount: Number(onTimeRow[0]?.delayed ?? 0),
    undeliveredCount: totalRecords - deliveredEntry.count,
    statusBreakdown: [...canonMap.entries()]
      .map(([status, { count, qty }]) => ({ status, count, qty }))
      .sort((a, b) => b.count - a.count),
    podBreakdown: podGroups
      .map((g) => ({ status: g.podStatus ?? '(blank)', count: g._count }))
      .sort((a, b) => b.count - a.count),
    dailyTrend: trendRows.map((r) => ({
      date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
      qty: Number(r.qty ?? 0),
      count: Number(r.c ?? 0),
    })),
    topDestinations: destGroups
      .map((g) => ({ destination: g.destination ?? '(blank)', qty: Number(g._sum.totalQuantityLtrs ?? 0), count: g._count }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10),
    vendorBreakdown: vendorGroups
      .map((g) => ({ vendor: g.vendorName ?? '(blank)', qty: Number(g._sum.totalQuantityLtrs ?? 0), count: g._count }))
      .sort((a, b) => b.qty - a.qty),
    pendingByParty: pendingRows.map((r) => ({
      party: r.partyName ?? '',
      destination: r.destination ?? '',
      lrNo: r.lrNo ?? 0,
      qty: Number(r.qty ?? 0),
      ageDays: r.lrDate ? Math.max(0, Math.floor((Date.now() - new Date(r.lrDate).getTime()) / 86400000)) : 0,
      expected: r.expectedDeliveryDate ? new Date(r.expectedDeliveryDate).toISOString().slice(0, 10) : null,
    })),
  }

  return NextResponse.json(data)
})
