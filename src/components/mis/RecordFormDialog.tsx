'use client'

// Dynamic Add/Edit record dialog — fields generated from the registry:
// grouped sections for fast scanning, smart defaults pre-filled, status
// dropdowns rendered as colored badges (matching the grid), and text fields
// that suggest existing values from the live MIS as you type.
// Excel-style formulas ("=Bucket*3") are supported in any text/number field.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Loader2, Save, Plus, CalendarIcon, Check,
  Truck, Building2, Wallet, Package, ReceiptText, MessageSquare, Layers,
  CircleAlert, CircleCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { apiGet, apiPost, apiPatch, ApiClientError } from '@/lib/client/api'
import type { FieldDef, MisRecordDto, SessionUser } from '@/lib/types'
import { fmtDate } from '@/lib/client/format'

interface RecordFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fields: FieldDef[]
  record?: MisRecordDto | null // null → create mode
  user: SessionUser
  onSaved: (rec: MisRecordDto) => void
  onConflict: (current: MisRecordDto, attempted: Record<string, unknown>, version: number) => void
}

// fields with >12 options get a searchable combobox
// ------------------------------------------------------------------
// Sectioning — known core fields are grouped for fast scanning; anything
// else (custom/dynamic fields) falls into a trailing "Additional" section.
// ------------------------------------------------------------------
interface SectionDef {
  id: string
  title: string
  description: string
  icon: LucideIcon
  keys: string[]
}

const SECTION_DEFS: SectionDef[] = [
  {
    id: 'shipment', title: 'Shipment & Route', icon: Truck,
    description: 'LR, vehicle and routing details',
    keys: ['lrNo', 'lrDate', 'pickupLocation', 'transporterName', 'loadType', 'vehicleNumber', 'vehicleType', 'ply', 'routeCode2', 'vendorName', 'routeCode'],
  },
  {
    id: 'consignee', title: 'Consignee & Material', icon: Building2,
    description: 'Party, destination and cargo',
    keys: ['partyName', 'destination', 'materialDetails', 'bucket', 'totalQuantityLtrs'],
  },
  {
    id: 'charges', title: 'Charges & Rates', icon: Wallet,
    description: 'Amounts — plain numbers or Excel formulas',
    keys: ['loadingCharges', 'unloadingCharges', 'vehicleRate', 'km', 'rate', 'totalRate'],
  },
  {
    id: 'delivery', title: 'Delivery Tracking', icon: Package,
    description: 'Dates, delivery status and live tracking',
    keys: ['expectedDeliveryDate', 'actualDeliveryDate', 'deliveryStatus', 'liveStatus', 'trackingId', 'lastStatusUpdate'],
  },
  {
    id: 'billing', title: 'Billing & POD', icon: ReceiptText,
    description: 'Invoice, billing and proof-of-delivery',
    keys: ['invoiceNumber', 'lrStatus', 'podStatus', 'dispatchDate', 'dispatchFrom', 'dispatchVehicle'],
  },
  {
    id: 'remarks', title: 'Remarks & Damage', icon: MessageSquare,
    description: 'Notes and condition flags',
    keys: ['damage', 'remark', 'remarks1'],
  },
]

// small helper text under specific fields
const FIELD_HELP: Record<string, string> = {
  deliveryStatus: 'Manual status — drives reports and the Summary sheet.',
  liveStatus: 'Auto-derived from the shipment sync — no need to fill manually.',
  trackingId: 'Courier tracking number — enables live status lookups.',
  totalQuantityLtrs: 'Litres — or a formula like =Bucket*20.',
  loadingCharges: 'Amount or Excel formula, e.g. =Bucket*3.',
  unloadingCharges: 'Amount or Excel formula.',
  vehicleRate: 'Vendor vehicle rate — or an Excel formula.',
  rate: 'Per-unit rate — or an Excel formula.',
  totalRate: 'Total rate — or a formula like =KM*Rate.',
  dispatchFrom: 'Origin location the shipment was dispatched from.',
}

// friendlier placeholders for formula-friendly numeric fields
const NUMERIC_PLACEHOLDER: Record<string, string> = {
  totalQuantityLtrs: 'qty or =Bucket*20',
  loadingCharges: 'amount or =Bucket*3',
  unloadingCharges: 'amount',
}

export default function RecordFormDialog(props: RecordFormDialogProps) {
  const { open, onOpenChange, fields, record, user, onSaved, onConflict } = props
  const isEdit = !!record
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const dataFields = useMemo(() => fields.filter((f) => !f.isSystem), [fields])

  // fields arranged into sections; unmapped (custom) fields go last
  const sections = useMemo(() => {
    const byKey = new Map(dataFields.map((f) => [f.fieldKey, f]))
    const placed = new Set<string>()
    const out: Array<{ def: SectionDef; fields: FieldDef[] }> = []
    for (const def of SECTION_DEFS) {
      const fs: FieldDef[] = []
      for (const k of def.keys) {
        const f = byKey.get(k)
        if (f) { fs.push(f); placed.add(k) }
      }
      if (fs.length > 0) out.push({ def, fields: fs })
    }
    const rest = dataFields.filter((f) => !placed.has(f.fieldKey))
    if (rest.length > 0) {
      out.push({
        def: { id: 'additional', title: 'Additional Fields', description: 'Custom columns from your MIS schema', icon: Layers, keys: [] },
        fields: rest,
      })
    }
    return out
  }, [dataFields])

  useEffect(() => {
    if (!open) return
    const init: Record<string, unknown> = {}
    const today = format(new Date(), 'yyyy-MM-dd')
    for (const f of dataFields) {
      if (record) {
        // show the formula text (not the computed value) when the cell has one
        init[f.fieldKey] = record._formulas?.[f.fieldKey] ?? record[f.fieldKey] ?? ''
      } else {
        init[f.fieldKey] = f.defaultValue ?? ''
        // new LRs are almost always entered the same day they are issued
        if (!init[f.fieldKey] && f.fieldKey === 'lrDate') init[f.fieldKey] = today
      }
    }
    setValues(init)
    setErrors({})
  }, [open, record, dataFields])

  const setValue = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    for (const f of dataFields) {
      const v = values[f.fieldKey]
      const empty = v == null || v === ''
      if (f.required && empty) {
        errs[f.fieldKey] = `${f.displayName} is required`
        continue
      }
      if (empty) continue
      if (typeof v === 'string' && v.trim().startsWith('=')) continue // formula — validated by the engine
      if (f.dataType === 'INTEGER' || f.dataType === 'DECIMAL') {
        const n = Number(String(v).replace(/,/g, ''))
        if (!Number.isFinite(n)) errs[f.fieldKey] = 'Enter a valid number'
      }
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the highlighted fields.')
      return false
    }
    return true
  }

  const submit = async () => {
    if (!validate()) return
    // serialize values for the API (dates as yyyy-MM-dd, numbers as numbers)
    const payload: Record<string, unknown> = {}
    const formulas: Record<string, string | null> = {}
    for (const f of dataFields) {
      const v = values[f.fieldKey]
      const asStr = typeof v === 'string' ? v.trim() : ''
      if (asStr.startsWith('=')) {
        // Excel-style formula — stored & evaluated by the formula engine
        formulas[f.fieldKey] = asStr
        payload[f.fieldKey] = null
        continue
      }
      if (v == null || v === '') { payload[f.fieldKey] = null; continue }
      if (f.dataType === 'INTEGER' || f.dataType === 'DECIMAL') {
        payload[f.fieldKey] = Number(String(v).replace(/,/g, ''))
      } else if (f.dataType === 'BOOLEAN') {
        payload[f.fieldKey] = v === true || v === 'true' || v === 'Yes'
      } else if (f.dataType === 'DATE' || f.dataType === 'DATETIME') {
        payload[f.fieldKey] = v instanceof Date ? format(v, 'yyyy-MM-dd') : String(v)
      } else {
        payload[f.fieldKey] = String(v).trim()
      }
    }
    // replacing a formula with a plain value must clear the stored formula
    if (record?._formulas) {
      for (const key of Object.keys(record._formulas)) {
        if (!(key in formulas)) formulas[key] = null
      }
    }
    const hasFormulas = Object.keys(formulas).length > 0
    setSaving(true)
    try {
      if (isEdit && record) {
        const { record: updated } = await apiPatch<{ record: MisRecordDto }>(`/api/records/${record.id}`, {
          version: record.version,
          values: payload,
          ...(hasFormulas ? { formulas } : {}),
        })
        toast.success('Record saved', { description: `LR ${updated.lrNo ?? '—'} updated successfully.` })
        onSaved(updated)
        onOpenChange(false)
      } else {
        const { record: created } = await apiPost<{ record: MisRecordDto }>('/api/records', {
          values: payload,
          ...(hasFormulas ? { formulas } : {}),
        })
        toast.success('Record added', { description: `LR ${created.lrNo ?? '—'} saved to the MIS.` })
        onSaved(created)
        onOpenChange(false)
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'VERSION_CONFLICT' && record) {
        onConflict((err.data as { current?: MisRecordDto } | undefined)?.current as MisRecordDto, payload, record.version)
        onOpenChange(false)
        return
      }
      const msg = err instanceof ApiClientError ? err.message : 'Unable to save this record. Please try again.'
      // field-level errors from the server
      if (msg.includes(' is required') || msg.includes('Invalid') || msg.includes('not in the allowed list')) {
        for (const f of dataFields) {
          if (msg.includes(f.displayName)) {
            setErrors((prev) => ({ ...prev, [f.fieldKey]: msg }))
            break
          }
        }
      }
      toast.error('Save failed', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  // footer progress
  const filledCount = dataFields.filter((f) => { const v = values[f.fieldKey]; return v != null && v !== '' }).length
  const missingRequired = dataFields.filter((f) => f.required && (values[f.fieldKey] == null || values[f.fieldKey] === ''))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? 'Edit MIS Record' : (
              <><Plus className="h-4 w-4 text-primary" /> Add MIS Entry</>
            )}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Editing LR ${record?.lrNo ?? '—'} • ${record?.partyName ?? ''} — changes are versioned and audited.`
              : 'Frequent values are pre-filled and text fields suggest existing entries as you type — just complete the shipment details.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-1">
          {sections.map(({ def, fields: sectionFields }) => {
            const Icon = def.icon
            return (
              <section key={def.id} className="mt-6 first:mt-1">
                <div className="flex items-center gap-2.5 border-b pb-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[13px] font-semibold leading-tight">{def.title}</h4>
                    <p className="text-[11px] leading-tight text-muted-foreground">{def.description}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {sectionFields.length} field{sectionFields.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {sectionFields.map((f) => (
                    <div
                      key={f.fieldKey}
                      className={cn('space-y-1.5', f.dataType === 'LONG_TEXT' && 'sm:col-span-2 xl:col-span-3')}
                    >
                      <Label htmlFor={`f-${f.fieldKey}`} className="text-[13px]">
                        {f.displayName}
                        {f.required && <span className="ml-0.5 text-destructive">*</span>}
                      </Label>
                      <FieldControl
                        field={f}
                        value={values[f.fieldKey]}
                        error={errors[f.fieldKey]}
                        autoFocus={!isEdit && f.fieldKey === 'lrNo'}
                        onChange={(v) => setValue(f.fieldKey, v)}
                      />
                      {errors[f.fieldKey] ? (
                        <p className="text-xs text-destructive">{errors[f.fieldKey]}</p>
                      ) : FIELD_HELP[f.fieldKey] ? (
                        <p className="text-[11px] leading-snug text-muted-foreground">{FIELD_HELP[f.fieldKey]}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        <DialogFooter className="gap-2 border-t pt-4">
          <div className="mr-auto min-w-0 space-y-0.5">
            <p className="text-xs text-muted-foreground">
              {isEdit ? `Saving as ${user.name} • version ${record?.version}` : `Creating as ${user.name}`}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="tabular-nums text-muted-foreground">{filledCount}/{dataFields.length} filled</span>
              {missingRequired.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <CircleAlert className="h-3 w-3" />
                  <span className="truncate">Needs: {missingRequired.map((f) => f.displayName).join(', ')}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CircleCheck className="h-3 w-3" /> All required fields filled
                </span>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? 'Save Changes' : 'Add Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------
// Field controls
// ------------------------------------------------------------------
function FieldControl({ field, value, error, onChange, autoFocus }: {
  field: FieldDef
  value: unknown
  error?: string
  onChange: (v: unknown) => void
  autoFocus?: boolean
}) {
  const fid = `f-${field.fieldKey}`

  switch (field.dataType) {
    case 'DATE':
    case 'DATETIME': {
      const d = value ? new Date(String(value).length === 10 ? `${value}T00:00:00Z` : String(value)) : null
      const selected = d && !isNaN(d.getTime()) ? d : undefined
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id={fid}
              variant="outline"
              className={cn('w-full justify-start font-normal', !value && 'text-muted-foreground', error && 'border-destructive')}
            >
              <CalendarIcon className="mr-2 h-3.5 w-3.5 opacity-60" />
              {selected ? fmtDate(format(selected, 'yyyy-MM-dd')) : 'Pick a date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(day) => day && onChange(format(day, 'yyyy-MM-dd'))}
              disabled={(d) => d > new Date('2100-01-01')}
            />
          </PopoverContent>
        </Popover>
      )
    }
    case 'DROPDOWN': {
      return (
        <SuggestInput id={fid} field={field} value={value} error={error} autoFocus={autoFocus} onChange={onChange} />
      )
    }
    case 'LONG_TEXT':
      return (
        <Textarea
          id={fid}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${field.displayName.toLowerCase()}…`}
          rows={3}
          className={cn(error && 'border-destructive')}
        />
      )
    case 'INTEGER':
    case 'DECIMAL':
      return (
        <Input
          id={fid}
          type="text"
          inputMode="decimal"
          value={value == null || value === '' ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={NUMERIC_PLACEHOLDER[field.fieldKey] ?? '0'}
          className={cn('text-right tabular-nums', error && 'border-destructive')}
        />
      )
    case 'BOOLEAN':
      return (
        <Select value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={fid} className={cn('w-full', error && 'border-destructive')}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      )
    case 'TEXT':
      return (
        <SuggestInput
          id={fid}
          field={field}
          value={value}
          error={error}
          autoFocus={autoFocus}
          onChange={onChange}
        />
      )
    default:
      return (
        <Input
          id={fid}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${field.displayName.toLowerCase()}…`}
          className={cn(error && 'border-destructive')}
        />
      )
  }
}

// ------------------------------------------------------------------
// SuggestInput — text input that autocompletes from the live MIS.
// Type a few letters → existing values appear ranked by usage, with an
// "used N×" count. Free text is always allowed (new values are fine).
// ------------------------------------------------------------------
interface Suggestion { value: string; count: number }

function SuggestInput({ id, field, value, error, onChange, autoFocus }: {
  id: string
  field: FieldDef
  value: unknown
  error?: string
  autoFocus?: boolean
  onChange: (v: unknown) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState('')
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const fetchSuggest = (q: string) => {
    const mySeq = ++seq.current
    setLoading(true)
    apiGet<{ suggestions: Suggestion[] }>(
      `/api/records/suggest?field=${encodeURIComponent(field.fieldKey)}&q=${encodeURIComponent(q)}&limit=8`
    ).then((r) => {
      if (mySeq !== seq.current) return
      setItems(r.suggestions)
      setActive(-1)
      // open when there is something to pick, or to confirm a "new value"
      if (r.suggestions.length > 0 || q.trim() !== '') setOpen(true)
      else setOpen(false)
    }).catch(() => {
      // suggestions are best-effort sugar — never block typing
    }).finally(() => {
      if (mySeq === seq.current) setLoading(false)
    })
  }

  const debouncedFetch = (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fetchSuggest(q), 220)
  }

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setActive(-1)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      // close suggestions without closing the dialog
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
      setActive(-1)
      return
    }
    if (!open || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(items[active].value)
    }
  }

  return (
    // NOTE: the input is wrapped in PopoverAnchor (NOT PopoverTrigger) —
    // PopoverTrigger injects type="button" into its asChild child, which
    // would turn this text input into an un-typable button input.
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setActive(-1) }}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id={id}
          value={String(value ?? '')}
          placeholder={`Type or pick ${field.displayName.toLowerCase()}…`}
          autoFocus={autoFocus}
          autoComplete="off"
          className={cn(error && 'border-destructive')}
          onFocus={() => { if (!open) debouncedFetch(String(value ?? '')) }}
          onChange={(e) => {
            onChange(e.target.value)
            setQuery(e.target.value)
            debouncedFetch(e.target.value)
          }}
          onKeyDown={onKeyDown}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[320px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="nice-scroll max-h-64 overflow-y-auto py-1">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching existing values…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {query.trim() ? (
                <>No existing match — <span className="font-medium text-foreground">{query.trim()}</span> will be saved as new.</>
              ) : (
                'No existing values yet — you are setting the first one.'
              )}
            </div>
          )}
          {!loading && items.map((s, i) => (
            <button
              key={s.value}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none hover:bg-accent',
                i === active && 'bg-accent'
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s.value)}
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', value === s.value ? 'opacity-100' : 'opacity-0')} />
              <span className="min-w-0 flex-1 truncate">{s.value}</span>
              <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                used {s.count}×
              </span>
            </button>
          ))}
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          ↑↓ to browse · Enter to pick · keep typing to filter
        </div>
      </PopoverContent>
    </Popover>
  )
}
