// Field registry service — cached, single source of truth for the MIS schema
import { db } from '@/lib/db'
import type { FieldDef, FieldDataType, Role } from '@/lib/types'
import { filterFieldsForRole } from '@/lib/table-access'

// Field registry service — cached, single source of truth for the MIS schema.
// The cache lives on globalThis so every API route bundle (dev-mode Turbopack
// compiles routes into separate module graphs) shares ONE cache instance —
// invalidation from /api/fields is seen by /api/records immediately.
type FieldCache = { fields: FieldDef[]; at: number }

const CACHE_TTL_MS = 15_000

const g = globalThis as unknown as { __misFieldCache?: FieldCache | null }

export function invalidateFieldCache() {
  g.__misFieldCache = null
}

export async function getFields(includeInactive = false): Promise<FieldDef[]> {
  if (!g.__misFieldCache || Date.now() - g.__misFieldCache.at > CACHE_TTL_MS) {
    const rows = await db.misField.findMany({ orderBy: { position: 'asc' } })
    g.__misFieldCache = {
      at: Date.now(),
      fields: rows.map(mapFieldRow),
    }
  }
  return includeInactive ? g.__misFieldCache.fields : g.__misFieldCache.fields.filter((f) => f.active)
}

export async function getFieldMap(includeInactive = false): Promise<Map<string, FieldDef>> {
  const fields = await getFields(includeInactive)
  return new Map(fields.map((f) => [f.fieldKey, f]))
}

/** Field list filtered to what this ROLE may see (restricted tables removed). */
export async function getFieldsForRole(role: Role | null | undefined, includeInactive = false): Promise<FieldDef[]> {
  return filterFieldsForRole(await getFields(includeInactive), role)
}

/** Field map filtered to what this ROLE may see (restricted tables removed). */
export async function getFieldMapForRole(role: Role | null | undefined, includeInactive = false): Promise<Map<string, FieldDef>> {
  const fields = await getFieldsForRole(role, includeInactive)
  return new Map(fields.map((f) => [f.fieldKey, f]))
}

export function mapFieldRow(r: {
  id: string; fieldKey: string; fieldName: string; displayName: string; dataType: string;
  required: boolean; defaultValue: string | null; options: string | null; position: number;
  isCore: boolean; isSystem: boolean; active: boolean; width: number | null;
}): FieldDef {
  const isCoreFreeTextField = r.isCore && r.dataType === 'DROPDOWN'
  return {
    id: r.id,
    fieldKey: r.fieldKey,
    fieldName: r.fieldName,
    displayName: r.displayName,
    dataType: isCoreFreeTextField ? 'TEXT' : r.dataType as FieldDataType,
    required: r.required,
    defaultValue: r.defaultValue,
    options: isCoreFreeTextField ? null : r.options ? (JSON.parse(r.options) as string[]) : null,
    position: r.position,
    isCore: r.isCore,
    isSystem: r.isSystem,
    active: r.active,
    width: r.width,
  }
}



// ------------------------------------------------------------------
// Type traits — drive coercion, editors, filters, SQL columns
// ------------------------------------------------------------------
export const TYPE_TRAITS: Record<
  FieldDataType,
  { numeric: boolean; date: boolean; boolean: boolean; text: boolean; searchable: boolean }
> = {
  TEXT: { numeric: false, date: false, boolean: false, text: true, searchable: true },
  LONG_TEXT: { numeric: false, date: false, boolean: false, text: true, searchable: true },
  INTEGER: { numeric: true, date: false, boolean: false, text: false, searchable: false },
  DECIMAL: { numeric: true, date: false, boolean: false, text: false, searchable: false },
  DATE: { numeric: false, date: true, boolean: false, text: false, searchable: false },
  DATETIME: { numeric: false, date: true, boolean: false, text: false, searchable: false },
  BOOLEAN: { numeric: false, date: false, boolean: true, text: false, searchable: false },
  DROPDOWN: { numeric: false, date: false, boolean: false, text: true, searchable: true },
}

// ------------------------------------------------------------------
// Core field → Prisma/SQL column mapping (dynamic fields use EAV)
// ------------------------------------------------------------------
export const CORE_COLUMNS: Record<string, string> = {
  pickupLocation: 'pickupLocation',
  partyName: 'partyName',
  destination: 'destination',
  invoiceNumber: 'invoiceNumber',
  lrNo: 'lrNo',
  lrDate: 'lrDate',
  routeCode: 'routeCode',
  materialDetails: 'materialDetails',
  transporterName: 'transporterName',
  bucket: 'bucket',
  totalQuantity: 'totalQuantity',
  measurement: 'measurement',
  loadType: 'loadType',
  expectedDeliveryDate: 'expectedDeliveryDate',
  actualDeliveryDate: 'actualDeliveryDate',
  deliveryStatus: 'deliveryStatus',
  trackingId: 'trackingId',
  lastStatusUpdate: 'lastStatusUpdate',
  lrStatus: 'lrStatus',
  damage: 'damage',
  loadingCharges: 'loadingCharges',
  unloadingCharges: 'unloadingCharges',
  vehicleNumber: 'vehicleNumber',
  vehicleType: 'vehicleType',
  ply: 'ply',
  remark: 'remark',
  remarks1: 'remarks1',
  dispatchDate: 'dispatchDate',
  dispatchFrom: 'dispatchFrom',
  dispatchVehicle: 'dispatchVehicle',
  vendorName: 'vendorName',
  routeCode2: 'routeCode2',
  podStatus: 'podStatus',
  vehicleRate: 'vehicleRate',
  km: 'km',
  rate: 'rate',
  totalRate: 'totalRate',
}

export function sqlColumnFor(field: FieldDef): string | null {
  return CORE_COLUMNS[field.fieldKey] ?? null
}
