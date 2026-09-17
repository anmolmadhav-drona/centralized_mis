'use client'

// MIS data grid — AG Grid Community, infinite row model (server-side
// pagination / sorting / filtering), dynamic columns from the field registry,
// inline editing with optimistic concurrency, plus the Excel interaction
// layer (range selection / clipboard / fill handle / undo-redo).
import { useCallback, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type GridReadyEvent, type CellValueChangedEvent, type CellEditingStartedEvent, type CellClickedEvent, type IGetRowsParams } from 'ag-grid-community'
import { useTheme } from 'next-themes'
import { useAppStore } from '@/lib/client/store'
import { useFields } from '@/lib/client/hooks'
import { buildColumnDefs } from '@/components/mis/gridColumns'
import { agLightTheme, agDarkTheme } from '@/components/mis/gridTheme'
import { ExcelGridController, type BulkResultItem, type CellOp } from '@/components/mis/excelGrid'
import { toast } from 'sonner'
import { apiPost, ApiClientError } from '@/lib/client/api'
import type { FieldDef, MisRecordDto, SortItem } from '@/lib/types'

ModuleRegistry.registerModules([AllCommunityModule])

const COL_STATE_KEY = 'npl-mis-colstate-v2'

export interface CellSaveRequest {
  record: MisRecordDto
  fieldKey: string
  oldValue: unknown
  newValue: unknown
  applyServerRecord: (rec: MisRecordDto) => void
  revert: () => void
}

/** currently focused grid cell (drives the formula bar) */
export interface SelectedCell {
  record: MisRecordDto
  fieldKey: string
}

interface MisGridProps {
  search: string
  onTotalChange: (total: number) => void
  onSelectionChange: (count: number) => void
  onCellSave: (req: CellSaveRequest) => void
  onFilterModelChange: (model: Record<string, Record<string, unknown>>) => void
  onSelectedCell?: (sel: SelectedCell | null) => void
  onRangeInfo?: (info: string | null) => void
  externalSearchEpoch: number
  apiRef: React.MutableRefObject<GridApi | null>
}

export default function MisGrid({ search, onTotalChange, onSelectionChange, onCellSave, onFilterModelChange, onSelectedCell, onRangeInfo, externalSearchEpoch, apiRef }: MisGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const excelRef = useRef<ExcelGridController | null>(null)
  const { data: fieldsData } = useFields()
  const user = useAppStore((s) => s.user)
  const { resolvedTheme } = useTheme()
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  const fields = fieldsData?.fields || []
  const canEdit = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'USER'

  const columnDefs = buildColumnDefs(fields, { canEdit })

  // ---------- server-side datasource ----------
  const makeDatasource = useCallback(() => ({
    getRows: async (params: IGetRowsParams) => {
      try {
        const rawSort = (params as unknown as { sortModel?: unknown }).sortModel
        const rawFilter = (params as unknown as { filterModel?: unknown }).filterModel
        const sortModel = (typeof rawSort === 'function' ? (rawSort as () => SortItem[])() : rawSort || []) as SortItem[]
        const filterModel = (typeof rawFilter === 'function' ? (rawFilter as () => Record<string, unknown>)() : rawFilter || {}) as Record<string, unknown>
        const qs = new URLSearchParams({
          start: String(params.startRow),
          end: String(params.endRow),
        })
        const s = searchRef.current.trim()
        if (s) qs.set('search', s)
        if (filterModel && Object.keys(filterModel).length > 0) qs.set('filter', JSON.stringify(filterModel))
        if (sortModel && sortModel.length > 0) qs.set('sort', JSON.stringify(sortModel))

        const res = await fetch(`/api/records?${qs.toString()}`, { credentials: 'same-origin' })
        if (!res.ok) {
          params.failCallback()
          return
        }
        const body = (await res.json()) as { rows: MisRecordDto[]; total: number }
        onTotalChange(body.total)
        params.successCallback(body.rows, body.total)
      } catch {
        params.failCallback()
      }
    },
  }), [onTotalChange])

  // (re)set datasource when search / schema / refresh epoch changes
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.setGridOption('datasource', makeDatasource())
  }, [makeDatasource, externalSearchEpoch, fields.length])

  // ---------- events ----------
  // rebind AG Grid event hooks when the grid (re)initialises
  const onGridReadyExcel = useCallback((api: GridApi) => {
    excelRef.current?.hookApi(api)
  }, [])

  const onGridReady = useCallback((e: GridReadyEvent) => {
    apiRef.current = e.api
    ;(window as unknown as Record<string, unknown>).__misApi = e.api
    onGridReadyExcel(e.api)
    // restore persisted column state (order / width / visibility / pins)
    try {
      const saved = localStorage.getItem(COL_STATE_KEY)
      if (saved) {
        const state = JSON.parse(saved) as import('ag-grid-community').ColumnState[]
        e.api.applyColumnState({ state, applyOrder: true })
      }
    } catch { /* ignore corrupt state */ }
    e.api.setGridOption('datasource', makeDatasource())
  }, [makeDatasource, apiRef, onGridReadyExcel])

  // persist column state (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onColumnChanged = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const api = apiRef.current
      if (!api) return
      try {
        const state = api.getColumnState().map((c) => ({
          colId: c.colId, hide: c.hide, width: c.width, pinned: c.pinned, sortIndex: c.sortIndex,
        }))
        localStorage.setItem(COL_STATE_KEY, JSON.stringify(state))
      } catch { /* ignore */ }
    }, 500)
  }

  // pre-edit snapshots so a failed save reverts the ACTUAL old value
  // (AG Grid writes the new value into row data before onCellValueChanged fires)
  const editSnapshots = useRef(new Map<string, MisRecordDto>())

  const onCellEditingStarted = useCallback((e: CellEditingStartedEvent) => {
    const fieldKey = e.colDef.field
    if (!fieldKey || !e.data) return
    editSnapshots.current.set(`${e.node?.id ?? ''}:${fieldKey}`, { ...(e.data as MisRecordDto) })
  }, [])

  const onCellValueChanged = useCallback((e: CellValueChangedEvent) => {
    if (e.colDef.colId === 'srNo' || e.colDef.colId === 'updatedAt' || e.colDef.colId === 'updatedBy') return
    const fieldKey = e.colDef.field
    if (!fieldKey) return
    const snapshotKey = `${e.node?.id ?? ''}:${fieldKey}`
    const snapshot = editSnapshots.current.get(snapshotKey) ?? { ...(e.data as MisRecordDto) }
    onCellSave({
      record: e.data as MisRecordDto,
      fieldKey,
      oldValue: e.oldValue,
      newValue: e.newValue,
      applyServerRecord: (rec) => {
        e.node?.setData(rec)
        editSnapshots.current.delete(snapshotKey)
      },
      revert: () => {
        e.node?.setData(snapshot)
        editSnapshots.current.delete(snapshotKey)
      },
    })
  }, [onCellSave])

  // selected cell → formula bar
  const onCellClicked = useCallback((e: CellClickedEvent) => {
    const fieldKey = e.colDef.field
    if (!onSelectedCell) return
    if (!fieldKey || !e.data) { onSelectedCell(null); return }
    onSelectedCell({ record: e.data as MisRecordDto, fieldKey })
  }, [onSelectedCell])

  // ------------------------------------------------------------------
  // Excel interaction layer — range selection, clipboard, fill handle,
  // fill-down/right, clear, undo/redo. All mutations go through the bulk
  // endpoint (one POST, per-record optimistic guards, in-place row updates).
  // ------------------------------------------------------------------
  const canEditRef = useRef(canEdit)
  useEffect(() => { canEditRef.current = canEdit })
  const fieldsRef = useRef<FieldDef[]>(fields)
  useEffect(() => { fieldsRef.current = fields })

  const bulkApply = useCallback(async (ops: CellOp[], label: string): Promise<BulkResultItem[]> => {
    if (ops.length === 0) return []
    try {
      const res = await apiPost<{ results: BulkResultItem[]; ok: number; conflicts: number }>('/api/records/bulk', {
        changes: ops.map((o) => ({
          id: o.recordId,
          version: o.version,
          values: o.values ?? {},
          ...(o.formulas ? { formulas: o.formulas } : {}),
        })),
      })
      let okCount = 0
      let conflicts = 0
      let firstError: string | null = null
      for (const r of res.results) {
        if (r.ok && r.record) {
          okCount++
          apiRef.current?.getRowNode(r.id)?.setData(r.record)
        } else if (r.conflict) {
          conflicts++
          apiRef.current?.getRowNode(r.id)?.setData(r.conflict) // show the other user's state
        } else if (r.error && !firstError) {
          firstError = r.error
        }
      }
      if (okCount > 0) {
        toast.success(`${label}: ${okCount} row${okCount === 1 ? '' : 's'} saved`, {
          description: conflicts > 0
            ? `${conflicts} row${conflicts === 1 ? ' was' : 's were'} changed by someone else — their version is shown. You can redo the ${label.toLowerCase()} on top.`
            : firstError ? `${res.results.length - okCount - conflicts} row(s) skipped — ${firstError}` : undefined,
        })
      } else if (conflicts > 0 || firstError) {
        toast.error(`${label} failed`, {
          description: conflicts > 0 ? `${conflicts} row conflict(s) — the grid now shows the latest values.` : (firstError ?? undefined),
        })
      }
      return res.results
    } catch (err) {
      toast.error(`${label} failed`, {
        description: err instanceof ApiClientError ? err.message : 'Please check your connection and retry.',
      })
      return []
    }
  }, [apiRef])

  // mount / unmount the controller once the host element exists
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ctrl = new ExcelGridController({
      api: () => apiRef.current,
      host: () => hostRef.current,
      fields: () => fieldsRef.current,
      canEdit: () => canEditRef.current,
      bulk: bulkApply,
      notify: (message, description) => { toast(message, { description }) },
      onInfo: (info) => onRangeInfo?.(info),
    })
    excelRef.current = ctrl
    ctrl.attach()
    if (apiRef.current) ctrl.hookApi(apiRef.current)
    return () => {
      ctrl.destroy()
      excelRef.current = null
    }
  }, [])

  // ------------------------------------------------------------------

  const onSelectionChanged = useCallback(() => {
    onSelectionChange(apiRef.current?.getSelectedNodes().length || 0)
  }, [onSelectionChange, apiRef])

  const onFilterChanged = useCallback(() => {
    const model = (typeof apiRef.current?.getFilterModel === 'function'
      ? apiRef.current.getFilterModel()
      : {}) as Record<string, Record<string, unknown>>
    onFilterModelChange(model || {})
  }, [onFilterModelChange, apiRef])

  // expose refresh + grid api for parent (toolbar / programmatic control)
  useEffect(() => {
    const handler = () => apiRef.current?.refreshInfiniteCache()
    ;(window as unknown as Record<string, unknown>).__misRefresh = handler
    return () => { delete (window as unknown as Record<string, unknown>).__misRefresh }
  }, [apiRef])

  const defaultColDef: ColDef = {
    sortable: true,
    resizable: true,
    filter: true,
    floatingFilter: true,
    minWidth: 90,
  }

  return (
    <div className="ag-wrap rounded-lg border bg-card">
      <div className="ag-theme-flex" ref={hostRef}>
        <AgGridReact
          ref={gridRef}
          theme={resolvedTheme === 'dark' ? agDarkTheme : agLightTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowModelType="infinite"
          getRowId={(p) => String((p.data as MisRecordDto)?.id ?? Math.random())}
          cacheBlockSize={100}
          cacheOverflowSize={2}
          maxConcurrentDatasourceRequests={2}
          infiniteInitialRowCount={1}
          rowSelection={{ mode: 'multiRow', checkboxes: true, enableClickSelection: false }}
          suppressDragLeaveHidesColumns
          onGridReady={onGridReady}
          onColumnEverythingChanged={onColumnChanged}
          onCellEditingStarted={onCellEditingStarted}
          onCellValueChanged={onCellValueChanged}
          onCellClicked={onCellClicked}
          onSelectionChanged={onSelectionChanged}
          onFilterChanged={onFilterChanged}
          overlayLoadingTemplate='<span class="flex items-center gap-2 text-muted-foreground"><span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>Loading records…</span>'
          overlayNoRowsTemplate='<span class="text-muted-foreground">No records match the current filters.</span>'
        />
      </div>
    </div>
  )
}

/** imperatively refresh the grid cache (used after dialogs / realtime) */
export function refreshMisGrid() {
  const fn = (window as unknown as Record<string, (() => void) | undefined>).__misRefresh
  fn?.()
}

export type { FieldDef }
