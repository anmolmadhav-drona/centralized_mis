// Role-based access control — expandable permission registry
import type { Role } from '@/lib/types'

export const PERMISSIONS = {
  ADMIN: [
    'records:view', 'records:create', 'records:edit', 'records:delete',
    'excel:import', 'excel:export',
    'fields:view', 'fields:manage',
    'reports:view', 'audit:view',
    'users:view', 'users:manage',
    'settings:view',
  ],
  MANAGER: [
    'records:view', 'records:create', 'records:edit', 'records:delete',
    'excel:import', 'excel:export',
    'fields:view', 'reports:view', 'settings:view',
  ],
  USER: [
    'records:view', 'records:create', 'records:edit',
    'excel:import', 'excel:export',
    'fields:view', 'reports:view', 'settings:view',
  ],
  VIEWER: [
    'records:view', 'excel:export',
    'fields:view', 'reports:view', 'settings:view',
  ],
} as const satisfies Record<Role, readonly string[]>

export type Permission = (typeof PERMISSIONS)[Role][number]

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false
  if (role === 'ADMIN') return true
  return (PERMISSIONS[role] as readonly string[]).includes(permission)
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  USER: 'Operator',
  VIEWER: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full access — users, fields, records, import/export, audit, settings',
  MANAGER: 'Manage records, import/export Excel, view reports',
  USER: 'Add and edit records, import/export Excel, view reports',
  VIEWER: 'Read-only — view, search, filter and export',
}
