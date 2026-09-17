// Audit log writer
import { db } from '@/lib/db'

export interface AuditEntryInput {
  userId?: string | null
  userName?: string | null
  action: string
  entity: string
  entityId?: string | null
  fieldName?: string | null
  oldValue?: string | null
  newValue?: string | null
  source?: 'PORTAL' | 'EXCEL' | 'API'
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

function trunc(v: string | null | undefined, max = 2000): string | null {
  if (v == null) return null
  return v.length > max ? v.slice(0, max) : v
}

export async function writeAudit(entries: AuditEntryInput[]): Promise<void> {
  if (entries.length === 0) return
  await db.auditLog.createMany({
    data: entries.map((e) => ({
      userId: e.userId ?? null,
      userName: e.userName ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      fieldName: e.fieldName ?? null,
      oldValue: trunc(e.oldValue),
      newValue: trunc(e.newValue),
      source: e.source ?? 'API',
      ip: e.ip ?? null,
      userAgent: trunc(e.userAgent, 300),
      requestId: e.requestId ?? null,
    })),
  })
}
