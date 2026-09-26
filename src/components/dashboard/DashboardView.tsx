'use client'

// Drona Logitech Centralized MIS — Operations Dashboard.
// Executive + operational control center: compact high-information KPI cards
// (brand tones, animated counters), restrained Drona-palette charts.
// All data comes from the live /api/dashboard aggregation — no fake metrics.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Package, Droplets, Truck, CheckCircle2, Clock, AlertTriangle, Layers,
  CalendarDays, CalendarRange, FileCheck2, TrendingUp, Users,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/lib/client/store'
import { apiGet } from '@/lib/client/api'
import { fmtNum, fmtQty } from '@/lib/client/format'
import { RouteDivider } from '@/components/brand/DronaLogo'
import type { DashboardData } from '@/lib/types'

// Restrained, brand-adjacent status palette (badges always carry text too)
const STATUS_COLORS: Record<string, string> = {
  Delivered: '#4E7A51',
  Pending: '#E89A16',
  'In Transit': '#70421F',
  'Handover to NPL': '#8A8580',
  Return: '#A91518',
  'Return to WH': '#C05621',
  'NPL Refused To Deliver': '#7A1013',
  '(blank)': '#C9C2BA',
}

/** Animated KPI counter — counts up once when data arrives (subtle, rAF-driven) */
function AnimatedNumber({ value, format, duration = 700 }: {
  value: number
  format: (n: number) => string
  duration?: number
}) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    const start = performance.now()
    const from = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, duration])
  return <>{format(display)}</>
}

export default function DashboardView() {
  const refreshEpoch = useAppStore((s) => s.refreshEpoch)
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', refreshEpoch],
    queryFn: () => apiGet<DashboardData>('/api/dashboard'),
  })

  if (isLoading || !data) return <DashboardSkeleton />

  const deliveredPct = data.totalRecords > 0 ? (data.deliveredCount / data.totalRecords) * 100 : 0
  const podPct = data.totalRecords > 0 ? (data.podReceivedCount / data.totalRecords) * 100 : 0

  return (
    <div className="space-y-4 p-4 lg:p-5">
      {/* section header — the control-center banner */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-gold">
            <span className="drona-live-dot h-1.5 w-1.5 rounded-full bg-brand-gold" />
            Live · Centralized View
          </p>
          <h2 className="mt-1 font-display text-lg font-bold tracking-tight">
            What is happening across Drona Logitech right now
          </h2>
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Aggregated live from the central MIS database · {fmtNum(data.totalRecords)} active records
        </p>
      </div>

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard icon={Package} label="Total Records" num={data.totalRecords} format={fmtNum} hint="active MIS entries" delay={0} />
        <KpiCard icon={Droplets} label="Total Quantity" num={data.totalQuantity} format={fmtQty} hint={`${fmtNum(data.totalBuckets)} buckets`} delay={0.04} />
        <KpiCard icon={CheckCircle2} label="Delivered" num={data.deliveredCount} format={fmtNum} hint={`${fmtPercent(deliveredPct)} of records • ${fmtQty(data.deliveredQty)}`} tone="success" delay={0.08} />
        <KpiCard icon={Clock} label="Pending + In Transit" num={data.pendingCount + data.inTransitCount} format={fmtNum} hint={`${fmtQty(data.pendingQty)} pending qty`} tone="warning" delay={0.12} />
        <KpiCard icon={Truck} label="FTL / PTL" value={`${fmtNum(data.ftlCount)} / ${fmtNum(data.ptlCount)}`} hint="load type split" tone="info" delay={0.16} />
        <KpiCard icon={FileCheck2} label="POD Received" num={podPct} format={(n) => `${Math.round(n)}%`} hint={`${fmtNum(data.podReceivedCount)} of ${fmtNum(data.totalRecords)}`} tone="success" delay={0.2} />
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard icon={CalendarDays} label="Today's Entries" num={data.todayEntries} format={fmtNum} hint="created today (IST)" small />
        <KpiCard icon={CalendarRange} label="This Month" num={data.monthEntries} format={fmtNum} hint="created this month" small />
        <KpiCard icon={TrendingUp} label="On-time Delivery" num={data.onTimeCount} format={fmtNum} hint={`${data.delayedCount} delayed of ${data.onTimeCount + data.delayedCount} closed`} tone="success" small />
        <KpiCard icon={AlertTriangle} label="Delayed" num={data.delayedCount} format={fmtNum} hint="actual after expected date" tone="danger" small />
        <KpiCard icon={Users} label="Parties Served" num={new Set(data.pendingByParty.map((p) => p.party)).size} format={fmtNum} hint="currently outstanding" small />
        <KpiCard icon={Layers} label="Not Yet Delivered" num={data.undeliveredCount} format={fmtNum} hint="all non-Delivered statuses" tone="warning" small />
      </div>

      {/* gold route divider */}
      <RouteDivider className="text-foreground opacity-70" />

      {/* charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* daily trend */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-[15px] font-bold">Dispatch Trend — LR Quantity per Day</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.dailyTrend} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="qtyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A91518" stopOpacity={0.26} />
                    <stop offset="100%" stopColor="#A91518" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(8) + '/' + v.slice(5, 7)}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmtNum(v)} />
                <RTooltip content={<TrendTooltip />} />
                <Area type="monotone" dataKey="qty" stroke="#A91518" strokeWidth={2} fill="url(#qtyGradient)" name="Quantity (L)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* status donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-[15px] font-bold">Delivery Status</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.statusBreakdown}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.statusBreakdown.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status] || '#8A8580'} />
                  ))}
                </Pie>
                <RTooltip content={<StatusTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* top destinations */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-[15px] font-bold">Top 10 Destinations by Quantity</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topDestinations} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtNum(v)} />
                <YAxis type="category" dataKey="destination" width={110} tick={{ fontSize: 11.5, fill: 'var(--foreground)' }} axisLine={false} tickLine={false} />
                <RTooltip content={<DestTooltip />} cursor={{ fill: 'var(--accent)', opacity: 0.4 }} />
                <Bar dataKey="qty" fill="#E89A16" radius={[0, 4, 4, 0]} barSize={16} name="Quantity (L)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* outstanding deliveries list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-[15px] font-bold">Outstanding Deliveries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="nice-scroll max-h-[300px] overflow-y-auto px-4 pb-3">
              {data.pendingByParty.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing pending — everything is delivered.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.pendingByParty.slice(0, 12).map((p, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{p.party}</p>
                        <p className="text-xs text-muted-foreground">LR {p.lrNo} • {p.destination}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-medium tabular-nums">{fmtQty(p.qty)}</p>
                        <p className={`text-[11px] ${p.ageDays > 7 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {p.ageDays}d old
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
function KpiCard({ icon: Icon, label, value, num, format, hint, tone = 'default', small, delay = 0 }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string
  num?: number
  format?: (n: number) => string
  hint?: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  small?: boolean
  delay?: number
}) {
  const toneCls = {
    default: 'text-foreground',
    success: 'text-[#3A6147] dark:text-[#8FC49B]',
    warning: 'text-[#8A5B0F] dark:text-[#EFC06A]',
    danger: 'text-[#C62E14] dark:text-[#F09A93]',
    info: 'text-[#70421F] dark:text-[#D8B48A]',
  }[tone]
  const chipCls = {
    default: 'bg-brand-red/8 text-brand-red',
    success: 'bg-[#4E7A51]/12 text-[#3A6147] dark:bg-[#6FA17C]/15 dark:text-[#8FC49B]',
    warning: 'bg-brand-gold/15 text-[#8A5B0F] dark:text-[#EFC06A]',
    danger: 'bg-[#C62E14]/10 text-[#C62E14] dark:text-[#F09A93]',
    info: 'bg-brand-brown/12 text-[#70421F] dark:text-[#D8B48A]',
  }[tone]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
    >
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="flex items-start gap-3 p-4">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chipCls}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`${small ? 'text-xl' : 'kpi-value'} font-semibold tabular-nums tracking-tight ${toneCls}`}>
              {num != null && format ? <AnimatedNumber value={num} format={format} /> : value}
            </p>
            {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function fmtPercent(n: number): string {
  return `${Math.round(n)}%`
}

// custom tooltips
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">{fmtNum(payload[0]?.value)} L</p>
    </div>
  )
}

function StatusTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number; payload?: { qty?: number } }> }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{p?.name}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">{fmtNum(p?.value)} records • {fmtQty(p?.payload?.qty)}</p>
    </div>
  )
}

function DestTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value?: number; payload?: { destination?: string; count?: number } }> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{payload[0]?.payload?.destination ?? ''}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">{fmtQty(payload[0]?.value)} • {fmtNum(payload[0]?.payload?.count)} records</p>
    </div>
  )
}

function DashboardSkeleton() {
  const MemoSkeleton = useMemo(() => (
    <div className="space-y-4 p-4 lg:p-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-xl" />)}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-[320px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    </div>
  ), [])
  return MemoSkeleton
}
