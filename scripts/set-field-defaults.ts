// Set smart Add-Entry defaults on the live field registry (idempotent).
// Defaults are the dominant value in the source MIS for constant columns,
// or the natural starting state for status columns. Admins can change them
// later in Settings → MIS Fields.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const DEFAULTS: Record<string, string> = {
  pickupLocation: 'Sonipat',           // 340/340 records
  transporterName: 'Drona Logitech',   // 340/340 records
  lrStatus: 'To be Billed',            // 340/340 records
  damage: 'No',                        // 340/340 records
  vehicleType: '709',                  // 340/340 records
  ply: '0',                            // 340/340 records
  loadType: 'PTL',                     // 330 PTL vs 10 FTL
  deliveryStatus: 'Pending',           // new shipments start Pending
  podStatus: 'POD Pending',            // new shipments have POD pending
}

async function main() {
  for (const [fieldKey, def] of Object.entries(DEFAULTS)) {
    const f = await db.misField.findUnique({ where: { fieldKey } })
    if (!f) {
      console.log(`· ${fieldKey} — not in registry, skipped`)
      continue
    }
    if (f.defaultValue === def) {
      console.log(`· ${fieldKey} — already '${def}'`)
      continue
    }
    await db.misField.update({ where: { fieldKey }, data: { defaultValue: def } })
    console.log(`✓ ${fieldKey} — default set to '${def}'`)
  }
}
main().finally(() => db.$disconnect())
