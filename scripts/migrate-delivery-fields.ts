// Additive migration: register the delivery-tracking fields in the MIS field
// registry (liveStatus, trackingId, lastStatusUpdate) slotted after the
// deliveryStatus block, without touching existing data.
// Also back-fills liveStatus/trackingId/lastStatusUpdate for all existing
// records using the same delivery-derivation rules the runtime uses.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const LIVE_STATUS_OPTIONS = JSON.stringify([
  'Pending', 'In Transit', 'Delivered', 'Failed / Undelivered', 'Returned', 'Cancelled',
])

interface Rec {
  id: string
  deliveryStatus: string | null
  podStatus: string | null
  actualDeliveryDate: Date | null
  dispatchDate: Date | null
  dispatchVehicle: string | null
  lrNo: number | null
  liveStatus: string | null
  trackingId: string | null
}

/** Canonical delivery status derivation (kept in sync with src/lib/services/delivery.ts) */
export function resolveLiveStatus(rec: {
  deliveryStatus?: string | null
  podStatus?: string | null
  actualDeliveryDate?: Date | null
  dispatchDate?: Date | null
  dispatchVehicle?: string | null
}): { status: string; detail: string } {
  const raw = (rec.deliveryStatus ?? '').trim()
  const pod = (rec.podStatus ?? '').trim()
  const refusal = /refus/i.test(raw) || /refus/i.test(pod)
  const returned = /^return/i.test(raw) || /^return/i.test(pod)
  const cancelled = /^cancel/i.test(raw) || /^cancel/i.test(pod)
  const delivered = /^delivered$/i.test(raw) || /^received$/i.test(pod) || rec.actualDeliveryDate != null
  const inTransit =
    /^in transit$/i.test(raw) ||
    /^handover to npl$/i.test(raw) ||
    /^received by npl$/i.test(pod) ||
    /^wh$/i.test(pod) ||
    rec.dispatchDate != null ||
    (rec.dispatchVehicle ?? '').trim() !== ''

  if (refusal) return { status: 'Failed / Undelivered', detail: raw || pod || 'Delivery refused' }
  if (returned) return { status: 'Returned', detail: raw || pod }
  if (cancelled) return { status: 'Cancelled', detail: raw || pod }
  if (delivered) return { status: 'Delivered', detail: rec.actualDeliveryDate ? 'Delivery date recorded' : raw || pod }
  if (inTransit) return { status: 'In Transit', detail: raw || pod || 'Dispatched' }
  return { status: 'Pending', detail: raw || 'Awaiting dispatch' }
}

async function main() {
  const existing = await db.misField.findMany({
    where: { fieldKey: { in: ['liveStatus', 'trackingId', 'lastStatusUpdate'] } },
    select: { fieldKey: true },
  })
  const have = new Set(existing.map((f) => f.fieldKey))

  const anchor = await db.misField.findUnique({ where: { fieldKey: 'deliveryStatus' } })
  if (!anchor) throw new Error('deliveryStatus field not found in registry')
  const insertAt = anchor.position + 1

  if (!have.has('liveStatus')) {
    // shift positions of everything after the anchor
    await db.misField.updateMany({ where: { position: { gte: insertAt } }, data: { position: { increment: 3 } } })
    await db.misField.create({
      data: {
        fieldKey: 'liveStatus',
        fieldName: 'LIVE DELIVERY STATUS',
        displayName: 'Delivery Status (Live)',
        dataType: 'DROPDOWN',
        options: LIVE_STATUS_OPTIONS,
        position: insertAt,
        isCore: true,
        width: 22,
      },
    })
    await db.misField.create({
      data: {
        fieldKey: 'trackingId',
        fieldName: 'TRACKING / SHIPMENT ID',
        displayName: 'Tracking / Shipment ID',
        dataType: 'TEXT',
        position: insertAt + 1,
        isCore: true,
        width: 22,
      },
    })
    await db.misField.create({
      data: {
        fieldKey: 'lastStatusUpdate',
        fieldName: 'LAST STATUS UPDATE',
        displayName: 'Last Status Update',
        dataType: 'DATETIME',
        position: insertAt + 2,
        isCore: true,
        width: 20,
      },
    })
    console.log('registry: added liveStatus, trackingId, lastStatusUpdate after deliveryStatus')
  } else {
    console.log('registry: delivery fields already present — skipping')
  }

  // ---- back-fill delivery fields on existing records ----
  const records = await db.misRecord.findMany({
    where: { deletedAt: null },
    select: {
      id: true, deliveryStatus: true, podStatus: true, actualDeliveryDate: true,
      dispatchDate: true, dispatchVehicle: true, lrNo: true, liveStatus: true, trackingId: true,
    },
  })
  const now = new Date()
  let updated = 0
  for (const rec of records as Rec[]) {
    const { status } = resolveLiveStatus(rec)
    const trackingId = rec.trackingId ?? (rec.lrNo != null ? `LR-${rec.lrNo}` : null)
    if (rec.liveStatus !== status || rec.trackingId !== trackingId || true) {
      await db.misRecord.update({
        where: { id: rec.id },
        data: { liveStatus: status, trackingId, lastStatusUpdate: now },
      })
      updated++
    }
  }
  const byStatus: Record<string, number> = {}
  for (const rec of records as Rec[]) {
    const { status } = resolveLiveStatus(rec)
    byStatus[status] = (byStatus[status] || 0) + 1
  }
  console.log(`records: ${updated}/${records.length} delivery fields synced`)
  console.log('status distribution:', JSON.stringify(byStatus))
  await db.$disconnect()
}

main()
