// Delivery tracking service — derives the LIVE delivery status of every MIS
// row from the shipment data already stored on the record (POD status,
// actual delivery date, dispatch date/vehicle, raw Excel status, remarks),
// and keeps trackingId / lastStatusUpdate in sync — automatically, on every
// create/update/import. No duplicate shipment table: the MIS record IS the
// shipment (LR = Lorry Receipt = the consignment/tracking document).
import { db } from '@/lib/db'
import { emitRealtime } from '@/lib/services/realtime'
import { writeAudit } from '@/lib/services/audit'
import type { SessionUser } from '@/lib/types'

export const LIVE_STATUSES = ['Pending', 'In Transit', 'Delivered', 'Failed / Undelivered', 'Returned', 'Cancelled'] as const
export type LiveStatus = (typeof LIVE_STATUSES)[number]

export interface DeliverySignals {
  deliveryStatus?: string | null
  podStatus?: string | null
  actualDeliveryDate?: Date | null
  dispatchDate?: Date | null
  dispatchVehicle?: string | null
}

export interface ResolvedDelivery {
  status: LiveStatus
  detail: string
  /** why the status was chosen — shown in the cell tooltip */
  reason: string
}

/**
 * Canonical delivery-status derivation. Priority:
 *   refusal → Failed / Undelivered
 *   return   → Returned
 *   cancelled→ Cancelled
 *   delivered evidence (raw "Delivered" | POD "Received" | actual delivery date) → Delivered
 *   dispatch evidence (raw "In transit"/"Handover to NPL" | POD "Received By NPL"/"WH" | dispatch date/vehicle) → In Transit
 *   otherwise → Pending
 */
export function resolveLiveStatus(rec: DeliverySignals): ResolvedDelivery {
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

  if (refusal) return { status: 'Failed / Undelivered', detail: raw || pod || 'Delivery refused', reason: 'Refusal recorded in shipment status/POD' }
  if (returned) return { status: 'Returned', detail: raw || pod, reason: 'Return recorded in shipment status/POD' }
  if (cancelled) return { status: 'Cancelled', detail: raw || pod, reason: 'Cancellation recorded in shipment status' }
  if (delivered) {
    return {
      status: 'Delivered',
      detail: raw || pod,
      reason: rec.actualDeliveryDate != null ? 'Actual delivery date is recorded' : 'POD marked Received',
    }
  }
  if (inTransit) {
    return {
      status: 'In Transit',
      detail: raw || pod || 'Dispatched',
      reason: rec.dispatchDate != null || (rec.dispatchVehicle ?? '').trim() !== '' ? 'Dispatch date/vehicle recorded' : raw || pod,
    }
  }
  return { status: 'Pending', detail: raw || 'Awaiting dispatch', reason: 'No delivery, POD or dispatch evidence yet' }
}

/** Does this set of changed keys affect the derived delivery status? */
export const DELIVERY_SIGNAL_KEYS = new Set([
  'deliveryStatus', 'podStatus', 'actualDeliveryDate', 'dispatchDate', 'dispatchVehicle', 'lrNo', 'trackingId',
])
export function touchesDeliverySignals(changedKeys: Iterable<string>): boolean {
  for (const k of changedKeys) if (DELIVERY_SIGNAL_KEYS.has(k)) return true
  return false
}

/** Core columns the system derives on every write (delivery auto-sync). A file
 *  that omits them (null) must NOT count as a change — they are re-derived
 *  during apply, so the import diff/classification skips null values for these
 *  keys. An explicit non-null value from the file still counts as an edit. */
export const DERIVED_FIELD_KEYS = new Set(['liveStatus', 'trackingId', 'lastStatusUpdate'])

export interface DeliveryPatch {
  liveStatus: LiveStatus
  trackingId: string | null
  lastStatusUpdate: Date
}

/**
 * Compute the delivery fields for a record. trackingId is only auto-filled
 * (LR-<lrNo>) when the user has not set a custom one — never overwritten.
 */
export function computeDeliveryPatch(
  rec: DeliverySignals & { lrNo?: number | null; trackingId?: string | null; liveStatus?: string | null; lastStatusUpdate?: Date | null },
  now = new Date()
): DeliveryPatch {
  const { status } = resolveLiveStatus(rec)
  const trackingId = (rec.trackingId ?? '').trim() !== '' ? rec.trackingId!.trim() : rec.lrNo != null ? `LR-${rec.lrNo}` : null
  const changed = (rec.liveStatus ?? '') !== status
  return { liveStatus: status, trackingId, lastStatusUpdate: changed || !rec.lastStatusUpdate ? now : now }
}

/** Bulk recompute for every active record (manual "Sync now" + post-import). */
export async function syncAllDelivery(user?: SessionUser | null): Promise<{ updated: number; byStatus: Record<string, number> }> {
  const records = await db.misRecord.findMany({
    where: { deletedAt: null },
    select: {
      id: true, deliveryStatus: true, podStatus: true, actualDeliveryDate: true,
      dispatchDate: true, dispatchVehicle: true, lrNo: true, liveStatus: true, trackingId: true, lastStatusUpdate: true,
    },
  })
  const now = new Date()
  let updated = 0
  const byStatus: Record<string, number> = {}
  for (const rec of records) {
    const patch = computeDeliveryPatch(rec, now)
    byStatus[patch.liveStatus] = (byStatus[patch.liveStatus] || 0) + 1
    if (rec.liveStatus !== patch.liveStatus || rec.trackingId !== patch.trackingId || rec.lastStatusUpdate == null) {
      await db.misRecord.update({ where: { id: rec.id }, data: patch })
      updated++
    }
  }
  if (updated > 0) {
    await emitRealtime({
      type: 'delivery_synced', count: updated, by: user?.name ?? 'system', source: 'API',
      detail: `${updated} delivery statuses refreshed`,
    })
    if (user) {
      await writeAudit([{
        userId: user.id, userName: user.name, action: 'DELIVERY_SYNC', entity: 'RECORD',
        newValue: `${updated} records re-derived (${Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(', ')})`,
        source: 'PORTAL',
      }])
    }
  }
  return { updated, byStatus }
}

/** Live status counts for the quick-filter tabs. */
export async function deliverySummary(): Promise<{ total: number; byStatus: Array<{ status: string; count: number }> }> {
  const groups = await db.misRecord.groupBy({ by: ['liveStatus'], where: { deletedAt: null }, _count: { _all: true } })
  const byKey = new Map(groups.map((g) => [g.liveStatus ?? '(pending)', Number(g._count._all)]))
  const total = [...byKey.values()].reduce((s, n) => s + n, 0)
  const byStatus = LIVE_STATUSES.map((status) => ({ status, count: byKey.get(status) ?? 0 }))
  const uncategorized = byKey.get('(pending)') ?? 0
  if (uncategorized > 0) byStatus.push({ status: 'Pending', count: (byKey.get('Pending') ?? 0) + uncategorized })
  return { total, byStatus }
}

/** Lookup the live delivery status of one shipment by tracking ID or record ID. */
export async function lookupDelivery(query: { recordId?: string; trackingId?: string }) {
  const where = query.recordId
    ? { id: query.recordId, deletedAt: null }
    : query.trackingId
      ? { OR: [{ trackingId: query.trackingId }, { lrNo: Number(String(query.trackingId).replace(/^LR-/i, '')) || -1 }], deletedAt: null }
      : null
  if (!where) return null
  const rec = await db.misRecord.findFirst({
    where,
    select: {
      id: true, version: true, lrNo: true, partyName: true, destination: true,
      deliveryStatus: true, podStatus: true, liveStatus: true, trackingId: true,
      lastStatusUpdate: true, actualDeliveryDate: true, expectedDeliveryDate: true,
      dispatchDate: true, updatedAt: true, updatedBy: true,
    },
  })
  if (!rec) return null
  const resolved = resolveLiveStatus(rec)
  return {
    recordId: rec.id,
    trackingId: rec.trackingId,
    lrNo: rec.lrNo,
    party: rec.partyName,
    destination: rec.destination,
    liveStatus: rec.liveStatus ?? resolved.status,
    rawStatus: rec.deliveryStatus,
    podStatus: rec.podStatus,
    reason: resolved.reason,
    lastStatusUpdate: rec.lastStatusUpdate?.toISOString() ?? null,
    deliveryDate: rec.actualDeliveryDate?.toISOString().slice(0, 10) ?? null,
    expectedDeliveryDate: rec.expectedDeliveryDate?.toISOString().slice(0, 10) ?? null,
    dispatchDate: rec.dispatchDate?.toISOString().slice(0, 10) ?? null,
    updatedAt: rec.updatedAt.toISOString(),
    updatedBy: rec.updatedBy,
  }
}
