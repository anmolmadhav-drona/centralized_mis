'use client'

// Excel-style formula bar above the MIS grid:
//   • shows the selected cell's reference (LR + column)
//   • displays the FORMULA when the cell has one, otherwise its value
//   • typing =Bucket*3 here (or in the cell) creates a live formula
//   • Enter commits, Escape reverts to the stored content
import { useRef, useState } from 'react'
import { CornerDownLeft, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FieldDef, MisRecordDto } from '@/lib/types'
import type { SelectedCell } from '@/components/mis/MisGrid'

const FORMULA_CAPABLE = new Set(['TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL'])

interface FormulaBarProps {
  selected: SelectedCell | null
  fields: FieldDef[]
  canEdit: boolean
  saving: boolean
  onCommit: (fieldKey: string, text: string) => void
}

export default function FormulaBar({ selected, fields, canEdit, saving, onCommit }: FormulaBarProps) {
  const record = selected?.record ?? null
  const fieldKey = selected?.fieldKey ?? ''
  const field = fields.find((f) => f.fieldKey === fieldKey) ?? null
  const formula = record?._formulas?.[fieldKey]
  const error = record?._formulaErrors?.[fieldKey]
  const rawValue = record ? record[fieldKey] : null
  const base = formula ?? (rawValue == null ? '' : String(rawValue))

  const [text, setText] = useState(base)
  const [dirty, setDirty] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // React-approved render-phase adjustment: when the selected cell changes
  // (or its server record updates while we're not typing), drop stale editor
  // state instead of clobbering the user mid-keystroke.
  const sel = `${record?.id ?? ''}:${fieldKey}`
  const ver = record?.version ?? 0
  const [seen, setSeen] = useState({ sel, ver, base })
  if (seen.sel !== sel || seen.ver !== ver) {
    setSeen({ sel, ver, base })
    if (seen.sel !== sel || !dirty) {
      setText(base)
      setDirty(false)
    }
  }

  const disabled = !record || !field || !canEdit || saving
  const formulaReady = !!field && FORMULA_CAPABLE.has(field.dataType)

  const commit = () => {
    if (disabled || !fieldKey) return
    const next = text.trim()
    if (next === base.trim()) { setDirty(false); return } // nothing changed
    onCommit(fieldKey, next)
    setDirty(false)
  }

  const revert = () => {
    setText(base)
    setDirty(false)
    inputRef.current?.blur()
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] shadow-sm transition-opacity',
        !record && 'opacity-60',
      )}
      aria-label="Formula bar"
    >
      {/* cell reference — warm charcoal chip */}
      <span className="flex min-w-[7.5rem] items-center gap-1.5 rounded-md bg-secondary px-2 py-1 font-mono text-xs text-secondary-foreground">
        {record
          ? `LR ${record.lrNo ?? '—'} · ${field?.displayName ?? fieldKey}`
          : 'Select a cell'}
      </span>

      <span className="flex items-center gap-1 rounded-md bg-brand-gold/15 px-1.5 py-1 text-[11px] font-bold text-[#8A5B0F] dark:text-brand-gold" title="Formula — type =Bucket*3 to calculate">
        fx
      </span>

      {/* formula / value input */}
      <input
        ref={inputRef}
        value={text}
        disabled={disabled}
        spellCheck={false}
        placeholder={record ? (formulaReady ? 'Value — or type a formula like =Bucket*3' : 'Value') : 'Click any cell in the grid to inspect it'}
        onChange={(e) => { setDirty(true); setText(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); revert() }
        }}
        aria-label={formula ? 'Formula' : 'Cell value'}
        className={cn(
          'h-8 min-w-0 flex-1 rounded-md border-input bg-transparent px-2.5 font-mono text-[13px] outline-none ring-offset-background placeholder:font-sans placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
          formula && 'italic text-[#8A5B0F] dark:text-brand-gold',
          dirty && text.trim().startsWith('=') && 'text-[#8A5B0F] dark:text-brand-gold',
        )}
      />

      {/* error display */}
      {error && (
        <span className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive" title={error.message}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[28rem] truncate">{error.code} — {error.message}</span>
        </span>
      )}

      {dirty && canEdit && !saving && (
        <button
          onClick={commit}
          className="flex shrink-0 items-center gap-1 rounded-md bg-brand-red px-2 py-1 text-xs font-medium text-white hover:bg-brand-red/90"
        >
          <CornerDownLeft className="h-3 w-3" aria-hidden /> Save
        </button>
      )}

      <span className="ml-auto hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground lg:flex">
        <span>=Bucket*3 · =Quantity*Rate · =SUM(B2:B20)</span>
        <span className="text-muted-foreground/60">Enter saves · Esc reverts</span>
      </span>
    </div>
  )
}
