'use client'

// Generic Sheet runtime — a fully definition-driven MIS workspace for any
// in-app sheet. It knows nothing about specific sheets: it loads the sheet's
// SheetColumn[] and SheetRecord[] by id and builds the grid + CRUD from that
// metadata. NPL is NOT rendered here (it uses the dedicated MisView).
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, type ColDef, type CellValueChangedEvent, type SelectionChangedEvent, type GridApi, type GridReadyEvent } from 'ag-grid-community'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Plus, Trash2, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { agLightTheme, agDarkTheme } from '@/components/mis/gridTheme'
import { useAppStore } from '@/lib/client/store'
import { can } from '@/lib/rbac'
import { apiGet, apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/client/api'
import SheetRecordFormDialog from '@/components/sheets/SheetRecordFormDialog'
import type { SheetColumnDto, SheetRecordDto } from '@/lib/types'

ModuleRegistry.registerModules([AllCommunityModule])

interface GridRow {
  __id: string
  __version: number
  [k: string]: unknown
}

function cellDataTypeFor(dataType: string): 'text' | 'number' | 'boolean' {
  if (dataType === 'INTEGER' || dataType === 'DECIMAL') return 'number'
  if (dataType === 'BOOLEAN') return 'boolean'
  return 'text'
}

export default function SheetWorkspaceView() {
  const activeSheet = useAppStore((s) => s.activeSheet)
  const user = useAppStore((s) => s.user)
  const { theme } = useTheme()
  const qc = useQueryClient()
  const [gridApi, setGridApi] = useState<GridApi | null>(null)
  const [selectedCount, setSelectedCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const sheetId = activeSheet?.id ?? ''
  const canEdit = user ? can(user.role, 'records:edit') : false
  const canCreate = user ? can(user.role, 'records:create') : false
  const canDelete = user ? can(user.role, 'records:delete') : false

  const metaQuery = useQuery({
    queryKey: ['sheet', sheetId],
    queryFn: () => apiGet<{ sheet: { id: string; name: string }; columns: SheetColumnDto[] }>(`/api/sheets/${sheetId}`),
    enabled: !!sheetId,
  })
  const recordsQuery = useQuery({
    queryKey: ['sheet-records', sheetId],
    queryFn: () => apiGet<{ records: SheetRecordDto[] }>(`/api/sheets/${sheetId}/records`),
    enabled: !!sheetId,
  })

  const columns = metaQuery.data?.columns ?? []
  const records = recordsQuery.data?.records ?? []

  const colDefs = useMemo<ColDef<GridRow>[]>(() => {
    const defs: ColDef<GridRow>[] = columns.map((c) => ({
      field: c.fieldKey,
      headerName: c.displayName,
      editable: canEdit,
      sortable: true,
      filter: true,
      resizable: true,
      cellDataType: cellDataTypeFor(c.dataType),
      minWidth: 140,
      flex: 1,
    }))
    if (canDelete) {
      defs.unshift({
        colId: '__select',
        headerName: '',
        checkboxSelection: true,
        headerCheckboxSelection: true,
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        pinned: 'left',
        editable: false,
        sortable: false,
        filter: false,
        resizable: false,
      })
    }
    // Sr. No. — display-only, generated from the row's display index. Never part
    // of SheetColumn, SheetRecord.data, or any API/DB payload.
    defs.unshift({
      colId: '__srno',
      headerName: 'Sr. No.',
      valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      width: 80,
      minWidth: 70,
      maxWidth: 90,
      pinned: 'left',
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
    })
    return defs
  }, [columns, canEdit, canDelete])

  const rowData = useMemo<GridRow[]>(
    () => records.map((r) => ({ __id: r.id, __version: r.version, ...r.data })),
    [records],
  )

  const onCellValueChanged = async (e: CellValueChangedEvent<GridRow>) => {
    const field = e.colDef.field
    if (!field) return
    const row = e.data
    try {
      const { record } = await apiPatch<{ record: SheetRecordDto }>(
        `/api/sheets/${sheetId}/records/${row.__id}`,
        { version: row.__version, data: { [field]: e.newValue } },
      )
      // keep the row's version in sync for the next edit (no full refetch)
      e.node.setData({ __id: record.id, __version: record.version, ...record.data })
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Could not save the change.'
      toast.error('Save failed', { description: msg })
      qc.invalidateQueries({ queryKey: ['sheet-records', sheetId] })
    }
  }

  // Add Entry opens a dynamic form (built from SheetColumn[]); a record is
  // created only on Save. No blank row is written up-front.
  const submitEntry = async (data: Record<string, unknown>) => {
    await apiPost(`/api/sheets/${sheetId}/records`, { data })
    await qc.invalidateQueries({ queryKey: ['sheet-records', sheetId] })
    toast.success('Record added')
  }

  const deleteSelected = async () => {
    if (!gridApi) return
    const rows = gridApi.getSelectedRows() as GridRow[]
    if (rows.length === 0) return
    setBusy(true)
    try {
      await Promise.all(rows.map((r) => apiDelete(`/api/sheets/${sheetId}/records/${r.__id}`)))
      await qc.invalidateQueries({ queryKey: ['sheet-records', sheetId] })
      toast.success(`Deleted ${rows.length} row${rows.length === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error('Delete failed', { description: err instanceof ApiClientError ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  if (!activeSheet) return null

  if (metaQuery.isError) {
    return (
      <div className="p-6 text-sm text-destructive">Unable to load this sheet. Please refresh.</div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4 lg:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-brand-red" />
          <h2 className="font-display text-[15px] font-bold tracking-tight">{activeSheet.name}</h2>
          <span className="text-[13px] text-muted-foreground">
            {records.length} record{records.length === 1 ? '' : 's'} · {columns.length} column{columns.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canDelete && selectedCount > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={deleteSelected} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> Delete ({selectedCount})
            </Button>
          )}
          {canCreate && (
            <Button size="sm" className="gap-1.5" onClick={() => setFormOpen(true)} disabled={busy || columns.length === 0}>
              <Plus className="h-3.5 w-3.5" /> Add Entry
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <AgGridReact<GridRow>
          theme={theme === 'dark' ? agDarkTheme : agLightTheme}
          columnDefs={colDefs}
          rowData={rowData}
          getRowId={(p) => p.data.__id}
          rowSelection={canDelete ? 'multiple' : undefined}
          suppressRowClickSelection
          singleClickEdit={false}
          stopEditingWhenCellsLoseFocus
          animateRows
          loading={metaQuery.isLoading || recordsQuery.isLoading}
          onGridReady={(e: GridReadyEvent) => setGridApi(e.api)}
          onCellValueChanged={onCellValueChanged}
          onSelectionChanged={(e: SelectionChangedEvent) => setSelectedCount(e.api.getSelectedRows().length)}
        />
      </div>

      <SheetRecordFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        sheetName={activeSheet.name}
        columns={columns}
        onSubmit={submitEntry}
      />
    </div>
  )
}
