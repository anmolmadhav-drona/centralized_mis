/**
 * NPL MIS Portal — DEVELOPMENT-ONLY seed script (local development).
 *
 * ⚠ This script creates demo users with KNOWN passwords and imports the
 *   original sample workbook. It must NEVER run against a production
 *   database — production admin accounts are created with
 *   scripts/create-admin.mjs (environment-driven, no default passwords).
 *
 * - Creates 4 RBAC demo users (bcrypt hashed — upgraded to Argon2id on first login)
 * - Creates the MIS field registry (38 core fields: the 30 latest-workbook
 *   Excel columns + legacy workbook columns + the 3 delivery-tracking
 *   derived columns the delivery sync service maintains)
 * - Imports all 340 records from the original workbook (SheetJS, ALL rows
 *   including filter-hidden ones; strings trimmed; mixed-type invoices → text)
 *
 * DESTRUCTIVE by design (development reset): clears records, values, fields,
 * audit logs and import jobs before seeding. Users are upserted (idempotent).
 *
 * Run: bun run db:seed            (development only — refuses in production)
 */
import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import bcrypt from 'bcryptjs'
import { join } from 'node:path'
import { computeRecordKeys } from '../src/lib/services/business-key'
import { computeDeliveryPatch } from '../src/lib/services/delivery'

const db = new PrismaClient()

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'yes-i-know') {
  console.error('seed: refusing to run in production (demo users + sample data). Use scripts/create-admin.mjs instead.')
  process.exit(1)
}

// Sample workbook — path is RELATIVE to the repository root (portable).
// Override with SEED_XLSX when testing against a different workbook.
const XLSX_PATH = process.env.SEED_XLSX || join(import.meta.dir, '..', 'upload', 'Updated MIS NPL SONIPAT.xlsx')

// ------------------------------------------------------------------
// Field registry: [fieldKey, excelName, displayName, type, width, required, options]
// ------------------------------------------------------------------
const FIELDS: Array<{
  key: string
  name: string
  display: string
  type: string
  width: number
  required?: boolean
  options?: string[]
  default?: string // pre-filled in the Add Entry form (most common value in the MIS)
}> = [
  { key: 'srNo', name: 'SR. NO.', display: 'Sr. No.', type: 'INTEGER', width: 13.1, },
  { key: 'pickupLocation', name: 'PICKUP LOCATION', display: 'Pickup Location', type: 'TEXT', width: 21.9, default: 'Sonipat' },
  { key: 'partyName', name: 'PARTY NAME', display: 'Party Name', type: 'TEXT', width: 33.4, required: true },
  { key: 'destination', name: 'DESTINATION', display: 'Destination', type: 'TEXT', width: 23.9, required: true },
  { key: 'invoiceNumber', name: 'INVOICE NUMBER', display: 'Invoice Number', type: 'TEXT', width: 21.9 },
  { key: 'lrNo', name: 'LR. NO.', display: 'LR No.', type: 'INTEGER', width: 13.0, required: true },
  { key: 'lrDate', name: 'LR DATE', display: 'LR Date', type: 'DATE', width: 13.7, required: true },
  { key: 'routeCode', name: 'Route Code', display: 'Route Code (Legacy)', type: 'TEXT', width: 15.2 },
  { key: 'materialDetails', name: 'MATERIAL DETAILS', display: 'Material Details', type: 'TEXT', width: 37.4 },
  { key: 'transporterName', name: 'TRANSPOTER NAME', display: 'Transporter Name', type: 'TEXT', width: 23.8, default: 'Drona Logitech' },
  { key: 'bucket', name: 'Bucket', display: 'Bucket', type: 'INTEGER', width: 12.7 },
  { key: 'totalQuantityLtrs', name: 'TOTAL QUANTITY IN LTRS', display: 'Total Quantity (Ltrs)', type: 'INTEGER', width: 28.6 },
  { key: 'loadType', name: 'LOAD TYPE FTL/PTL', display: 'Load Type', type: 'TEXT', width: 22.9, default: 'PTL' },
  { key: 'expectedDeliveryDate', name: 'EXPECTED DELIVERY DATE', display: 'Expected Delivery Date', type: 'DATE', width: 29.1 },
  { key: 'actualDeliveryDate', name: 'ACTUAL DELIVERY DATE', display: 'Actual Delivery Date', type: 'DATE', width: 27.0 },
  {
    key: 'deliveryStatus', name: 'DELIVERY STATUS', display: 'Delivery Status', type: 'TEXT', width: 24,
    default: 'Pending', // new shipments start as Pending until dispatched
    options: ['Delivered', 'In Transit', 'Pending'],
  },
  // Delivery-tracking derived columns — the same definitions the one-time
  // migrate-delivery-fields.ts registered on the historical database. The
  // delivery sync service (src/lib/services/delivery.ts) maintains them on
  // every dispatch/POD change; values for seeded records are derived with
  // the identical runtime rules below.
  { key: 'trackingId', name: 'TRACKING / SHIPMENT ID', display: 'Tracking / Shipment ID', type: 'TEXT', width: 22 },
  { key: 'lastStatusUpdate', name: 'LAST STATUS UPDATE', display: 'Last Status Update', type: 'DATETIME', width: 20 },
  { key: 'lrStatus', name: 'LR STATUS', display: 'LR Status', type: 'TEXT', width: 18, default: 'To be Billed' },
  { key: 'damage', name: 'DAMAGE', display: 'Damage', type: 'TEXT', width: 14, default: 'No' },
  { key: 'loadingCharges', name: 'LOADING CHARGES', display: 'Loading Charges', type: 'DECIMAL', width: 18 },
  { key: 'unloadingCharges', name: 'UNLOADING CHARGES', display: 'Unloading Charges', type: 'DECIMAL', width: 20 },
  { key: 'vehicleNumber', name: 'VEHICLE NUMBER', display: 'Vehicle Number', type: 'TEXT', width: 20 },
  { key: 'vehicleType', name: 'VEHICLE TYPE', display: 'Vehicle Type', type: 'INTEGER', width: 16, default: '709' },
  { key: 'ply', name: 'PLY', display: 'Ply', type: 'INTEGER', width: 10, default: '0' },
  { key: 'remark', name: 'Remark', display: 'Remark', type: 'TEXT', width: 24 },
  { key: 'remarks1', name: 'Remarks 1', display: 'Remarks 1', type: 'TEXT', width: 24 },
  { key: 'dispatchDate', name: 'Dispatch Date', display: 'Dispatch Date', type: 'DATE', width: 18 },
  { key: 'dispatchFrom', name: 'DispatchFrom', display: 'Dispatch From', type: 'TEXT', width: 18 },
  { key: 'dispatchVehicle', name: 'Dispatch Vehicle', display: 'Dispatch Vehicle', type: 'TEXT', width: 22 },
  { key: 'vendorName', name: 'Vendor Name', display: 'Vendor Name', type: 'TEXT', width: 20 },
  { key: 'vehicleRate', name: 'Vehicle Rate', display: 'Vehicle Rate', type: 'DECIMAL', width: 16 },
  {
    key: 'podStatus', name: 'POD Status', display: 'POD Status', type: 'TEXT', width: 20,
    default: 'POD Pending',
  },
  { key: 'km', name: 'KM', display: 'KM', type: 'DECIMAL', width: 12 },
  { key: 'rate', name: 'Rate', display: 'Rate', type: 'DECIMAL', width: 14 },
  { key: 'totalRate', name: 'Total Rate', display: 'Total Rate', type: 'DECIMAL', width: 16 },
  { key: 'routeCode2', name: 'Route Code2', display: 'Route Code', type: 'TEXT', width: 20 },
]

// ------------------------------------------------------------------
// Users
// ------------------------------------------------------------------
async function seedUsers() {
  const users = [
    { email: 'admin@npl.com', name: 'System Administrator', role: 'ADMIN', password: 'Admin@123' },
    { email: 'manager@npl.com', name: 'Anmol Madhav', role: 'MANAGER', password: 'Manager@123' },
    { email: 'user@npl.com', name: 'Rahul Sharma', role: 'USER', password: 'User@123' },
    { email: 'viewer@npl.com', name: 'Sandeep Verma', role: 'VIEWER', password: 'Viewer@123' },
  ]
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email, name: u.name, role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    })
  }
  console.log(`✓ Users seeded (${users.length})`)
}

// ------------------------------------------------------------------
// Field registry
// ------------------------------------------------------------------
async function seedFields() {
  await db.misField.deleteMany({}) // fresh registry
  let pos = 0
  for (const f of FIELDS) {
    await db.misField.create({
      data: {
        fieldKey: f.key,
        fieldName: f.name,
        displayName: f.display,
        dataType: f.type,
        required: !!f.required,
        defaultValue: f.default ?? null,
        options: f.options ? JSON.stringify(f.options) : null,
        position: pos++,
        isCore: true,
        isSystem: f.key === 'srNo',
        active: true,
        width: f.width,
        createdBy: 'system',
      },
    })
  }
  console.log(`✓ Field registry seeded (${FIELDS.length} core fields)`)
}

// ------------------------------------------------------------------
// Records from Excel
// ------------------------------------------------------------------
function toISODate(d: Date): Date {
  // Excel naive dates → UTC midnight (stable, portable)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v ?? null)

async function seedRecords() {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true })
  const sheet = wb.Sheets['MIS']
  if (!sheet) throw new Error('MIS sheet not found')
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

  // Header is row index 1 (Excel row 2); data from row index 2
  const dataRows = rows.slice(2).filter((r) => r.some((c) => c !== null && c !== undefined && c !== ''))

  let count = 0
  const BATCH = 100
  let batch: any[] = []
  for (const r of dataRows) {
    const get = (i: number) => trim(r[i])
    const date = (i: number) => {
      const v = r[i]
      if (v == null || v === '') return null
      if (v instanceof Date) return toISODate(v)
      return null
    }
    const int = (i: number) => {
      const v = r[i]
      if (v == null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? Math.round(n) : null
    }
    const rec = {
      pickupLocation: get(1) as string | null,
      partyName: get(2) as string | null,
      destination: get(3) as string | null,
      invoiceNumber: r[4] == null || r[4] === '' ? null : String(get(4)),
      lrNo: int(5),
      lrDate: date(6),
      routeCode: get(7) as string | null,
      materialDetails: get(8) as string | null,
      transporterName: get(9) as string | null,
      bucket: int(10),
      totalQuantityLtrs: int(11),
      loadType: get(12) as string | null,
      expectedDeliveryDate: date(13),
      actualDeliveryDate: date(14),
      deliveryStatus: get(15) as string | null,
      lrStatus: get(16) as string | null,
      damage: get(17) as string | null,
      loadingCharges: r[18] == null || r[18] === '' ? null : Number(r[18]),
      unloadingCharges: r[19] == null || r[19] === '' ? null : Number(r[19]),
      vehicleNumber: get(20) as string | null,
      vehicleType: int(21),
      ply: int(22),
      remark: get(23) as string | null,
      remarks1: get(24) as string | null,
      dispatchDate: date(25),
      dispatchVehicle: get(26) as string | null,
      vendorName: get(27) as string | null,
      routeCode2: get(28) as string | null,
      podStatus: get(29) as string | null,
      createdBy: 'excel-import',
      updatedBy: 'excel-import',
    }
    // Business identity — SAME normalization library as the import pipeline,
    // so a freshly seeded database deduplicates correctly when the same
    // workbook is imported through the UI (no phantom duplicates).
    const keys = computeRecordKeys({
      lrNo: rec.lrNo,
      invoiceNumber: rec.invoiceNumber,
      partyName: rec.partyName,
      materialDetails: rec.materialDetails,
      bucket: rec.bucket,
      totalQuantityLtrs: rec.totalQuantityLtrs,
    })
    // Delivery-derived columns — identical runtime derivation
    // (src/lib/services/delivery.ts), matching the historical database.
    const patch = computeDeliveryPatch(rec)
    const row = { ...rec, ...patch, businessKey: keys.businessKey, lineKey: keys.lineKey }
    batch.push(row)
    if (batch.length >= BATCH) {
      await db.misRecord.createMany({ data: batch })
      count += batch.length
      batch = []
    }
  }
  if (batch.length) {
    await db.misRecord.createMany({ data: batch })
    count += batch.length
  }
  console.log(`✓ Records imported: ${count}`)
  return count
}

async function verify() {
  const total = await db.misRecord.count()
  const qty = await db.misRecord.aggregate({ _sum: { totalQuantityLtrs: true, bucket: true } })
  const pending = await db.misRecord.count({ where: { remarks1: 'Pending' } })
  const lr = await db.misRecord.findFirst({ where: { lrNo: 1301 } })
  console.log('--- VERIFY ---')
  console.log(`records=${total} (expect 340)`)
  console.log(`totalQty=${qty._sum.totalQuantityLtrs} (expect 180885)`)
  console.log(`totalBucket=${qty._sum.bucket} (expect ${8067 + 8119 > 0 ? '?' : '?'})`)
  console.log(`pending(remarks1)=${pending} (expect 7)`)
  console.log(`LR 1301: party=${lr?.partyName}, dest=${lr?.destination}, qty=${lr?.totalQuantityLtrs}, lrDate=${lr?.lrDate?.toISOString()}`)
}

async function main() {
  console.log('Seeding NPL MIS Portal…')
  // full reset — clean database with the original workbook data
  await db.misValue.deleteMany({})
  await db.misRecord.deleteMany({})
  await db.misField.deleteMany({})
  await db.auditLog.deleteMany({})
  await db.importJob.deleteMany({})
  await seedUsers()
  await seedFields()
  const n = await seedRecords()
  await verify()
  if (n !== 340) console.warn(`⚠ expected 340 records, got ${n}`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
