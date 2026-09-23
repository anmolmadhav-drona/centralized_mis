/**
 * Production-safe MIS field registry migration.
 *
 * Purpose:
 * - Restore the canonical 38 core MIS fields used by the application.
 * - Add missing fields without deleting existing fields/data.
 * - Align existing canonical fields with the definitions from seed.ts.
 * - Preserve non-core/dynamic fields.
 *
 * IMPORTANT:
 * - DO NOT use the development seed in production.
 * - This script does NOT delete MisField, MisRecord, MisValue, users,
 *   audit logs, or import jobs.
 * - Safe to run more than once.
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

type FieldDefinition = {
  key: string
  name: string
  display: string
  type: string
  width: number
  required?: boolean
  default?: string
  options?: string[]
}

const FIELDS: FieldDefinition[] = [
  { key: 'srNo', name: 'SR. NO.', display: 'Sr. No.', type: 'INTEGER', width: 13.1 },
  { key: 'pickupLocation', name: 'PICKUP LOCATION', display: 'Pickup Location', type: 'TEXT', width: 21.9, default: 'Sonipat' },
  { key: 'partyName', name: 'PARTY NAME', display: 'Party Name', type: 'TEXT', width: 33.4, required: true },
  { key: 'destination', name: 'DESTINATION', display: 'Destination', type: 'TEXT', width: 23.9, required: true },
  { key: 'invoiceNumber', name: 'INVOICE NUMBER', display: 'Invoice Number', type: 'TEXT', width: 21.9 },
  { key: 'lrNo', name: 'LR. NO.', display: 'LR No.', type: 'INTEGER', width: 13.0, required: true },
  { key: 'lrDate', name: 'LR DATE', display: 'LR Date', type: 'DATE', width: 13.7, required: true },

  { key: 'routeCode', name: 'Route Code', display: 'Route Code', type: 'TEXT', width: 15.2 },

  { key: 'materialDetails', name: 'MATERIAL DETAILS', display: 'Material Details', type: 'TEXT', width: 37.4 },
  { key: 'transporterName', name: 'TRANSPOTER NAME', display: 'Transporter Name', type: 'TEXT', width: 23.8, default: 'Drona Logitech' },
  { key: 'bucket', name: 'Bucket', display: 'Bucket', type: 'INTEGER', width: 12.7 },
  { key: 'totalQuantityLtrs', name: 'TOTAL QUANTITY IN LTRS', display: 'Total Quantity (Ltrs)', type: 'INTEGER', width: 28.6 },
  { key: 'loadType', name: 'LOAD TYPE FTL/PTL', display: 'Load Type', type: 'TEXT', width: 22.9, default: 'PTL' },
  { key: 'expectedDeliveryDate', name: 'EXPECTED DELIVERY DATE', display: 'Expected Delivery Date', type: 'DATE', width: 29.1 },
  { key: 'actualDeliveryDate', name: 'ACTUAL DELIVERY DATE', display: 'Actual Delivery Date', type: 'DATE', width: 27.0 },
  { key: 'deliveryStatus', name: 'DELIVERY STATUS', display: 'Delivery Status', type: 'TEXT', width: 24, default: 'Pending', options: ['Delivered', 'In Transit', 'Pending'] },


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
  { key: 'podStatus', name: 'POD Status', display: 'POD Status', type: 'TEXT', width: 20, default: 'POD Pending' },
  { key: 'km', name: 'KM', display: 'KM', type: 'DECIMAL', width: 12 },
  { key: 'rate', name: 'Rate', display: 'Rate', type: 'DECIMAL', width: 14 },
  { key: 'totalRate', name: 'Total Rate', display: 'Total Rate', type: 'DECIMAL', width: 16 },

  { key: 'routeCode2', name: 'Route Code 2', display: 'Route Code 2', type: 'TEXT', width: 20 },
]

async function main() {
  console.log('MIS Field Registry - production-safe migration')
  console.log(`Canonical fields: ${FIELDS.length}`)
  console.log('No records/users/values will be deleted.')

  let created = 0
  let updated = 0

  await db.$transaction(async (tx) => {
    for (const [position, field] of FIELDS.entries()) {
      const existing = await tx.misField.findUnique({
        where: { fieldKey: field.key },
        select: { id: true },
      })

      const data = {
        fieldName: field.name,
        displayName: field.display,
        dataType: field.type,
        required: !!field.required,
        defaultValue: field.default ?? null,
        position,
        isCore: true,
        isSystem: field.key === 'srNo',
        active: true,
        width: field.width,
        ...(field.options !== undefined
          ? { options: JSON.stringify(field.options) }
          : {}),
      }

      if (existing) {
        await tx.misField.update({
          where: { id: existing.id },
          data,
        })

        updated++
      } else {
        await tx.misField.create({
          data: {
            fieldKey: field.key,
            ...data,
            createdBy: 'system',
          },
        })

        created++
      }
    }
  })

  const totalCore = await db.misField.count({
    where: { isCore: true },
  })

  const totalActive = await db.misField.count({
    where: { active: true },
  })

  console.log('')
  console.log('Migration complete.')
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Core fields now: ${totalCore}`)
  console.log(`Active fields now: ${totalActive}`)

  if (totalCore < FIELDS.length) {
    throw new Error(
      `Verification failed: expected at least ${FIELDS.length} core fields, found ${totalCore}`,
    )
  }

  console.log('✓ Field registry verification passed.')
}

main()
  .catch((error) => {
    console.error('Migration failed:')
    console.error(error)
    throw error
  })
  .finally(async () => {
    await db.$disconnect()
  })
