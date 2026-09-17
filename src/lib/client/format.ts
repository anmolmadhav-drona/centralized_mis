// Display formatting — dates, numbers, status badges
import { format } from 'date-fns'

/** Excel-style date display (dd-MMM-yyyy) from ISO yyyy-MM-dd */
export function fmtDate(iso: unknown): string {
  if (!iso) return '—'
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : String(iso))
  if (isNaN(d.getTime())) return String(iso)
  return format(d, 'dd-MMM-yyyy')
}

export function fmtDateTime(iso: unknown): string {
  if (!iso) return '—'
  const d = new Date(String(iso))
  if (isNaN(d.getTime())) return String(iso)
  return format(d, 'dd-MMM-yyyy HH:mm')
}

/** Indian grouping for quantities */
export function fmtNum(n: unknown): string {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  return v.toLocaleString('en-IN')
}

export function fmtQty(n: unknown): string {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  return `${v.toLocaleString('en-IN')} L`
}

export function fmtPercent(n: number): string {
  return `${Math.round(n)}%`
}

// ------------------------------------------------------------------
// Status colors (badge variants)
// ------------------------------------------------------------------
export type BadgeTone =
  | 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'

export function deliveryStatusTone(status: unknown): BadgeTone {
  switch (String(status)) {
    case 'Delivered': return 'success'
    case 'Pending': return 'warning'
    case 'In transit': return 'info'
    case 'Handover to NPL': return 'neutral'
    case 'Return': return 'danger'
    case 'Return to WH': return 'danger'
    case 'NPL Refused To Deliver': return 'danger'
    default: return 'default'
  }
}

export function podStatusTone(status: unknown): BadgeTone {
  const s = String(status)
  if (s.startsWith('Received')) return 'success'
  if (s.startsWith('POD Pending')) return 'warning'
  if (s.startsWith('Return')) return 'danger'
  if (s === 'WH') return 'neutral'
  if (s === 'NPL Refused To Deliver') return 'danger'
  return 'default'
}

export function loadTypeTone(t: unknown): BadgeTone {
  return String(t) === 'FTL' ? 'purple' : 'neutral'
}
