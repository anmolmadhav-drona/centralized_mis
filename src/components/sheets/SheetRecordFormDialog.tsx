'use client'

// Generic Add-Entry form for an in-app Sheet. Every field is derived from the
// Sheet's persisted SheetColumn[] metadata (dataType / displayName / required /
// defaultValue / options / position / active) — no sheet-specific code. On save
// it POSTs exactly one record; Cancel writes nothing.
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SheetColumnDto } from '@/lib/types'

function initialFor(c: SheetColumnDto): unknown {
  if (c.dataType === 'BOOLEAN') {
    const d = (c.defaultValue ?? '').toString().trim().toLowerCase()
    return ['true', 'yes', '1', 'y'].includes(d)
  }
  return c.defaultValue ?? ''
}

export default function SheetRecordFormDialog({
  open,
  onOpenChange,
  sheetName,
  columns,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sheetName: string
  columns: SheetColumnDto[]
  onSubmit: (data: Record<string, unknown>) => Promise<void>
}) {
  // only active columns, in defined order
  const fields = useMemo(
    () => columns.filter((c) => c.active).sort((a, b) => a.position - b.position),
    [columns],
  )
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // (re)seed defaults whenever the dialog opens
  const seedKey = open ? '1' : '0'
  const [seededFor, setSeededFor] = useState('0')
  if (open && seededFor !== seedKey) {
    const init: Record<string, unknown> = {}
    for (const c of fields) init[c.fieldKey] = initialFor(c)
    setValues(init)
    setError(null)
    setSeededFor(seedKey)
  } else if (!open && seededFor !== '0') {
    setSeededFor('0')
  }

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }))

  const isEmpty = (c: SheetColumnDto): boolean => {
    const v = values[c.fieldKey]
    if (c.dataType === 'BOOLEAN') return false // a boolean is always set
    return v == null || String(v).trim() === ''
  }

  const submit = async () => {
    for (const c of fields) {
      if (c.required && isEmpty(c)) { setError(`${c.displayName} is required.`); return }
    }
    setSaving(true)
    setError(null)
    try {
      // send only fields the user actually provided (server coerces by dataType)
      const data: Record<string, unknown> = {}
      for (const c of fields) {
        if (c.dataType === 'BOOLEAN') data[c.fieldKey] = !!values[c.fieldKey]
        else if (!isEmpty(c)) data[c.fieldKey] = values[c.fieldKey]
      }
      await onSubmit(data)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the record.')
    } finally {
      setSaving(false)
    }
  }

  const renderField = (c: SheetColumnDto) => {
    const v = values[c.fieldKey]
    const id = `f-${c.fieldKey}`
    if (c.dataType === 'BOOLEAN') {
      return (
        <div className="flex items-center gap-2">
          <Switch id={id} checked={!!v} onCheckedChange={(b) => set(c.fieldKey, b)} disabled={saving} />
          <span className="text-[13px] text-muted-foreground">{v ? 'Yes' : 'No'}</span>
        </div>
      )
    }
    if (c.dataType === 'LONG_TEXT') {
      return <Textarea id={id} value={String(v ?? '')} onChange={(e) => set(c.fieldKey, e.target.value)} disabled={saving} rows={3} />
    }
    if (c.dataType === 'DROPDOWN' && c.options && c.options.length > 0) {
      return (
        <Select value={String(v ?? '')} onValueChange={(val) => set(c.fieldKey, val)} disabled={saving}>
          <SelectTrigger id={id}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {c.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    const type =
      c.dataType === 'INTEGER' || c.dataType === 'DECIMAL' ? 'number'
        : c.dataType === 'DATE' ? 'date'
          : c.dataType === 'DATETIME' ? 'datetime-local'
            : 'text'
    return (
      <Input
        id={id}
        type={type}
        step={c.dataType === 'INTEGER' ? '1' : c.dataType === 'DECIMAL' ? 'any' : undefined}
        value={String(v ?? '')}
        onChange={(e) => set(c.fieldKey, e.target.value)}
        disabled={saving}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Entry — {sheetName}</DialogTitle>
          <DialogDescription>Fill in the fields below. A record is saved only when you click Save.</DialogDescription>
        </DialogHeader>

        <div className="nice-scroll max-h-[60vh] space-y-3 overflow-auto pr-1">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">This sheet has no columns yet.</p>
          ) : (
            fields.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <Label htmlFor={`f-${c.fieldKey}`}>
                  {c.displayName}
                  {c.required && <span className="ml-1 text-destructive">*</span>}
                </Label>
                {renderField(c)}
              </div>
            ))
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive" role="alert">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || fields.length === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
