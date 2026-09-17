// Zod schemas — every API input is validated server-side
import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const FIELD_DATA_TYPES = [
  'TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN',
] as const

export const fieldCreateSchema = z.object({
  fieldName: z
    .string()
    .trim()
    .min(2, 'Column name must be at least 2 characters')
    .max(60, 'Column name must be at most 60 characters')
    .refine((s) => !/^SYS_/.test(s), 'Names starting with SYS_ are reserved'),
  displayName: z.string().trim().min(2).max(60).optional(),
  dataType: z.enum(FIELD_DATA_TYPES),
  required: z.boolean().optional().default(false),
  defaultValue: z.string().trim().max(200).optional().nullable(),
  options: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
  position: z.enum(['first', 'last']).default('last'), // simple placement for now
  width: z.number().positive().max(80).optional(),
})

export const fieldUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().trim().max(200).nullable().optional(),
  options: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  width: z.number().positive().max(80).optional(),
})

export const recordCreateSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  /** cell formulas: fieldKey → formula text ('=Bucket*3') or null (clear) */
  formulas: z.record(z.string().max(80), z.string().max(2000).nullable()).optional(),
})

export const recordUpdateSchema = z.object({
  version: z.number().int().positive(),
  /** plain values — optional when the edit only sets/clears formulas */
  values: z.record(z.string(), z.unknown()).optional().default({}),
  /** cell formulas: fieldKey → formula text ('=Bucket*3') or null (clear) */
  formulas: z.record(z.string().max(80), z.string().max(2000).nullable()).optional(),
})

export const bulkUpdateSchema = z.object({
  changes: z.array(z.object({
    id: z.string().min(1).max(40),
    version: z.number().int().positive(),
    values: z.record(z.string(), z.unknown()),
    formulas: z.record(z.string().max(80), z.string().max(2000).nullable()).optional(),
  })).min(1).max(500),
})

export const deliverySyncSchema = z.object({
  /** optional filter — sync everything by default */
  scope: z.enum(['all']).default('all'),
})

export const sortItemSchema = z.object({
  colId: z.string().min(1).max(80),
  sort: z.enum(['asc', 'desc']),
})

export const listQuerySchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  end: z.coerce.number().int().min(1).max(100000),
  search: z.string().max(200).optional(),
  filterModel: z.record(z.string().max(80), z.unknown()).optional(),
  sortModel: z.array(sortItemSchema).max(5).optional(),
})

export const exportSchema = z.object({
  search: z.string().max(200).optional(),
  filterModel: z.record(z.string().max(80), z.unknown()).optional(),
  sortModel: z.array(sortItemSchema).max(5).optional(),
  includeSummary: z.boolean().optional().default(true),
  sheetName: z.string().max(100).optional(),
})

export const importConfirmSchema = z.object({
  jobId: z.string().min(1),
  /** conflict record id → 'mine' (use uploaded values) | 'theirs' (keep DB values) */
  resolutions: z.record(z.string().regex(/^[a-z0-9]{20,30}$/i), z.enum(['mine', 'theirs'])).default({}),
  /** row indices (in preview payload) of NEW rows to import */
  newRows: z.array(z.number().int().min(0)).max(5000).default([]),
  /** row indices of CHANGED rows to apply */
  changedRows: z.array(z.number().int().min(0)).max(5000).default([]),
  /** record ids to delete (missing-from-file deletions) */
  deletions: z.array(z.string().regex(/^[a-z0-9]{20,30}$/i)).max(5000).default([]),
})

export const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(80),
  role: z.enum(['ADMIN', 'MANAGER', 'USER', 'VIEWER']),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
})

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'USER', 'VIEWER']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(72).optional(),
})

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
  action: z.string().max(40).optional(),
  entity: z.string().max(20).optional(),
  userId: z.string().max(40).optional(),
  search: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
