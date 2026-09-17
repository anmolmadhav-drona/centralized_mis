'use client'

// Optimistic-concurrency conflict resolution — presented whenever a save
// collides with a newer version. Shows who changed what and when, with
// per-field resolution (database value vs. your value).
import { useMemo, useState } from 'react'
import { AlertTriangle, Database, User, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtDateTime, fmtNum } from '@/lib/client/format'
import { apiPatch } from '@/lib/client/api'
import type { FieldDef, MisRecordDto, SessionUser } from '@/lib/types'

interface ConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fields: FieldDef[]
  current: MisRecordDto | null // latest DB version
  attempted: Record<string, unknown> | null // user's attempted save
  recordId: string | null
  user: SessionUser
  onResolved: (rec: MisRecordDto) => void
}

type FieldChoice = 'db' | 'mine'

export default function ConflictDialog(props: ConflictDialogProps) {
  const { open, onOpenChange, fields, current, attempted, recordId, user, onResolved } = props
  const [choices, setChoices] = useState<Record<string, FieldChoice>>({})
  const [applying, setApplying] = useState(false)

  const diffs = useMemo(() => {
    if (!current || !attempted) return []
    const list: Array<{ field: FieldDef; dbValue: unknown; myValue: unknown }> = []
    for (const f of fields) {
      if (f.isSystem) continue
      const mine = attempted[f.fieldKey]
      const db = current[f.fieldKey]
      if (!valuesEqualDisplay(db, mine)) {
        list.push({ field: f, dbValue: db, myValue: mine })
      }
    }
    return list
  }, [current, attempted, fields])

  // default: keep database (safe)
  const effectiveChoices = useMemo(() => {
    const eff: Record<string, FieldChoice> = {}
    for (const d of diffs) eff[d.field.fieldKey] = choices[d.field.fieldKey] || 'db'
    return eff
  }, [diffs, choices])

  const applyResolution = async () => {
    if (!current || !attempted || !recordId) return
    setApplying(true)
    try {
      // start from the current DB state, then overlay the fields the user chose
      const merged: Record<string, unknown> = {}
      for (const f of fields) {
        if (f.isSystem) continue
        const choice = effectiveChoices[f.fieldKey]
        merged[f.fieldKey] = choice === 'mine' ? attempted[f.fieldKey] : current[f.fieldKey]
      }
      const { record } = await apiPatch<{ record: MisRecordDto }>(`/api/records/${recordId}`, {
        version: current.version,
        values: merged,
      })
      toast.success('Conflict resolved', { description: 'Your resolution was saved as a new version.' })
      onResolved(record)
      onOpenChange(false)
    } catch {
      toast.error('Unable to apply the resolution', { description: 'The record may have changed again — please retry.' })
    } finally {
      setApplying(false)
    }
  }

  if (!current) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !applying && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            This record was modified by another user
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 pt-1">
              <p className="flex items-center gap-1.5 text-[13px]">
                <User className="h-3.5 w-3.5 opacity-60" />
                <span className="font-medium">{current.updatedBy || 'Another user'}</span>
                <span className="text-muted-foreground">saved version {current.version} on {fmtDateTime(current.updatedAt)}</span>
                <span className="text-muted-foreground">(you were editing version {Math.max(1, current.version - 1)})</span>
              </p>
              <p className="text-[13px] text-muted-foreground">
                Choose which value to keep for each field, then apply your resolution. Nothing is overwritten silently.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="nice-scroll max-h-[46vh] overflow-y-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Field</th>
                <th className="w-[6%] px-2 py-2" />
                <th className="px-3 py-2 font-medium">
                  <span className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5 opacity-60" /> Database value</span>
                </th>
                <th className="w-[6%] px-2 py-2" />
                <th className="px-3 py-2 font-medium"><User className="mr-1.5 inline h-3.5 w-3.5 opacity-60" />Your value</th>
              </tr>
            </thead>
            <tbody>
              {diffs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No field differences remain — the other user already made the same changes.
                  </td>
                </tr>
              )}
              {diffs.map((d) => {
                const choice = effectiveChoices[d.field.fieldKey]
                return (
                  <tr key={d.field.fieldKey} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{d.field.displayName}</td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="radio"
                        aria-label={`Keep database value for ${d.field.displayName}`}
                        checked={choice === 'db'}
                        onChange={() => setChoices((c) => ({ ...c, [d.field.fieldKey]: 'db' }))}
                        className="h-3.5 w-3.5 accent-[var(--primary)]"
                      />
                    </td>
                    <td className={`px-3 py-2 ${choice === 'db' ? 'bg-emerald-50/60 font-medium dark:bg-emerald-500/10' : 'text-muted-foreground'}`}>
                      {display(d.dbValue, d.field.dataType)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="radio"
                        aria-label={`Use my value for ${d.field.displayName}`}
                        checked={choice === 'mine'}
                        onChange={() => setChoices((c) => ({ ...c, [d.field.fieldKey]: 'mine' }))}
                        className="h-3.5 w-3.5 accent-[var(--primary)]"
                      />
                    </td>
                    <td className={`px-3 py-2 ${choice === 'mine' ? 'bg-primary/8 font-medium' : 'text-muted-foreground'}`}>
                      {display(d.myValue, d.field.dataType)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2 border-t pt-4">
          <p className="mr-auto text-xs text-muted-foreground">
            Record LR {current.lrNo != null ? String(current.lrNo) : '—'} • resolving as {user.name}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            <X className="h-4 w-4" /> Discard my changes
          </Button>
          <Button onClick={applyResolution} disabled={applying || diffs.length === 0}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Apply resolution (v{current.version + 1})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function display(v: unknown, dataType: string): string {
  if (v == null || v === '') return '—'
  if (dataType === 'DATE' || dataType === 'DATETIME') return fmtDate(v)
  if (dataType === 'INTEGER' || dataType === 'DECIMAL') return fmtNum(v)
  if (dataType === 'BOOLEAN') return v === true || v === 'true' ? 'Yes' : 'No'
  return String(v)
}

function valuesEqualDisplay(a: unknown, b: unknown): boolean {
  if (a == null && (b == null || b === '')) return true
  if (b == null && (a == null || a === '')) return true
  if (a == null || b == null) return false
  return String(a).trim() === String(b).trim()
}
