'use client'

// MIS view — the primary screen: search, structured filters, AG Grid,
// inline editing with save indicators, add/edit dialog, conflict resolution,
// filtered Excel export, column visibility, bulk actions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  Search, X, Plus, Filter, Download, Columns3, Loader2, CheckCircle2,
  AlertCircle, Pencil, Trash2, RotateCcw, FileSpreadsheet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Calendar } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { GridApi } from 'ag-grid-community'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/client/store'
import { useFields } from '@/lib/client/hooks'
import { apiPatch, apiDelete, apiDownload, ApiClientError } from '@/lib/client/api'
import MisGrid, { type CellSaveRequest, type SelectedCell } from '@/components/mis/MisGrid'
import FormulaBar from '@/components/mis/FormulaBar'
import RecordFormDialog from '@/components/mis/RecordFormDialog'
import ConflictDialog from '@/components/mis/ConflictDialog'
import { filterChips, isFormulaText } from '@/components/mis/gridColumns'
import { fmtDate, fmtNum } from '@/lib/client/format'
import { can } from '@/lib/rbac'
import { filterFieldsForRole } from '@/lib/table-access'
import { Database } from 'lucide-react'
import { RouteDivider } from '@/components/brand/DronaLogo'
import type { FieldDef, MisRecordDto } from '@/lib/types'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function MisView() {
  const user = useAppStore((s) => s.user)
  const refreshEpoch = useAppStore((s) => s.refreshEpoch)
  // global search (header) lands in the workspace search box
  const misSearch = useAppStore((s) => s.misSearch)
  const misSearchEpoch = useAppStore((s) => s.misSearchEpoch)
  const { data: fieldsData, isLoading: fieldsLoading } = useFields()
  // defense in depth: the server already filters restricted tables (Vehicle
  // Rate, Loading Charges) from /api/fields for USER/VIEWER — filter again
  // client-side so no future code path can render them
  const fields = useMemo(
    () => filterFieldsForRole(fieldsData?.fields || [], user?.role),
    [fieldsData?.fields, user?.role],
  )

  const gridApiRef = useRef<GridApi | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchEpoch, setSearchEpoch] = useState(0)
  const [total, setTotal] = useState(0)
  const [columnVisibilityVersion, setColumnVisibilityVersion] = useState(0)
  const [selectionCount, setSelectionCount] = useState(0)
  const [filterModel, setFilterModel] = useState<Record<string, Record<string, unknown>>>({})
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)
  const [rangeInfo, setRangeInfo] = useState<string | null>(null)

  // dialogs
  const [formOpen, setFormOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<MisRecordDto | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictCurrent, setConflictCurrent] = useState<MisRecordDto | null>(null)
  const [conflictAttempted, setConflictAttempted] = useState<Record<string, unknown> | null>(null)
  const [conflictRecordId, setConflictRecordId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [includeSummary, setIncludeSummary] = useState(true)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if (debouncedSearch !== search) {
        setDebouncedSearch(search)
        setSearchEpoch((e) => e + 1)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [search, debouncedSearch])

  // header global search → this workspace (epoch-guarded so mount doesn't clobber)
  useEffect(() => {
    if (misSearchEpoch > 0) setSearch(misSearch)
  }, [misSearchEpoch, misSearch])

  // refresh grid when refreshEpoch changes (realtime "Refresh view")
  useEffect(() => {
    if (refreshEpoch > 0) gridApiRef.current?.refreshInfiniteCache()
  }, [refreshEpoch])

  const chips = useMemo(() => filterChips(filterModel, fields), [filterModel, fields])
  const canEdit = user ? can(user.role, 'records:edit' as never) : false
  const canDelete = user ? can(user.role, 'records:delete' as never) : false
  const canExport = user ? can(user.role, 'excel:export' as never) : false
  const canCreate = user ? can(user.role, 'records:create' as never) : false

  // ------------------------------------------------------------------
  // inline cell save — routes Excel-style formulas to the formula engine
  // (`formulas` payload) and plain values to `values` (clearing any
  // formula the cell had, exactly like overwriting a formula in Excel)
  // ------------------------------------------------------------------
  const handleCellSave = useCallback(async (req: CellSaveRequest) => {
    if (!user) return
    const formula = isFormulaText(req.newValue)
    const hadFormula = !!(req.record as MisRecordDto)._formulas?.[req.fieldKey]
    const body: Record<string, unknown> = { version: req.record.version }
    if (formula) {
      body.formulas = { [req.fieldKey]: String(req.newValue).trim() }
    } else {
      body.values = { [req.fieldKey]: req.newValue }
      if (hadFormula) body.formulas = { [req.fieldKey]: null }
    }
    const fieldName = fields.find((f) => f.fieldKey === req.fieldKey)?.displayName ?? req.fieldKey
    setSaveState('saving')
    try {
      const { record } = await apiPatch<{ record: MisRecordDto }>(`/api/records/${req.record.id}`, body)
      req.applyServerRecord(record)
      setSelectedCell((s) => (s && s.record.id === record.id ? { ...s, record } : s))
      setSaveState('saved')
      if (formula) {
        const err = record._formulaErrors?.[req.fieldKey]
        if (err) {
          toast.warning(`${fieldName}: ${err.code}`, { description: err.message })
        } else {
          toast.success('Formula saved', {
            description: `LR ${record.lrNo ?? '—'} · ${fieldName} = ${record[req.fieldKey] ?? '—'}`,
          })
        }
      }
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) {
      req.revert()
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
      if (err instanceof ApiClientError && err.code === 'VERSION_CONFLICT') {
        setConflictCurrent((err.data as { current?: MisRecordDto } | undefined)?.current ?? null)
        setConflictAttempted({ [req.fieldKey]: req.newValue })
        setConflictRecordId(req.record.id)
        setConflictOpen(true)
      } else {
        toast.error('Unable to save', {
          description: err instanceof ApiClientError ? err.message : 'Please check your connection and retry.',
        })
      }
    }
  }, [user, fields])

  // ------------------------------------------------------------------
  // formula bar commits (same save path as inline grid editing)
  // ------------------------------------------------------------------
  const handleFormulaBarCommit = useCallback((fieldKey: string, text: string) => {
    const sel = selectedCell
    if (!sel || !user) return
    const record = sel.record
    void handleCellSave({
      record,
      fieldKey,
      oldValue: record[fieldKey],
      newValue: text === '' ? null : text,
      applyServerRecord: (rec) => {
        gridApiRef.current?.getRowNode(rec.id)?.setData(rec)
      },
      revert: () => { /* the grid row was not touched — nothing to undo */ },
    })
  }, [selectedCell, user, handleCellSave])

  // ------------------------------------------------------------------
  // export currently filtered data
  // ------------------------------------------------------------------
  const currentSortModel = useCallback(() => {
    const api = gridApiRef.current
    if (!api) return []
    return api.getColumnState()
      .filter((c) => c.sort)
      .sort((a, b) => (a.sortIndex ?? 99) - (b.sortIndex ?? 99))
      .map((c) => ({ colId: c.colId, sort: c.sort as 'asc' | 'desc' }))
  }, [])

  const doExport = async () => {
    setExporting(true)
    try {
      const { fileName } = await apiDownload('/api/export', {
        search: debouncedSearch || undefined,
        filterModel: Object.keys(filterModel).length > 0 ? filterModel : undefined,
        sortModel: currentSortModel(),
        includeSummary,
      }, `MIS_Export_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`)
      toast.success(`Exported ${total.toLocaleString('en-IN')} record${total === 1 ? '' : 's'}`, {
        description: `${fileName} downloaded — the file includes SYS ID/version columns for safe re-import.`,
      })
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof ApiClientError ? err.message : 'Please try again.',
      })
    } finally {
      setExporting(false)
    }
  }

  // ------------------------------------------------------------------
  // structured filter panel → grid filter instances
  // ------------------------------------------------------------------
  const setGridFilter = (key: string, model: Record<string, unknown> | null) => {
    const api = gridApiRef.current
    if (!api || typeof api.setFilterModel !== 'function') return
    // AG Grid v36 removed getFilterInstance — compose the whole model instead:
    // merge this column's filter into the current model (or drop it on null).
    const current = (typeof api.getFilterModel === 'function' ? api.getFilterModel() : {}) as Record<string, Record<string, unknown>>
    const next = { ...(current || {}) }
    if (model == null) delete next[key]
    else next[key] = model
    api.setFilterModel(Object.keys(next).length > 0 ? next : null)
    api.onFilterChanged()
  }

  const [lrDateFrom, setLrDateFrom] = useState<Date | undefined>()
  const [lrDateTo, setLrDateTo] = useState<Date | undefined>()
  const [fromCalOpen, setFromCalOpen] = useState(false)
  const [toCalOpen, setToCalOpen] = useState(false)
  const [fDest, setFDest] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fLoad, setFLoad] = useState('')
  const [partySearch, setPartySearch] = useState('')

  const applyStructuredFilters = () => {
    // LR date range
    if (lrDateFrom || lrDateTo) {
      setGridFilter('lrDate', {
        filterType: 'date', type: 'inRange',
        dateFrom: lrDateFrom ? format(lrDateFrom, 'yyyy-MM-dd') : '2000-01-01',
        dateTo: lrDateTo ? format(lrDateTo, 'yyyy-MM-dd') : '2100-01-01',
      })
    } else {
      setGridFilter('lrDate', null)
    }
    setGridFilter('destination', fDest ? { filterType: 'text', type: 'equals', filter: fDest } : null)
    setGridFilter('deliveryStatus', fStatus ? { filterType: 'text', type: 'equals', filter: fStatus } : null)
    setGridFilter('loadType', fLoad ? { filterType: 'text', type: 'equals', filter: fLoad } : null)
    setGridFilter('partyName', partySearch ? { filterType: 'text', type: 'contains', filter: partySearch } : null)
    toast.success('Filters applied', { description: 'The table now shows only matching records.' })
  }

  const clearAllFilters = () => {
    setLrDateFrom(undefined); setLrDateTo(undefined)
    setFromCalOpen(false); setToCalOpen(false)
    setFDest(''); setFStatus(''); setFLoad(''); setPartySearch('')
    gridApiRef.current?.setFilterModel(null)
    setSearch('')
    toast('Filters cleared')
  }

  const removeChip = (key: string, value: string) => {
    const model = filterModel[key]
    if (!model) return
    if (Array.isArray(model.conditions)) {
      const keep = (model.conditions as Array<Record<string, unknown>>).filter((c) => {
        if (c.filterType === 'date') return !(String(c.dateFrom || '').startsWith(value.slice(0, 10)) || value.includes(fmtDate(String(c.dateFrom || ''))))
        return String(c.filter) !== value
      })
      setGridFilter(key, keep.length === 0 ? null : keep.length === 1 ? keep[0] : { ...model, conditions: keep })
    } else {
      setGridFilter(key, null)
      if (key === 'destination') setFDest('')
      if (key === 'deliveryStatus') setFStatus('')
      if (key === 'loadType') setFLoad('')
      if (key === 'partyName') setPartySearch('')
    }
  }

  // ------------------------------------------------------------------
  // delete selected
  // ------------------------------------------------------------------
  const selectedRows = (): MisRecordDto[] => {
    const api = gridApiRef.current
    if (!api) return []
    return api.getSelectedNodes().map((n) => n.data as MisRecordDto).filter(Boolean)
  }

  const doDelete = async () => {
    const rows = selectedRows()
    if (rows.length === 0) return
    setDeleting(true)
    let failed = 0
    for (const r of rows) {
      try {
        await apiDelete(`/api/records/${r.id}`)
      } catch { failed++ }
    }
    setDeleting(false)
    setDeleteOpen(false)
    if (failed === 0) {
      toast.success(`Deleted ${rows.length} record${rows.length === 1 ? '' : 's'}`, { description: 'Deletions are soft — fully auditable in the Audit Log.' })
    } else {
      toast.warning(`Deleted ${rows.length - failed}, failed ${failed}`, { description: 'Some records may have been changed or removed by others.' })
    }
    gridApiRef.current?.refreshInfiniteCache()
    gridApiRef.current?.deselectAll()
  }

  const openEditSelected = () => {
    const rows = selectedRows()
    if (rows.length !== 1) return
    setEditingRecord(rows[0])
    setFormOpen(true)
  }

  // ------------------------------------------------------------------
  // column visibility
  // ------------------------------------------------------------------
  const toggleColumn = (colId: string, visible: boolean) => {
    const api = gridApiRef.current
    if (!api) return

    api.setColumnsVisible([colId], visible)
    setColumnVisibilityVersion((version) => version + 1)
  }
  const columnList = useMemo(() => {
    const api = gridApiRef.current
    if (!api) return []
    return api.getColumnState()
      // hide AG Grid's auto-generated internal columns (selection checkbox
      // column "ag-Grid-SelectionColumn") from the visibility menu — they are
      // not user data columns and cannot be meaningfully toggled
      .filter((c) => !c.colId.startsWith('ag-Grid-'))
      .map((c) => ({ colId: c.colId, visible: !c.hide }))
  }, [total, columnVisibilityVersion])
  const displayNameOf = (colId: string) => fields.find((f) => f.fieldKey === colId)?.displayName
    || (colId === 'srNo' ? 'Sr. No.' : colId === 'updatedAt' ? 'Last Updated' : colId === 'updatedBy' ? 'Updated By' : colId)

  // destination options from field registry
  const destinationOptions = useMemo(() => fields.find((f) => f.fieldKey === 'destination')?.options || [], [fields])
  void destinationOptions // free-text destination (94 distinct) — combobox handled by party
  const statusOptions = fields.find((f) => f.fieldKey === 'deliveryStatus')?.options || []

  return (
    <div className="flex h-full flex-col gap-3 p-4 lg:p-5">
      {/* ---------------- workspace context strip ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold/40 bg-brand-gold/10 px-2.5 py-1 text-[11px] font-medium text-brand-brown dark:text-brand-gold">
            <Database className="h-3 w-3" />
            Single source of truth
            <span className="drona-live-dot ml-0.5 h-1.5 w-1.5 rounded-full bg-brand-gold" aria-hidden />
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {total === 0 ? '—' : total.toLocaleString('en-IN')} records in the centralized database
          </span>
        </div>
        <span className="hidden text-[11px] text-muted-foreground lg:block">
          Excel-native: <span className="font-medium text-foreground">=formulas</span> · fill-down · copy-paste · undo/redo
        </span>
      </div>
      <RouteDivider className="text-foreground opacity-60" />

      {/* ---------------- toolbar ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {/* search */}
        <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search LR no, invoice, party, destination, transporter…"
            className="pl-9 pr-8"
            aria-label="Search records"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* structured filters */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-1.5">
              <Filter className="h-4 w-4" />
              Filters
              {chips.length > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
                  {chips.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[340px]">
            <div className="space-y-3.5">
              <div>
                <Label className="text-xs text-muted-foreground">LR Date range</Label>
                {/* each picker sits in a shrinkable flex-1 wrapper: the shadcn Button
                    base carries shrink-0, so a w-full Button as a DIRECT flex child of
                    this row cannot shrink and blows the row out of the popover
                    (From ate the full card width; To rendered ~311px past its edge) */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Popover open={fromCalOpen} onOpenChange={setFromCalOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-full justify-start font-normal">
                          {lrDateFrom ? fmtDate(format(lrDateFrom, 'yyyy-MM-dd')) : 'From'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={lrDateFrom} onSelect={(d) => { setLrDateFrom(d); setFromCalOpen(false) }} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>→</span>
                  <div className="min-w-0 flex-1">
                    <Popover open={toCalOpen} onOpenChange={setToCalOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-full justify-start font-normal">
                          {lrDateTo ? fmtDate(format(lrDateTo, 'yyyy-MM-dd')) : 'To'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={lrDateTo} onSelect={(d) => { setLrDateTo(d); setToCalOpen(false) }} />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Delivery Status</Label>
                  <Select value={fStatus || undefined} onValueChange={setFStatus}>
                    <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>{statusOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Load Type</Label>
                  <Select value={fLoad || undefined} onValueChange={setFLoad}>
                    <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FTL">FTL</SelectItem>
                      <SelectItem value="PTL">PTL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Destination</Label>
                <Input value={fDest} onChange={(e) => setFDest(e.target.value)} placeholder="e.g. Delhi" className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Party contains</Label>
                <Input value={partySearch} onChange={(e) => setPartySearch(e.target.value)} placeholder="e.g. Motors" className="h-8" />
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-8 gap-1.5 text-muted-foreground">
                  <RotateCcw className="h-3.5 w-3.5" /> Clear all
                </Button>
                <Button size="sm" className="h-8" onClick={applyStructuredFilters}>Apply filters</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* columns menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Toggle columns">
              <Columns3 className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="nice-scroll max-h-96 w-56 overflow-y-auto">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columnList.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.colId}
                checked={c.visible}
                onCheckedChange={(v) => toggleColumn(c.colId, !!v)}
                onSelect={(e) => e.preventDefault()}
              >
                {displayNameOf(c.colId)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-2">
          {/* save state pill */}
          {saveState !== 'idle' && (
            <span className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              saveState === 'saving' && 'bg-muted text-muted-foreground',
              saveState === 'saved' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
              saveState === 'error' && 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
            )}>
              {saveState === 'saving' && <Loader2 className="h-3 w-3 animate-spin" />}
              {saveState === 'saved' && <CheckCircle2 className="h-3 w-3" />}
              {saveState === 'error' && <AlertCircle className="h-3 w-3" />}
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Unable to save'}
            </span>
          )}

          {selectionCount === 1 && canEdit && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openEditSelected}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
          {selectionCount > 0 && canDelete && (
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete{selectionCount > 1 ? ` ${selectionCount}` : ''}
            </Button>
          )}

          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 border-brand-gold/60 bg-brand-gold/12 text-[#8A5B0F] hover:bg-brand-gold/20 hover:text-[#70421F] dark:border-brand-gold/45 dark:bg-brand-gold/12 dark:text-brand-gold dark:hover:bg-brand-gold/20" disabled={exporting || total === 0}>
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Export {total === 0 ? '—' : `${total.toLocaleString('en-IN')}`} Record{total === 1 ? '' : 's'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" /> Include Summary sheet
                  </span>
                  <Switch checked={includeSummary} onCheckedChange={setIncludeSummary} aria-label="Include Summary sheet" />
                </div>
                <DropdownMenuSeparator />
                <p className="px-2 pb-1.5 pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Exports exactly the {total.toLocaleString('en-IN')} record{total === 1 ? '' : 's'} matching your current filters and search — in the company MIS format.
                </p>
                <DropdownMenuSeparator />
                <div className="p-1">
                  {/* DropdownMenuItem so the menu CLOSES on download (standard menu UX —
                      a plain Button inside the content leaves the menu open) */}
                  <DropdownMenuItem
                    onSelect={() => { void doExport() }}
                    disabled={exporting}
                    className="h-9 w-full cursor-pointer justify-center gap-1.5 rounded-md bg-brand-gold text-[13px] font-semibold text-[#252525] transition-colors hover:bg-brand-gold/90 focus:bg-brand-gold/90 focus:text-[#252525] dark:bg-brand-gold dark:text-[#252525] dark:focus:text-[#252525] data-[disabled]:opacity-50"
                  >
                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Download .xlsx
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {canCreate && (
            <Button size="sm" className="gap-1.5 font-semibold" onClick={() => { setEditingRecord(null); setFormOpen(true) }}>
              <Plus className="h-4 w-4" /> Add MIS Entry
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- filter chips ---------------- */}
      {(chips.length > 0 || debouncedSearch) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {debouncedSearch && (
            <span className="filter-chip">
              Search: “{debouncedSearch}”
              <button onClick={() => setSearch('')} aria-label="Clear search" className="rounded-full p-0.5 hover:bg-accent"><X className="h-3 w-3" /></button>
            </span>
          )}
          {chips.map((c, i) => (
            <span key={`${c.key}-${i}`} className="filter-chip">
              <span className="text-muted-foreground">{c.label}:</span> {c.value}
              <button onClick={() => removeChip(c.key, c.value)} aria-label={`Remove filter ${c.label}`} className="rounded-full p-0.5 hover:bg-accent">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button onClick={clearAllFilters} className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
            clear all
          </button>
        </div>
      )}

      {/* ---------------- formula bar ---------------- */}
      <FormulaBar
        selected={selectedCell}
        fields={fields}
        canEdit={canEdit}
        saving={saveState === 'saving'}
        onCommit={handleFormulaBarCommit}
      />

      {/* ---------------- grid ---------------- */}
      <div className="ag-wrap min-h-[420px] flex-1">
        {fieldsLoading ? (
          <div className="flex h-full items-center justify-center rounded-lg border bg-card">
            <div className="flex flex-col items-center gap-3 py-24">
              <div className="flex h-6 w-6 items-center justify-center">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-red border-t-transparent" />
              </div>
              <p className="text-sm text-muted-foreground">Loading MIS schema…</p>
            </div>
          </div>
        ) : (
          <MisGrid
            search={debouncedSearch}
            onTotalChange={setTotal}
            onSelectionChange={setSelectionCount}
            onCellSave={handleCellSave}
            onFilterModelChange={setFilterModel}
            onSelectedCell={setSelectedCell}
            onRangeInfo={setRangeInfo}
            externalSearchEpoch={searchEpoch + refreshEpoch}
            apiRef={gridApiRef}
          />
        )}
      </div>

      {/* ---------------- footer status ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2.5 text-xs text-muted-foreground">
        <span>
          Showing <span className="font-semibold text-foreground">{total === 0 ? '0' : total.toLocaleString('en-IN')}</span> of{' '}
          <span className="font-semibold text-foreground">{total.toLocaleString('en-IN')}</span> record{total === 1 ? '' : 's'}
          {chips.length > 0 || debouncedSearch ? ' (filtered)' : ''}
        </span>
        {selectionCount > 0 && <span>{selectionCount} selected</span>}
        {rangeInfo && <span className="font-medium text-brand-red dark:text-brand-gold">{rangeInfo}</span>}
        <span className="ml-auto hidden lg:block">
          Drag to select · Ctrl+C/V copy-paste · drag the corner square to fill · Ctrl+D fill down · Ctrl+Z undo · =Bucket*3 formulas
        </span>
      </div>

      {/* ---------------- dialogs ---------------- */}
      <RecordFormDialog
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditingRecord(null) }}
        fields={fields}
        record={editingRecord}
        user={user!}
        onSaved={(rec) => {
          gridApiRef.current?.refreshInfiniteCache()
          void rec
        }}
        onConflict={(current, attempted) => {
          setConflictCurrent(current)
          setConflictAttempted(attempted)
          setConflictRecordId(current.id)
          setConflictOpen(true)
        }}
      />

      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        fields={fields}
        current={conflictCurrent}
        attempted={conflictAttempted}
        recordId={conflictRecordId}
        user={user!}
        onResolved={() => gridApiRef.current?.refreshInfiniteCache()}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectionCount} record{selectionCount === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  {selectionCount === 1
                    ? 'This removes the record from the MIS. Deletions are soft and fully audited — they can be traced in the Audit Log.'
                    : 'These records will be removed from the MIS. Deletions are soft and fully audited.'}
                </p>
                {selectedRows().length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selectedRows().slice(0, 5).map((r) => `LR ${r.lrNo ?? '—'}`).join(', ')}
                    {selectedRows().length > 5 ? ` … +${selectedRows().length - 5} more` : ''}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void doDelete() }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
