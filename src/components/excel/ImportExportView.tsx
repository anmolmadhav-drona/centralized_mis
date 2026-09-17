'use client'

// Import / Export hub — wizard, export card, import history
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Loader2, FileSpreadsheet, History, FileUp, FileDown, CheckCircle2, XCircle, Clock3 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/lib/client/store'
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
  const refreshEpoch = useAppStore((s) => s.refreshEpoch)
  const qc = useQueryClient()
  const [exporting, setExporting] = useState(false)
  const canImport = user ? can(user.role, 'excel:import' as never) : false
  const canExport = user ? can(user.role, 'excel:export' as never) : false
  const canSeeHistory = canImport

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['import-jobs', refreshEpoch],
    queryFn: () => apiGet<{ jobs: ImportJob[] }>('/api/import/jobs'),
    enabled: canSeeHistory,
  })

  const exportAll = async () => {
    setExporting(true)
    try {
      const { fileName } = await apiDownload('/api/export', { includeSummary: true }, 'MIS_Full_Export.xlsx')
      toast.success('Full MIS exported', { description: `${fileName} — includes live Summary sheet + SYS columns for re-import.` })
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
    } catch {
      toast.error('Export failed', { description: 'Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 p-4 lg:p-5 xl:grid-cols-3">
      {/* ---- import wizard (main column) ---- */}
      <div className="space-y-4 xl:col-span-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <FileUp className="h-4 w-4 text-primary" /> Import Excel
            </CardTitle>
            <CardDescription>
              Upload a workbook previously exported from this portal. The system detects new, changed,
              conflicting, invalid and missing records — and shows you a full preview before anything is saved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canImport ? (
              <ImportWizard onFinished={() => qc.invalidateQueries({ queryKey: ['import-jobs'] })} />
            ) : (
              <p className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                Your role does not include Excel import permission.
              </p>
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
            </CardTitle>
            <CardDescription>
              For filtered exports with the company format, use the <strong>Export</strong> button in the MIS view —
              it exports exactly the rows matching your active filters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={exportAll} disabled={exporting || !canExport} className="w-full gap-1.5">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export full MIS workbook
            </Button>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              The export preserves the company MIS format — column names and order, mm-dd-yy dates, TOTAL row,
              banded table styling — plus a live Summary sheet and SYS_RECORD_ID / SYS_VERSION columns for safe round-trip imports.
            </p>
          </CardContent>
        </Card>

        {/* import history */}
        {canSeeHistory && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <History className="h-4 w-4 text-primary" /> Import history
              </CardTitle>
              <CardDescription>Recent import jobs and their outcomes</CardDescription>
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
  )
}
