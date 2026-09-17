// Restore pristine records from the original workbook (keeps users, field
// registry incl. delivery fields; wipes records/values/formulas/import jobs).
import { PrismaClient } from '@prisma/client'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { computeRecordKeys } from '../src/lib/services/business-key'

/** Canonical delivery status derivation (same rules as services/delivery.ts) */
function resolveLiveStatus(rec: {
  deliveryStatus?: string | null
  podStatus?: string | null
  actualDeliveryDate?: Date | null
  dispatchDate?: Date | null
  dispatchVehicle?: string | null
}): string {
  const raw = (rec.deliveryStatus ?? '').trim()
  const pod = (rec.podStatus ?? '').trim()
  if (/refus/i.test(raw) || /refus/i.test(pod)) return 'Failed / Undelivered'
  if (/^return/i.test(raw) || /^return/i.test(pod)) return 'Returned'
  if (/^cancel/i.test(raw) || /^cancel/i.test(pod)) return 'Cancelled'
  if (/^delivered$/i.test(raw) || /^received$/i.test(pod) || rec.actualDeliveryDate != null) return 'Delivered'
  if (/^in transit$/i.test(raw) || /^handover to npl$/i.test(raw) || /^received by npl$/i.test(pod) || /^wh$/i.test(pod) || rec.dispatchDate != null || (rec.dispatchVehicle ?? '').trim() !== '') return 'In Transit'
  return 'Pending'
}

const db = new PrismaClient()
const XLSX_PATH = process.env.SEED_XLSX || join(import.meta.dir, '..', 'upload', 'Updated MIS NPL SONIPAT.xlsx')

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v ?? null)
function toISODate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

async function main() {
  await db.misFormula.deleteMany({})
  await db.misValue.deleteMany({})
  await db.misRecord.deleteMany({})
  await db.importJob.deleteMany({})
  await db.auditLog.deleteMany({})

  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true })
  const sheet = wb.Sheets['MIS']
  if (!sheet) throw new Error('MIS sheet not found')
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  const dataRows = rows.slice(2).filter((r) => r.some((c) => c !== null && c !== undefined && c !== ''))

  const get = (r: unknown[], i: number) => trim(r[i])
  const date = (r: unknown[], i: number) => {
    const v = r[i]
    if (v == null || v === '') return null
    if (v instanceof Date) return toISODate(v)
    return null
  }
  const int = (r: unknown[], i: number) => {
    const v = r[i]
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
  }

  const now = new Date()
  let count = 0
  for (const r of dataRows) {
    const base = {
      pickupLocation: get(r, 1) as string | null,
      partyName: get(r, 2) as string | null,
      destination: get(r, 3) as string | null,
      invoiceNumber: get(r, 4) != null ? String(get(r, 4)) : null,
      lrNo: int(r, 5),
      lrDate: date(r, 6),
      routeCode: get(r, 7) as string | null,
      materialDetails: get(r, 8) as string | null,
      transporterName: get(r, 9) as string | null,
      bucket: int(r, 10),
      totalQuantityLtrs: int(r, 11),
      loadType: get(r, 12) as string | null,
      expectedDeliveryDate: date(r, 13),
      actualDeliveryDate: date(r, 14),
      deliveryStatus: get(r, 15) as string | null,
      lrStatus: get(r, 16) as string | null,
      damage: get(r, 17) as string | null,
      loadingCharges: int(r, 18) != null ? Number(int(r, 18)) : null,
      unloadingCharges: int(r, 19) != null ? Number(int(r, 19)) : null,
      vehicleNumber: get(r, 20) as string | null,
      vehicleType: int(r, 21),
      ply: int(r, 22),
      remark: get(r, 23) as string | null,
      remarks1: get(r, 24) as string | null,
      dispatchDate: date(r, 25),
      dispatchVehicle: get(r, 26) as string | null,
      vendorName: get(r, 27) as string | null,
      routeCode2: get(r, 28) as string | null,
      podStatus: get(r, 29) as string | null,
      createdBy: 'seed',
      updatedBy: 'seed',
    }
    const { status } = resolveLiveStatus(base)
    // Business identity — same normalization as the import pipeline, so the
    // restored baseline participates in duplicate detection exactly like
    // seeded/imported data.
    const keys = computeRecordKeys({
      lrNo: base.lrNo,
      invoiceNumber: base.invoiceNumber,
      partyName: base.partyName,
      materialDetails: base.materialDetails,
      bucket: base.bucket,
      totalQuantityLtrs: base.totalQuantityLtrs,
    })
    await db.misRecord.create({
      data: {
        ...base,
        businessKey: keys.businessKey,
        lineKey: keys.lineKey,
        liveStatus: status,
        trackingId: base.lrNo != null ? `LR-${base.lrNo}` : null,
        lastStatusUpdate: now,
      },
    })
    count++
  }

  const active = await db.misRecord.findMany({ where: { deletedAt: null }, select: { totalQuantityLtrs: true } })
  const total = active.reduce((s, r) => s + (r.totalQuantityLtrs || 0), 0)
  console.log(`restored ${count} records, total qty = ${total}`)
  await db.$disconnect()
}

main()
