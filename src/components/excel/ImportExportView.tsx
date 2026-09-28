'use client'

// Import / Export hub — ONE shared Application Sheet selector drives both
// operations. NPL (system sheet) uses the existing importer + full export;
// in-app sheets export dynamically from their SheetColumn/SheetRecord data.
// (Generic import lands in a follow-up step.)
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Loader2, FileSpreadsheet, History, FileUp, FileDown, CheckCircle2, XCircle, Clock3, Sheet as SheetIcon, Info } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/lib/client/store'
import { useSheets } from '@/lib/client/hooks'
import { apiGet, apiDownload } from '@/lib/client/api'
import { can } from '@/lib/rbac'
import ImportWizard from '@/components/excel/ImportWizard'
import { fmtDateTime } from '@/lib/client/format'
import type { ImportApplyResult } from '@/lib/types'

interface ImportJob {
  id: string
  fileName: string
  userName: string | null
  status: string
  stats: { detected: number; new: number; changed: number; unchanged: number; conflicts: number; invalid: number; missing: number } | null
  result: ImportApplyResult | null
  createdAt: string
  confirmedAt: string | null
}

export default function ImportExportView() {
  const user = useAppStore((s) => s.user)
  const activeSheet = useAppStore((s) => s.activeSheet)
  const refreshEpoch = useAppStore((s) => s.refreshEpoch)
  const qc = useQueryClient()
  const [exporting, setExporting] = useState(false)
  const canImport = user ? can(user.role, 'excel:import' as never) : false
  const canExport = user ? can(user.role, 'excel:export' as never) : false

  // ---- shared Application Sheet selection (drives BOTH import and export) ----
  const { data: sheetsData } = useSheets()
  const sheets = sheetsData?.sheets ?? []
  const [selectedId, setSelectedId] = useState('')
  // preselect the active/open sheet whenever it changes
  useEffect(() => { if (activeSheet?.id) setSelectedId(activeSheet.id) }, [activeSheet?.id])
  // fallback: first system (NPL) sheet, else first available
  useEffect(() => {
    if (!selectedId && sheets.length) setSelectedId(sheets.find((s) => s.isSystem)?.id || sheets[0].id)
  }, [sheets, selectedId])

  const selectedSheet = sheets.find((s) => s.id === selectedId) || null
  const isNpl = !!selectedSheet?.isSystem
  const canSeeHistory = canImport && isNpl

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['import-jobs', refreshEpoch],
    queryFn: () => apiGet<{ jobs: ImportJob[] }>('/api/import/jobs'),
    enabled: canSeeHistory,
  })

  const exportSelected = async () => {
    if (!selectedSheet) return
    setExporting(true)
    try {
      if (isNpl) {
        // NPL — the full company workbook (POST /api/export downloads via helper)
        const { fileName } = await apiDownload('/api/export', { includeSummary: true }, 'MIS_Full_Export.xlsx')
        toast.success('Full MIS exported', { description: `${fileName} — includes live Summary sheet + SYS columns for re-import.` })
        qc.invalidateQueries({ queryKey: ['import-jobs'] })
      } else {
        // generic sheet — dynamic export from SheetColumn/SheetRecord (GET download)
        const anchor = document.createElement('a')
        anchor.href = `/api/sheets/${selectedSheet.id}/export`
        anchor.download = `${selectedSheet.name}.xlsx`
        anchor.click()
        toast.success('Export started', { description: `Exporting "${selectedSheet.name}".` })
      }
    } catch {
      toast.error('Export failed', { description: 'Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5 p-4 lg:p-5">
      {/* ---- shared Sheet selector ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <div className="flex items-center gap-2">
            <SheetIcon className="h-4 w-4 text-brand-red" />
            <span className="text-[13px] font-medium">MIS Sheet</span>
          </div>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Select a sheet…" /></SelectTrigger>
            <SelectContent>
              {sheets.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[12px] text-muted-foreground">
            Import and Export below both target the selected sheet.
          </span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* ---- import (main column) ---- */}
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <FileUp className="h-4 w-4 text-primary" /> Import Excel
                {selectedSheet && <Badge variant="secondary" className="ml-1">{selectedSheet.name}</Badge>}
              </CardTitle>
              <CardDescription>
                {isNpl
                  ? 'Upload a workbook exported from this portal. The system previews new, changed, conflicting, invalid and missing records before anything is saved.'
                  : 'The selected sheet is the import destination — Excel worksheet names never decide the target.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!canImport ? (
                <p className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                  Your role does not include Excel import permission.
                </p>
              ) : isNpl ? (
                <ImportWizard onFinished={() => qc.invalidateQueries({ queryKey: ['import-jobs'] })} />
              ) : (
                <div className="rounded-lg border bg-muted/30 px-4 py-8 text-center">
                  <Info className="mx-auto h-6 w-6 text-brand-gold" />
                  <p className="mt-2 text-sm font-medium">Import into “{selectedSheet?.name}” is coming next</p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                    Import for in-app sheets (multi-sheet detection → this sheet’s columns → preview → confirm)
                    will write to this sheet’s own records. It’s the next step; export already works below.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---- side column ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <FileDown className="h-4 w-4 text-primary" /> Export Excel
                {selectedSheet && <Badge variant="secondary" className="ml-1">{selectedSheet.name}</Badge>}
              </CardTitle>
              <CardDescription>
                {isNpl
                  ? 'Export the full company workbook (MIS + live Summary + SYS columns). For filtered exports, use the Export button in the MIS view.'
                  : 'Exports only this sheet’s records, using its own column order, names and types.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={exportSelected} disabled={exporting || !canExport || !selectedSheet} className="w-full gap-1.5">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isNpl ? 'Export full MIS workbook' : `Export “${selectedSheet?.name ?? 'sheet'}”`}
              </Button>
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                {isNpl
                  ? 'Preserves the company MIS format, live Summary sheet and SYS_RECORD_ID / SYS_VERSION columns for safe round-trip imports.'
                  : 'A Sr. No. column is added for readability only — it is never a stored field.'}
              </p>
            </CardContent>
          </Card>

          {/* import history (NPL only) */}
          {canSeeHistory && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-[15px]">
                  <History className="h-4 w-4 text-primary" /> Import history
                </CardTitle>
                <CardDescription>Recent NPL import jobs and their outcomes</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {jobsLoading ? (
                  <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
                ) : (jobsData?.jobs?.length ?? 0) === 0 ? (
                  <p className="px-4 pb-5 pt-2 text-center text-sm text-muted-foreground">No imports yet.</p>
                ) : (
                  <ul className="nice-scroll max-h-[380px] divide-y overflow-y-auto">
                    {jobsData!.jobs.map((j) => (
                      <li key={j.id} className="flex items-start gap-3 px-4 py-3">
                        <div className="mt-0.5">
                          {j.status === 'CONFIRMED' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : j.status === 'PREVIEW' ? (
                            <Clock3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {j.fileName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {j.userName || '—'} • {fmtDateTime(j.createdAt)}
                            {j.stats ? ` • ${j.stats.detected} rows` : ''}
                          </p>
                          {j.result && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              <Badge variant="secondary" className="mr-1 h-4 px-1.5 text-[10px]">applied</Badge>
                              {j.result.created} created • {j.result.updated} updated • {j.result.deleted} deleted
                              {j.result.skipped > 0 ? ` • ${j.result.skipped} skipped` : ''}
                            </p>
                          )}
                          {j.status === 'PREVIEW' && (
                            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Previewed but not confirmed</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
