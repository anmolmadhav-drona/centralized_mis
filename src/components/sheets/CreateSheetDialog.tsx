'use client'

// Create a New Sheet — ADMIN-only dialog. Two modes: build a business module
// from scratch (define columns) or clone an existing sheet's business module
// (configuration only — no records). Server (/api/sheets) is authoritative.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, X, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiPost, ApiClientError } from '@/lib/client/api'
import type { SheetDto } from '@/lib/types'

interface ColRow { id: string; name: string }
const newCol = (name = ''): ColRow => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name })

export default function CreateSheetDialog({
  open,
  onOpenChange,
  sheets,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sheets: SheetDto[]
  onCreated: (sheet: SheetDto) => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'scratch' | 'import'>('scratch')
  const [columns, setColumns] = useState<ColRow[]>([newCol('LR No.'), newCol('Party'), newCol('Destination')])
  const [sourceSheetId, setSourceSheetId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingNames = useMemo(() => new Set(sheets.map((s) => s.name.trim().toLowerCase())), [sheets])
  const sourceOptions = sheets // all existing sheets are eligible templates (NPL included)

  const reset = () => {
    setName(''); setMode('scratch')
    setColumns([newCol('LR No.'), newCol('Party'), newCol('Destination')])
    setSourceSheetId(''); setError(null)
  }

  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v) }

  const setColName = (id: string, v: string) => setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, name: v } : c)))
  const removeCol = (id: string) => setColumns((cs) => cs.filter((c) => c.id !== id))
  const move = (i: number, dir: -1 | 1) => setColumns((cs) => {
    const j = i + dir
    if (j < 0 || j >= cs.length) return cs
    const next = [...cs]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  const validate = (): string | null => {
    const nm = name.trim()
    if (!nm) return 'Sheet name is required.'
    if (existingNames.has(nm.toLowerCase())) return `A sheet named "${nm}" already exists.`
    if (mode === 'scratch') {
      const named = columns.map((c) => c.name.trim()).filter(Boolean)
      if (named.length === 0) return 'Add at least one column.'
      const seen = new Set<string>()
      for (const c of columns) {
        const key = c.name.trim().toLowerCase()
        if (!key) return 'Column names cannot be empty.'
        if (seen.has(key)) return `Duplicate column name: ${c.name.trim()}`
        seen.add(key)
      }
    } else if (!sourceSheetId) {
      return 'Choose a source business module.'
    }
    return null
  }

  const submit = async () => {
    const v = validate()
    if (v) { setError(v); return }
    setSubmitting(true)
    setError(null)
    try {
      const body = mode === 'scratch'
        ? { name: name.trim(), mode, columns: columns.map((c) => ({ name: c.name.trim() })) }
        : { name: name.trim(), mode, sourceSheetId }
      const { sheet } = await apiPost<{ sheet: SheetDto }>('/api/sheets', body)
      toast.success('Sheet created', { description: `"${sheet.name}" is ready.` })
      onCreated(sheet)
      close(false)
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not create the sheet. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a New Sheet</DialogTitle>
          <DialogDescription>Add a new application MIS sheet (dataset). It starts with no records.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sheet-name">Sheet Name</Label>
            <Input id="sheet-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Samsung" disabled={submitting} />
          </div>

          <div className="space-y-2">
            <Label>Business Module</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'scratch' | 'import')} className="gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="scratch" id="mode-scratch" disabled={submitting} /> Create from scratch
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="import" id="mode-import" disabled={submitting} /> Import existing Business Module
              </label>
            </RadioGroup>
          </div>

          {mode === 'scratch' ? (
            <div className="space-y-2">
              <Label>Columns</Label>
              <div className="nice-scroll max-h-64 space-y-1.5 overflow-auto pr-1">
                {columns.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <Input
                      value={c.name}
                      onChange={(e) => setColName(c.id, e.target.value)}
                      placeholder={`Column ${i + 1}`}
                      disabled={submitting}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => move(i, -1)} disabled={submitting || i === 0} aria-label="Move up">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => move(i, 1)} disabled={submitting || i === columns.length - 1} aria-label="Move down">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeCol(c.id)} disabled={submitting} aria-label="Remove column">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setColumns((cs) => [...cs, newCol()])} disabled={submitting}>
                <Plus className="h-3.5 w-3.5" /> Add Column
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Source Business Module</Label>
              <Select value={sourceSheetId} onValueChange={setSourceSheetId} disabled={submitting}>
                <SelectTrigger><SelectValue placeholder="Select a source sheet…" /></SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-muted-foreground">Copies the column configuration only — no records are copied.</p>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive" role="alert">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create Sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
