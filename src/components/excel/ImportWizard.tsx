'use client'

// Excel Import Wizard — upload → analyze → preview → resolve → confirm.
// The database is never touched until the user confirms; everything
// is applied in a single transaction server-side.
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Plus, Pencil,
  Ban, Trash2, Search, Loader2, ChevronRight, ChevronDown, Database, FileUp,
  ArrowRight, Undo2, ShieldAlert, Copy, XCircle, Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { apiUpload, apiPost } from '@/lib/client/api'
import { cn } from '@/lib/utils'
import type { ImportPreview, ImportRowAnalysis, ImportApplyResult } from '@/lib/types'

type Step = 'upload' | 'preview' | 'applying' | 'done' | 'error'

export default function ImportWizard({ onFinished }: { onFinished: () => void }) {
  const [step, setStep] = useState<Step>('upload')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportApplyResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  // selections
  const [newRows, setNewRows] = useState<Set<number>>(new Set())
  const [changedRows, setChangedRows] = useState<Set<number>>(new Set())
  const [resolutions, setResolutions] = useState<Record<string, 'mine' | 'theirs'>>({})
  const [deletions, setDeletions] = useState<Set<string>>(new Set())

  const onFile = useCallback(async (file: File) => {
    setUploading(true)
    setError(null)
    setProgress(15)
    try {
      const fd = new FormData()
      fd.append('file', file)
      setProgress(45)
      const data = await apiUpload<ImportPreview>('/api/import/preview', fd)
      setProgress(100)
      setPreview(data)
      setFileName(file.name)
      // default selections: new + changed checked, conflicts default to DB, deletions unchecked
      setNewRows(new Set(data.rows.filter((r) => r.kind === 'NEW').map((r) => r.rowIndex)))
      setChangedRows(new Set(data.rows.filter((r) => r.kind === 'CHANGED').map((r) => r.rowIndex)))
      setResolutions({})
      setDeletions(new Set())
      setStep('preview')
      toast.success('File analyzed', {
        description: `${data.stats.detected} rows detected — review the preview before applying.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze this file.')
      setStep('error')
    } finally {
      setUploading(false)
      setTimeout(() => setProgress(0), 500)
    }
  }, [])

  const reset = () => {
    setStep('upload')
    setPreview(null)
    setResult(null)
    setError(null)
    setFileName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const confirmImport = async () => {
    if (!preview) return
    setConfirming(true)
    setStep('applying')
    try {
      const { result: res } = await apiPost<{ result: ImportApplyResult }>('/api/import/confirm', {
        jobId: preview.jobId,
        resolutions,
        newRows: [...newRows],
        changedRows: [...changedRows],
        deletions: [...deletions],
      })
      setResult(res)
      setStep('done')
      if (res.applied > 0) {
        toast.success(`Import applied — ${res.applied} change${res.applied === 1 ? '' : 's'}`, {
          description: `${res.created} created • ${res.updated} updated • ${res.unchanged} unchanged • ${res.duplicates} duplicate${res.duplicates === 1 ? '' : 's'}`,
        })
      } else {
        toast.info('Nothing to apply', { description: 'No changes were selected.' })
      }
      onFinished()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not be applied.')
      setStep('error')
    } finally {
      setConfirming(false)
    }
  }

  const toggleExpanded = (rowIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }

  /** Client-side CSV export of failed rows — enough context to fix the file. */
  const downloadFailedRowsCsv = () => {
    if (!result || result.failedRows.length === 0) return
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = 'Excel Row,LR No,Invoice Number,Party Name,Reason'
    const body = result.failedRows.map((f) =>
      [f.rowIndex, f.lrNo ?? '', f.invoiceNumber ?? '', f.partyName ?? '', f.reason].map(esc).join(','),
    )
    const blob = new Blob([`${header}\n${body.join('\n')}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import-issues-${fileName.replace(/\.xlsx?$/i, '') || 'import'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const conflictRows = preview?.rows.filter((r) => r.kind === 'CONFLICT') || []
  const changedList = preview?.rows.filter((r) => r.kind === 'CHANGED') || []
  const newList = preview?.rows.filter((r) => r.kind === 'NEW') || []
  const invalidList = preview?.rows.filter((r) => r.kind === 'INVALID') || []
  const duplicateList = preview?.rows.filter((r) => r.kind === 'DUPLICATE') || []
  const unresolvedConflicts = conflictRows.filter((r) => r.recordId && !resolutions[r.recordId]).length

  const plannedChanges = useMemo(() => {
    if (!preview) return 0
    let n = newRows.size + changedRows.size + deletions.size
    for (const r of conflictRows) if (r.recordId && resolutions[r.recordId] === 'mine') n++
    return n
  }, [preview, newRows, changedRows, deletions, conflictRows, resolutions])

  // ------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {['Upload', 'Preview', 'Apply'].map((label, i) => {
          const activeIdx = step === 'upload' || step === 'error' ? 0 : step === 'preview' ? 1 : 2
          return (
            <div key={label} className="flex items-center gap-2">
              <span className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold',
                i < activeIdx && 'border-primary bg-primary text-primary-foreground',
                i === activeIdx && 'border-primary text-primary',
                i > activeIdx && 'border-border'
              )}>
                {i < activeIdx ? '✓' : i + 1}
              </span>
              <span className={i === activeIdx ? 'font-medium text-foreground' : ''}>{label}</span>
              {i < 2 && <ChevronRight className="h-3 w-3" />}
            </div>
          )
        })}
      </div>

      {/* ---------------- UPLOAD STEP ---------------- */}
      {step === 'upload' && (
        <Card>
          <CardContent className="pt-6">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:border-primary/60 hover:bg-accent/30"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files?.[0]
                if (f) void onFile(f)
              }}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-9 w-9 animate-spin text-primary" />
                  <p className="text-sm font-medium">Analyzing workbook…</p>
                  <p className="text-xs text-muted-foreground">Validating headers, data types and versions</p>
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <UploadCloud className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Drop an Excel file here, or click to browse</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      .xlsx exported from this portal • max 10 MB • nothing changes until you confirm
                    </p>
                  </div>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onFile(f)
                }}
              />
            </div>
            {progress > 0 && <Progress value={progress} className="mt-4 h-1" />}
          </CardContent>
        </Card>
      )}

      {/* ---------------- ERROR ---------------- */}
      {step === 'error' && error && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            <Ban className="h-9 w-9 text-destructive" />
            <p className="text-sm font-medium">{error}</p>
            <Button variant="outline" size="sm" onClick={reset}><Undo2 className="h-3.5 w-3.5" /> Try another file</Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- APPLYING ---------------- */}
      {step === 'applying' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 pt-10 pb-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Applying import in a single transaction…</p>
            <p className="text-xs text-muted-foreground">Creating records, updating versions and writing audit entries</p>
          </CardContent>
        </Card>
      )}

      {/* ---------------- DONE ---------------- */}
      {step === 'done' && result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-base font-semibold">Import complete</p>
                  <p className="text-xs text-muted-foreground">{fileName} • applied atomically — fully audited</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <ResultStat label="Created" value={result.created} icon={Plus} tone="success" />
                <ResultStat label="Updated" value={result.updated} icon={Pencil} tone="info" />
                <ResultStat label="Unchanged" value={result.unchanged} icon={CheckCircle2} tone="neutral" />
                <ResultStat label="Duplicates" value={result.duplicates} icon={Copy} tone="neutral" />
                <ResultStat label="Failed" value={result.failed} icon={XCircle} tone="danger" />
                <ResultStat label="Deleted" value={result.deleted} icon={Trash2} tone="danger" />
                <ResultStat label="Skipped" value={result.skipped} icon={Ban} tone="neutral" />
              </div>
              {result.duplicates > 0 && (
                <p className="rounded-lg border border-amber-300/50 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  <Copy className="mr-1.5 inline h-3.5 w-3.5" />
                  {result.duplicates} duplicate row{result.duplicates === 1 ? '' : 's'} were skipped — no second record was created.
                </p>
              )}
              {result.failedRows.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-500/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5">
                    <p className="text-xs font-medium text-red-700 dark:text-red-300">
                      <XCircle className="mr-1.5 inline h-3.5 w-3.5" />
                      {result.failed} row{result.failed === 1 ? '' : 's'} could not be applied
                    </p>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={downloadFailedRowsCsv}>
                      <Download className="h-3.5 w-3.5" /> Download issues (.csv)
                    </Button>
                  </div>
                  <div className="nice-scroll max-h-[240px] overflow-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-muted/95">
                        <tr className="border-b text-left">
                          <th className="px-3 py-2 font-medium">Excel row</th>
                          <th className="px-3 py-2 font-medium">LR No</th>
                          <th className="px-3 py-2 font-medium">Invoice</th>
                          <th className="px-3 py-2 font-medium">Party</th>
                          <th className="px-3 py-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failedRows.map((f, i) => (
                          <tr key={`${f.rowIndex}-${i}`} className="border-b last:border-0">
                            <td className="px-3 py-2 tabular-nums">{f.rowIndex}</td>
                            <td className="px-3 py-2 tabular-nums font-medium">{String(f.lrNo ?? '—')}</td>
                            <td className="max-w-[160px] truncate px-3 py-2">{String(f.invoiceNumber ?? '—')}</td>
                            <td className="max-w-[200px] truncate px-3 py-2">{String(f.partyName ?? '—')}</td>
                            <td className="px-3 py-2 text-destructive">{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {result.conflictsResolvedMine > 0 && (
                <p className="rounded-lg border border-amber-300/50 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" />
                  {result.conflictsResolvedMine} conflict(s) resolved with your uploaded values — the database version was overwritten on your explicit instruction and audited.
                </p>
              )}
              <Button size="sm" className="gap-1.5" onClick={reset}>
                <FileUp className="h-3.5 w-3.5" /> Import another file
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ---------------- PREVIEW ---------------- */}
      {step === 'preview' && preview && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Rows detected" value={preview.stats.detected} icon={FileSpreadsheet} />
            <StatCard label="New" value={preview.stats.new} icon={Plus} tone="success" />
            <StatCard label="Changed" value={preview.stats.changed} icon={Pencil} tone="info" />
            <StatCard label="Conflicts" value={preview.stats.conflicts} icon={AlertTriangle} tone="warning" />
            <StatCard label="Unchanged" value={preview.stats.unchanged} icon={CheckCircle2} tone="neutral" />
            <StatCard label="Duplicates" value={preview.stats.duplicates} icon={Copy} tone="warning" />
            <StatCard label="Invalid" value={preview.stats.invalid} icon={Ban} tone="danger" />
          </div>

          {preview.warnings.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-300/50 bg-amber-50/60 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {preview.warnings.map((w, i) => (
                <p key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>
              ))}
            </div>
          )}

          {/* detail tabs */}
          <Tabs defaultValue={changedList.length > 0 ? 'changed' : newList.length > 0 ? 'new' : conflictRows.length > 0 ? 'conflicts' : 'invalid'}>
            <TabsList className="h-9 flex-wrap">
              <TabsTrigger value="changed" className="gap-1.5 text-[13px]">
                <Pencil className="h-3 w-3" /> Changes
                <CountBadge n={changedList.length} />
              </TabsTrigger>
              <TabsTrigger value="conflicts" className="gap-1.5 text-[13px]">
                <AlertTriangle className="h-3 w-3" /> Conflicts
                <CountBadge n={conflictRows.length} tone="warning" />
              </TabsTrigger>
              <TabsTrigger value="new" className="gap-1.5 text-[13px]">
                <Plus className="h-3 w-3" /> New
                <CountBadge n={newList.length} tone="success" />
              </TabsTrigger>
              <TabsTrigger value="invalid" className="gap-1.5 text-[13px]">
                <Ban className="h-3 w-3" /> Invalid
                <CountBadge n={invalidList.length} tone="danger" />
              </TabsTrigger>
              {duplicateList.length > 0 && (
                <TabsTrigger value="duplicates" className="gap-1.5 text-[13px]">
                  <Copy className="h-3 w-3" /> Duplicates
                  <CountBadge n={duplicateList.length} tone="warning" />
                </TabsTrigger>
              )}
              {preview.missing.length > 0 && (
                <TabsTrigger value="missing" className="gap-1.5 text-[13px]">
                  <Trash2 className="h-3 w-3" /> Missing
                  <CountBadge n={preview.missing.length} tone="danger" />
                </TabsTrigger>
              )}
            </TabsList>

            {/* ---- CHANGED ---- */}
            <TabsContent value="changed">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-[15px]">Changed records</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">Version matches — safe to update</p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={changedRows.size === changedList.length && changedList.length > 0}
                      onCheckedChange={(v) => setChangedRows(v ? new Set(changedList.map((r) => r.rowIndex)) : new Set())}
                    />
                    Select all
                  </label>
                </CardHeader>
                <CardContent className="p-0">
                  <ChangeTable
                    rows={changedList}
                    selected={changedRows}
                    onToggle={(idx) => {
                      setChangedRows((prev) => {
                        const next = new Set(prev)
                        if (next.has(idx)) next.delete(idx)
                        else next.add(idx)
                        return next
                      })
                    }}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- CONFLICTS ---- */}
            <TabsContent value="conflicts">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-[15px]">Version conflicts — review carefully</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    These records were changed by someone else after this file was exported. Choose which values to keep.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {conflictRows.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">No conflicts — the file is fresh.</p>
                  )}
                  {conflictRows.map((r) => (
                    <ConflictRowCard
                      key={r.recordId}
                      row={r}
                      expanded={expanded.has(r.rowIndex)}
                      onToggleExpand={() => toggleExpanded(r.rowIndex)}
                      resolution={r.recordId ? resolutions[r.recordId] : undefined}
                      onResolution={(choice) => r.recordId && setResolutions((prev) => ({ ...prev, [r.recordId!]: choice }))}
                    />
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- NEW ---- */}
            <TabsContent value="new">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-[15px]">New records</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      No existing record matches these rows by LR No + Invoice + Party + material line — they will be created
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={newRows.size === newList.length && newList.length > 0}
                      onCheckedChange={(v) => setNewRows(v ? new Set(newList.map((r) => r.rowIndex)) : new Set())}
                    />
                    Select all
                  </label>
                </CardHeader>
                <CardContent className="p-0">
                  <NewTable
                    rows={newList}
                    selected={newRows}
                    onToggle={(idx) => {
                      setNewRows((prev) => {
                        const next = new Set(prev)
                        if (next.has(idx)) next.delete(idx)
                        else next.add(idx)
                        return next
                      })
                    }}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- INVALID ---- */}
            <TabsContent value="invalid">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-[15px]">Invalid rows — not importable</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Fix these rows in Excel and re-upload the file.</p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="nice-scroll max-h-[420px] overflow-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-muted/95">
                        <tr className="border-b text-left">
                          <th className="px-3 py-2 font-medium">Excel row</th>
                          <th className="px-3 py-2 font-medium">LR No</th>
                          <th className="px-3 py-2 font-medium">Party</th>
                          <th className="px-3 py-2 font-medium">Problems</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invalidList.map((r) => (
                          <tr key={r.rowIndex} className="border-b last:border-0">
                            <td className="px-3 py-2 tabular-nums">{r.rowIndex}</td>
                            <td className="px-3 py-2 tabular-nums">{String(r.values.lrNo ?? '—')}</td>
                            <td className="max-w-[220px] truncate px-3 py-2">{String(r.values.partyName ?? '—')}</td>
                            <td className="px-3 py-2">
                              <ul className="list-inside list-disc space-y-0.5 text-xs text-destructive">
                                {r.errors.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
                              </ul>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- DUPLICATES ---- */}
            <TabsContent value="duplicates">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-[15px]">Duplicate rows — skipped</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    These rows repeat a shipment identity (LR No + Invoice + Party + material line) that appears earlier in the same file. Only the first occurrence is imported.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="nice-scroll max-h-[420px] overflow-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-muted/95">
                        <tr className="border-b text-left">
                          <th className="px-3 py-2 font-medium">Excel row</th>
                          <th className="px-3 py-2 font-medium">LR No</th>
                          <th className="px-3 py-2 font-medium">Party</th>
                          <th className="px-3 py-2 font-medium">Invoice</th>
                          <th className="px-3 py-2 font-medium">Duplicate of</th>
                          <th className="px-3 py-2 font-medium">Values</th>
                        </tr>
                      </thead>
                      <tbody>
                        {duplicateList.map((r) => (
                          <tr key={r.rowIndex} className="border-b last:border-0">
                            <td className="px-3 py-2 tabular-nums">{r.rowIndex}</td>
                            <td className="px-3 py-2 tabular-nums font-medium">{String(r.values.lrNo ?? '—')}</td>
                            <td className="max-w-[220px] truncate px-3 py-2">{String(r.values.partyName ?? '—')}</td>
                            <td className="max-w-[160px] truncate px-3 py-2">{String(r.values.invoiceNumber ?? '—')}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">row {r.duplicateOfRow}</td>
                            <td className="px-3 py-2">
                              {r.duplicateConflicting ? (
                                <span className="badge-tone badge-warning" title="This duplicate row carries different values than the retained row — check which one is correct.">
                                  <AlertTriangle className="h-3 w-3" /> differ
                                </span>
                              ) : (
                                <span className="badge-tone badge-neutral">identical</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- MISSING ---- */}
            <TabsContent value="missing">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-[15px]">Records missing from this file</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Present in the database but not in the uploaded snapshot. Check any record you want to delete.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="nice-scroll max-h-[420px] overflow-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-muted/95">
                        <tr className="border-b text-left">
                          <th className="w-10 px-3 py-2" />
                          <th className="px-3 py-2 font-medium">LR No</th>
                          <th className="px-3 py-2 font-medium">Party</th>
                          <th className="px-3 py-2 font-medium">Destination</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.missing.map((m) => (
                          <tr key={m.recordId} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={deletions.has(m.recordId)}
                                onCheckedChange={(v) => {
                                  setDeletions((prev) => {
                                    const next = new Set(prev)
                                    if (v) next.add(m.recordId)
                                    else next.delete(m.recordId)
                                    return next
                                  })
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 tabular-nums">{m.lrNo ?? '—'}</td>
                            <td className="max-w-[280px] truncate px-3 py-2">{m.partyName ?? '—'}</td>
                            <td className="px-3 py-2">{m.destination ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* confirm bar */}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 p-3.5 shadow-lg backdrop-blur">
            <p className="text-[13px] text-muted-foreground">
              {plannedChanges === 0 ? (
                'No changes selected.'
              ) : (
                <>
                  <span className="font-semibold text-foreground">{plannedChanges}</span> change{plannedChanges === 1 ? '' : 's'} will be applied
                  {unresolvedConflicts > 0 && (
                    <span className="text-amber-600 dark:text-amber-400"> • {unresolvedConflicts} conflict(s) unresolved (kept as database values)</span>
                  )}
                </>
              )}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
              <Button size="sm" onClick={confirmImport} disabled={confirming || plannedChanges === 0}>
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm Import
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ==================================================================
// Sub-components
// ==================================================================

function StatCard({ label, value, icon: Icon, tone = 'default' }: {
  label: string; value: number; icon: typeof FileSpreadsheet
  tone?: 'default' | 'success' | 'info' | 'warning' | 'danger' | 'neutral'
}) {
  const toneCls = {
    default: 'text-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    info: 'text-[#70421F] dark:text-[#D8B48A]',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    neutral: 'text-muted-foreground',
  }[tone]
  return (
    <Card>
      <CardContent className="flex items-center gap-2.5 p-3.5">
        <Icon className={cn('h-4.5 w-4.5 shrink-0', toneCls)} />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className={cn('text-lg font-semibold tabular-nums leading-tight', toneCls)}>{value.toLocaleString('en-IN')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function CountBadge({ n, tone = 'default' }: { n: number; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  if (n === 0) return null
  const cls = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    danger: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  }[tone]
  return <span className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold', cls)}>{n}</span>
}

function ChangeTable({ rows, selected, onToggle }: {
  rows: ImportRowAnalysis[]
  selected: Set<number>
  onToggle: (rowIndex: number) => void
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No changed records in this file.</p>
  }
  return (
    <div className="nice-scroll max-h-[420px] overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-muted/95">
          <tr className="border-b text-left">
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2 font-medium">LR No</th>
            <th className="px-3 py-2 font-medium">Party</th>
            <th className="px-3 py-2 font-medium">Changes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowIndex} className={cn('border-b last:border-0', selected.has(r.rowIndex) && 'bg-accent/30')}>
              <td className="px-3 py-2">
                <Checkbox
                  checked={selected.has(r.rowIndex)}
                  onCheckedChange={() => onToggle(r.rowIndex)}
                  aria-label={`Select row ${r.rowIndex}`}
                />
              </td>
              <td className="px-3 py-2 tabular-nums font-medium">{String(r.values.lrNo ?? '—')}</td>
              <td className="max-w-[220px] truncate px-3 py-2">{String(r.values.partyName ?? '—')}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {r.diffs.slice(0, 4).map((d, i) => (
                    <span key={i} className="rounded-md border bg-muted/60 px-2 py-0.5 text-[11px]">
                      <span className="text-muted-foreground">{d.fieldName}:</span>{' '}
                      <span className="line-through opacity-60">{String(d.oldValue ?? '—').slice(0, 18)}</span>
                      <ArrowRight className="mx-1 inline h-3 w-3" />
                      <span className="font-medium text-primary">{String(d.newValue ?? '—').slice(0, 18)}</span>
                    </span>
                  ))}
                  {r.diffs.length > 4 && <span className="text-[11px] text-muted-foreground">+{r.diffs.length - 4} more</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NewTable({ rows, selected, onToggle }: {
  rows: ImportRowAnalysis[]
  selected: Set<number>
  onToggle: (rowIndex: number) => void
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No new records in this file.</p>
  }
  return (
    <div className="nice-scroll max-h-[420px] overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-muted/95">
          <tr className="border-b text-left">
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2 font-medium">Excel row</th>
            <th className="px-3 py-2 font-medium">LR No</th>
            <th className="px-3 py-2 font-medium">Party</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 font-medium text-right">Qty (L)</th>
            <th className="px-3 py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowIndex} className={cn('border-b last:border-0', selected.has(r.rowIndex) && 'bg-accent/30')}>
              <td className="px-3 py-2">
                <Checkbox checked={selected.has(r.rowIndex)} onCheckedChange={() => onToggle(r.rowIndex)} aria-label={`Select row ${r.rowIndex}`} />
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.rowIndex}</td>
              <td className="px-3 py-2 tabular-nums font-medium">{String(r.values.lrNo ?? '—')}</td>
              <td className="max-w-[220px] truncate px-3 py-2">{String(r.values.partyName ?? '—')}</td>
              <td className="px-3 py-2">{String(r.values.destination ?? '—')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{String(r.values.totalQuantityLtrs ?? '—')}</td>
              <td className="px-3 py-2">
                {r.businessKey == null ? (
                  <span className="badge-tone badge-warning" title="Missing LR No, Invoice or Party — this row cannot be checked for duplicates.">
                    <Search className="h-3 w-3" /> no identity
                  </span>
                ) : (
                  <span className="badge-tone badge-success">new</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConflictRowCard({ row, expanded, onToggleExpand, resolution, onResolution }: {
  row: ImportRowAnalysis
  expanded: boolean
  onToggleExpand: () => void
  resolution?: 'mine' | 'theirs'
  onResolution: (choice: 'mine' | 'theirs') => void
}) {
  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        <button onClick={onToggleExpand} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">
              LR {String(row.values.lrNo ?? '—')} • {String(row.values.partyName ?? '—')}
              <span className="ml-2 text-xs font-normal text-muted-foreground">Excel row {row.rowIndex}</span>
            </p>
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              DB is at v{row.dbVersion}, your file has v{row.fileVersion ?? '—'}
              {row.changedBy && ` • last changed by ${row.changedBy}`}
              {row.changedAt && ` on ${new Date(row.changedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onResolution('theirs')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              resolution === 'theirs' || !resolution
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            <Database className="h-3.5 w-3.5" /> Keep database
          </button>
          <button
            onClick={() => onResolution('mine')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              resolution === 'mine'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            <FileUp className="h-3.5 w-3.5" /> Use my values
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t bg-muted/30">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3.5 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium text-emerald-700 dark:text-emerald-400">Database value</th>
                <th className="px-3.5 py-2 font-medium text-primary">Your file's value</th>
              </tr>
            </thead>
            <tbody>
              {row.diffs.map((d) => (
                <tr key={d.fieldKey} className="border-b last:border-0">
                  <td className="px-3.5 py-2 font-medium">{d.fieldName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{String(d.oldValue ?? '—')}</td>
                  <td className="px-3.5 py-2 font-medium">{String(d.newValue ?? '—')}</td>
                </tr>
              ))}
              {row.dbValues && row.diffs.length === 0 && (
                <tr><td colSpan={3} className="px-3.5 py-3 text-center text-muted-foreground">No value differences — only the version changed.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ResultStat({ label, value, icon: Icon, tone }: {
  label: string; value: number; icon: typeof Plus
  tone: 'success' | 'info' | 'danger' | 'neutral'
}) {
  const toneCls = {
    success: 'text-emerald-600 dark:text-emerald-400',
    info: 'text-[#70421F] dark:text-[#D8B48A]',
    danger: 'text-red-600 dark:text-red-400',
    neutral: 'text-muted-foreground',
  }[tone]
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', toneCls)} /> {label}
      </p>
      <p className={cn('mt-0.5 text-xl font-semibold tabular-nums', toneCls)}>{value}</p>
    </div>
  )
}
