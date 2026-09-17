'use client'

// Audit Log — admin screen with filters and pagination
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ScrollText, Search, ChevronLeft, ChevronRight, ArrowRight, User, FileSpreadsheet, Monitor } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { useAppStore } from '@/lib/client/store'
import { apiGet } from '@/lib/client/api'
import { fmtDateTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

interface AuditRow {
  id: string
  userId: string | null
  userName: string | null
  action: string
  entity: string
  entityId: string | null
  fieldName: string | null
  oldValue: string | null
  newValue: string | null
  source: string
  ip: string | null
  createdAt: string
}

const ACTION_TONES: Record<string, string> = {
  RECORD_CREATE: 'success',
  RECORD_UPDATE: 'info',
  RECORD_DELETE: 'danger',
  FIELD_ADD: 'success',
  FIELD_UPDATE: 'warning',
  FIELD_DELETE: 'danger',
  IMPORT: 'purple',
  EXPORT: 'neutral',
  LOGIN: 'neutral',
  LOGIN_FAILED: 'danger',
  USER_CREATE: 'success',
  USER_UPDATE: 'warning',
}

const PAGE_SIZE = 25

export default function AuditView() {
  const refreshEpoch = useAppStore((s) => s.refreshEpoch)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [from, setFrom] = useState<Date | undefined>()
  const [to, setTo] = useState<Date | undefined>()

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (action) params.set('action', action)
  if (entity) params.set('entity', entity)
  if (debounced) params.set('search', debounced)
  if (from) params.set('from', new Date(from.setHours(0, 0, 0, 0)).toISOString())
  if (to) params.set('to', new Date(to.setHours(23, 59, 59, 999)).toISOString())

  const { data, isLoading } = useQuery({
    queryKey: ['audit', params.toString(), refreshEpoch],
    queryFn: () => apiGet<{ logs: AuditRow[]; total: number; page: number; pageSize: number }>(`/api/audit?${params.toString()}`),
  })

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const clearFilters = () => {
    setAction(''); setEntity(''); setSearch(''); setDebounced('')
    setFrom(undefined); setTo(undefined); setPage(1)
  }

  return (
    <div className="space-y-4 p-4 lg:p-5">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search values, users, fields…"
            className="pl-9"
          />
        </div>
        <Select value={action || undefined} onValueChange={(v) => { setAction(v || ''); setPage(1) }}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent>
            {['RECORD_CREATE', 'RECORD_UPDATE', 'RECORD_DELETE', 'FIELD_ADD', 'FIELD_UPDATE', 'FIELD_DELETE', 'IMPORT', 'EXPORT', 'LOGIN', 'LOGIN_FAILED', 'USER_CREATE', 'USER_UPDATE'].map((a) => (
              <SelectItem key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entity || undefined} onValueChange={(v) => { setEntity(v || ''); setPage(1) }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All entities" /></SelectTrigger>
          <SelectContent>
            {['RECORD', 'FIELD', 'IMPORT', 'EXPORT', 'USER', 'AUTH'].map((e) => (
              <SelectItem key={e} value={e}>{e.toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              {from ? format(from, 'dd MMM') : 'From'} — {to ? format(to, 'dd MMM') : 'To'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-auto max-w-[calc(100vw-2rem)] flex-wrap gap-2 p-3" align="start">
            <div className="shrink-0">
              <p className="mb-1.5 text-xs text-muted-foreground">From</p>
              <Calendar mode="single" selected={from} onSelect={(d) => { setFrom(d); setPage(1) }} className="rounded-md border" />
            </div>
            <div className="shrink-0">
              <p className="mb-1.5 text-xs text-muted-foreground">To</p>
              <Calendar mode="single" selected={to} onSelect={(d) => { setTo(d); setPage(1) }} className="rounded-md border" />
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={clearFilters}>Clear</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <ScrollText className="h-4 w-4 text-primary" /> Audit trail
          </CardTitle>
          <CardDescription>
            {total.toLocaleString('en-IN')} events • every change is tracked with old → new values, user, source and timestamp
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (data?.logs?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
              <ScrollText className="h-8 w-8 opacity-30" />
              <p className="text-sm">No audit events match these filters.</p>
            </div>
          ) : (
            <div className="nice-scroll overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-[12.5px] text-muted-foreground">{fmtDateTime(l.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-[13px] font-medium">{l.userName || '—'}</TableCell>
                      <TableCell>
                        <span className={`badge-tone badge-${ACTION_TONES[l.action] || 'default'}`}>
                          {l.action.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[460px]">
                        <AuditDetail row={l} />
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                          {l.source === 'EXCEL' ? <FileSpreadsheet className="h-3.5 w-3.5" /> : l.source === 'PORTAL' ? <Monitor className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                          {l.source.toLowerCase()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Page {page} of {pages} • {total.toLocaleString('en-IN')} events
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AuditDetail({ row }: { row: AuditRow }) {
  if (row.action === 'RECORD_UPDATE' && row.fieldName) {
    return (
      <span className="text-[13px]">
        <span className="font-medium">{row.fieldName}:</span>{' '}
        {row.oldValue && <span className="text-muted-foreground line-through">{truncate(row.oldValue)}</span>}
        {row.oldValue && row.newValue && <ArrowRight className="mx-1.5 inline h-3 w-3 text-muted-foreground" />}
        {row.newValue && <span className="font-medium text-primary">{truncate(row.newValue)}</span>}
        {!row.oldValue && !row.newValue && <span className="text-muted-foreground">—</span>}
      </span>
    )
  }
  if (row.action === 'RECORD_CREATE' || row.action === 'RECORD_DELETE') {
    return <span className="text-[13px] text-muted-foreground">{row.newValue || row.oldValue || '—'}</span>
  }
  if (row.action === 'IMPORT' || row.action === 'EXPORT') {
    return <span className="text-[13px] text-muted-foreground">{row.newValue || '—'}</span>
  }
  return <span className="text-[13px] text-muted-foreground">{row.fieldName || row.newValue || row.oldValue || '—'}</span>
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
