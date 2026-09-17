'use client'

// Reports — live, DB-derived summaries (the old hidden Summary sheet,
// reborn as always-fresh reports)
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Loader2, Clock, MapPin, Truck, Package2, Factory } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/lib/client/store'
import { apiGet, apiDownload } from '@/lib/client/api'
import { fmtNum, fmtQty, fmtDate, deliveryStatusTone } from '@/lib/client/format'
import { can } from '@/lib/rbac'

type ReportType = 'pending' | 'destination' | 'vendor' | 'party' | 'material'

interface PendingRow {
  party: string; destination: string; lrNo: number; qty: number; lines: number
  lrDate: string | null; expected: string | null; status: string; pod: string; ageDays: number
}
interface GroupRow { [k: string]: string | number }

const TABS: Array<{ id: ReportType; label: string; icon: typeof Clock }> = [
  { id: 'pending', label: 'Pending Deliveries', icon: Clock },
  { id: 'destination', label: 'Destination-wise', icon: MapPin },
  { id: 'vendor', label: 'Vendor / Route', icon: Truck },
  { id: 'party', label: 'Party-wise', icon: Package2 },
  { id: 'material', label: 'Material-wise', icon: Factory },
]

export default function ReportsView() {
  const [tab, setTab] = useState<ReportType>('pending')
  const user = useAppStore((s) => s.user)
  const refreshEpoch = useAppStore((s) => s.refreshEpoch)
  const [filterText, setFilterText] = useState('')
  const [exporting, setExporting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['report', tab, refreshEpoch],
    queryFn: () => apiGet<{ type: string; rows: GroupRow[] }>(`/api/reports?type=${tab}`),
  })

  const rows = (data?.rows || []).filter((r) =>
    !filterText || Object.values(r).some((v) => String(v).toLowerCase().includes(filterText.toLowerCase()))
  )

  const exportReport = async () => {
    setExporting(true)
    try {
      // Full export of all active records (reports cover the whole MIS)
      await apiDownload('/api/export', { includeSummary: true }, `MIS_Report_${tab}.xlsx`)
      toast.success('Excel exported', { description: 'The workbook includes the live Summary sheet.' })
    } catch {
      toast.error('Export failed', { description: 'Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  const canExport = user ? can(user.role, 'excel:export' as never) : false

  return (
    <div className="space-y-4 p-4 lg:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReportType)}>
          <TabsList className="h-9 flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="gap-1.5 text-[13px]">
                <t.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter rows…"
            className="h-9 w-44"
          />
          {canExport && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportReport} disabled={exporting}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export Excel
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px]">
            {TABS.find((t) => t.id === tab)?.label}
          </CardTitle>
          <CardDescription>
            {tab === 'pending'
              ? 'Live recreation of the original Summary sheet — outstanding deliveries grouped by Party → Destination → LR No. Always current, unlike the stale Excel pivot cache.'
              : 'Aggregated live from the central database — updates automatically as records change.'}
            {' '}{rows.length} group{rows.length === 1 ? '' : 's'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
              <Clock className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {tab === 'pending' ? 'No pending deliveries — everything is delivered.' : 'No data for this report yet.'}
              </p>
            </div>
          ) : (
            <div className="nice-scroll max-h-[calc(100vh-320px)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  {tab === 'pending' ? (
                    <TableRow>
                      <TableHead>Party Name</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead className="text-right">LR No</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead>LR Date</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Age</TableHead>
                    </TableRow>
                  ) : (
                    <TableRow>
                      <TableHead>{tab === 'vendor' ? 'Vendor' : tab === 'party' ? 'Party Name' : tab === 'material' ? 'Material' : 'Destination'}</TableHead>
                      {tab === 'vendor' && <TableHead>Route</TableHead>}
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead className="text-right">Quantity (L)</TableHead>
                      {(tab === 'destination' || tab === 'material') && <TableHead className="text-right">Buckets</TableHead>}
                    </TableRow>
                  )}
                </TableHeader>
                <TableBody>
                  {tab === 'pending'
                    ? (rows as unknown as PendingRow[]).map((r, i) => (
                        <TableRow key={i} className={r.ageDays > 10 ? 'bg-red-50/40 dark:bg-red-500/5' : ''}>
                          <TableCell className="max-w-[240px] truncate font-medium" title={r.party}>{r.party}</TableCell>
                          <TableCell>{r.destination}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.lrNo}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{fmtNum(r.qty)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{r.lines}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.lrDate ? fmtDate(r.lrDate) : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.expected ? fmtDate(r.expected) : '—'}</TableCell>
                          <TableCell>
                            <span className={`badge-tone badge-${deliveryStatusTone(r.status)}`}>{r.status}</span>
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-medium ${r.ageDays > 10 ? 'text-destructive' : r.ageDays > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                            {r.ageDays}d
                          </TableCell>
                        </TableRow>
                      ))
                    : rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-[280px] truncate font-medium" title={String(r[tab === 'vendor' ? 'vendor' : tab === 'party' ? 'party' : tab === 'material' ? 'material' : 'destination'])}>
                            {String(r[tab === 'vendor' ? 'vendor' : tab === 'party' ? 'party' : tab === 'material' ? 'material' : 'destination'])}
                          </TableCell>
                          {tab === 'vendor' && <TableCell>{String(r.route)}</TableCell>}
                          <TableCell className="text-right tabular-nums">{fmtNum(r.count)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{fmtNum(r.qty)}</TableCell>
                          {(tab === 'destination' || tab === 'material') && (
                            <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(r.buckets)}</TableCell>
                          )}
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
