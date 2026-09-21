'use client'

// Drona Logitech Centralized MIS — application shell
// Charcoal sidebar (grouped navigation: OVERVIEW / MIS / ANALYTICS /
// OPERATIONS / ADMINISTRATION) + compact enterprise topbar (global search,
// notification feed, user & role) + mobile drawer. Single-page architecture:
// all views are components; only `/` is routed.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  LayoutDashboard, Table2, FileBarChart2, ArrowDownUp, ScrollText, Settings2,
  ChevronsLeft, ChevronsRight, LogOut, Moon, Sun, Calculator, RefreshCw,
  Menu, X, Search, Bell, Database, Columns3, FileSpreadsheet, Info, CheckCheck,
  Trash2, Command,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { signOut } from 'next-auth/react'
import { useAppStore, type ViewId, type NotificationItem } from '@/lib/client/store'
import { can, ROLE_LABELS } from '@/lib/rbac'
import { apiPost } from '@/lib/client/api'
import { useRefreshAll } from '@/lib/client/hooks'
import { DronaArcs, DronaFullLogo, DronaEmblem, BrandGlow } from '@/components/brand/DronaLogo'
import DashboardView from '@/components/dashboard/DashboardView'
import MisView from '@/components/mis/MisView'
import ReportsView from '@/components/reports/ReportsView'
import ImportExportView from '@/components/excel/ImportExportView'
import AuditView from '@/components/audit/AuditView'
import SettingsView from '@/components/settings/SettingsView'

interface NavItem { id: ViewId; label: string; icon: typeof LayoutDashboard; permission: string }
interface NavGroup { label: string; items: NavItem[] }

// Centralized MIS navigation — every existing module, organised into a
// clearer information hierarchy. Nothing invented, nothing removed.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:view' },
    ],
  },
  {
    label: 'MIS',
    items: [
      { id: 'mis', label: 'Centralized MIS', icon: Table2, permission: 'records:view' },
      { id: 'excel', label: 'Import / Export', icon: ArrowDownUp, permission: 'records:view' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { id: 'reports', label: 'Reports & Summaries', icon: FileBarChart2, permission: 'reports:view' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'audit', label: 'Audit Trail', icon: ScrollText, permission: 'audit:view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'settings', label: 'Users & Settings', icon: Settings2, permission: 'settings:view' },
    ],
  },
]

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items)

const VIEW_META: Record<ViewId, { section: string; title: string; subtitle: string }> = {
  dashboard: { section: 'Overview', title: 'Operations Dashboard', subtitle: "What is happening across Drona Logitech right now" },
  mis: { section: 'MIS', title: 'Centralized MIS Workspace', subtitle: 'The single source of operational truth' },
  excel: { section: 'MIS', title: 'Excel Data Exchange', subtitle: 'Round-trip the company workbook safely' },
  reports: { section: 'Analytics', title: 'Reports & Summaries', subtitle: 'Live operational analytics' },
  audit: { section: 'Operations', title: 'Audit Trail', subtitle: 'Every change, tracked' },
  settings: { section: 'Administration', title: 'Users & Settings', subtitle: 'People, permissions & MIS fields' },
}

const NOTIF_ICONS: Record<NotificationItem['kind'], typeof Database> = {
  data: Database,
  schema: Columns3,
  import: FileSpreadsheet,
  system: Info,
}

function relTime(at: number): string {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function AppShell() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleCalculator = useAppStore((s) => s.toggleCalculator)
  const setUser = useAppStore((s) => s.setUser)
  const refreshAll = useRefreshAll()
  const [refreshing, setRefreshing] = useState(false)
  const { theme, setTheme } = useTheme()

  // global search (header) → MIS workspace
  const setMisSearch = useAppStore((s) => s.setMisSearch)
  const [globalSearch, setGlobalSearch] = useState('')

  // mobile drawer
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen)

  // notifications
  const notifications = useAppStore((s) => s.notifications)
  const markAllRead = useAppStore((s) => s.markAllNotificationsRead)
  const clearNotifications = useAppStore((s) => s.clearNotifications)
  const unread = notifications.filter((n) => !n.read).length

  const searchRef = useRef<HTMLInputElement>(null)

  // "/" focuses the global search (Excel muscle memory)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // redirect view if permission revoked (e.g. role change)
  useEffect(() => {
    if (!user) return

    const item = ALL_NAV.find((n) => n.id === view)

    if (item && !can(user.role, item.permission as never)) {
      const fallback = ALL_NAV.find((nav) =>
        can(user.role, nav.permission as never),
      )?.id

      if (fallback) {
        setView(fallback)
      }
    }
  }, [user, view, setView])

  // debounce-commit global search → MIS view
  useEffect(() => {
    const t = setTimeout(() => {
      if (globalSearch.trim()) {
        setMisSearch(globalSearch.trim())
        setView('mis')
      }
    }, 650)
    return () => clearTimeout(t)
  }, [globalSearch, setMisSearch, setView])

  const commitSearch = () => {
    if (globalSearch.trim()) {
      setMisSearch(globalSearch.trim())
      setView('mis')
    }
    searchRef.current?.blur()
  }

  if (!user) return null

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => can(user.role, n.permission as never)) }))
    .filter((g) => g.items.length > 0)

  const doRefresh = async () => {
    setRefreshing(true)
    refreshAll()
    setTimeout(() => setRefreshing(false), 600)
  }

  const doLogout = async () => {
    try {
      await signOut({ redirect: false })
    } catch { /* ignore */ }
    setUser(null)
    toast('Signed out', { description: 'You have been signed out of Drona Centralized MIS.' })
  }

  const meta = VIEW_META[view]

  // ---- shared nav list renderer (sidebar + mobile drawer) ----
  const renderNav = (isMobile = false) => (
    <nav className="nice-scroll flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
      {visibleGroups.map((group) => (
        <div key={group.label} className="mb-1.5">
          {(!collapsed || isMobile) && (
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
              {group.label}
            </p>
          )}
          {collapsed && !isMobile && <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" />}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = view === item.id
              return (
                <li key={item.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => { setView(item.id); if (isMobile) setMobileNavOpen(false) }}
                        aria-current={active ? 'page' : undefined}
                        className={`relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                          active
                            ? 'bg-sidebar-accent text-white'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white'
                        } ${(collapsed && !isMobile) ? 'justify-center' : ''}`}
                      >
                        {active && (
                          <motion.span
                            layoutId={isMobile ? 'nav-active-mobile' : 'nav-active'}
                            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand-red"
                          />
                        )}
                        <item.icon className={`h-[17px] w-[17px] shrink-0 ${active ? 'text-sidebar-primary' : ''}`} />
                        {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
                        {active && !collapsed && !isMobile && (
                          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-primary" />
                        )}
                      </button>
                    </TooltipTrigger>
                    {(collapsed && !isMobile) && (
                      <TooltipContent side="right" sideOffset={6}>
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  const sidebarFooter = (isMobile = false) => (
    <div className="space-y-1 border-t border-sidebar-border px-2 py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleCalculator}
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-white ${(collapsed && !isMobile) ? 'justify-center' : ''}`}
          >
            <Calculator className="h-[17px] w-[17px] shrink-0" />
            {(!collapsed || isMobile) && <span className="flex-1 truncate text-left">Calculator</span>}
          </button>
        </TooltipTrigger>
        {(collapsed && !isMobile) && (
          <TooltipContent side="right" sideOffset={6}>Calculator — Ctrl+Shift+C</TooltipContent>
        )}
      </Tooltip>
      {(!collapsed || isMobile) && (
        <p className="px-2.5 pt-1 text-[10.5px] text-sidebar-foreground/35">
          <kbd className="rounded border border-sidebar-border/60 px-1 py-0.5">Ctrl</kbd>{' '}
          <kbd className="rounded border border-sidebar-border/60 px-1 py-0.5">Shift</kbd>{' '}
          <kbd className="rounded border border-sidebar-border/60 px-1 py-0.5">C</kbd>
        </p>
      )}
      {!isMobile && (
        <button
          onClick={toggleSidebar}
          className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/60 hover:text-white ${collapsed ? 'justify-center' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
      {(!collapsed || isMobile) && (
        <p className="px-2.5 pt-1.5 text-[10px] text-sidebar-foreground/30">
          Centralized MIS · One source of truth
        </p>
      )}
    </div>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen w-full">
        {/* ---------- Sidebar (desktop) ---------- */}
        <motion.aside
          animate={{ width: collapsed ? 62 : 232 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
        >
          {/* ambient brand texture — fingerprint arcs */}
          <div className="pointer-events-none absolute right-0 top-0 overflow-hidden opacity-[0.16] text-white">
            <DronaArcs width={210} height={210} className="-translate-y-6 translate-x-6" />
          </div>

          {/* brand — the company's original transparent logo, built into the charcoal */}
          <div
            className={`relative flex items-center border-b border-sidebar-border/70 ${
              collapsed ? 'h-14 justify-center px-2' : 'flex-col gap-2 px-3 py-3.5'
            }`}
          >
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="relative flex items-center justify-center">
                    <BrandGlow
                      width={62}
                      height={62}
                      intensity={0.13}
                      className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                    />
                    <DronaEmblem onDark width={34} eager className="relative h-auto" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">Drona Logitech — Centralized MIS</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <div className="relative flex items-center justify-center">
                  <BrandGlow
                    width={196}
                    height={102}
                    className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                  />
                  <DronaFullLogo onDark width={136} eager className="relative h-auto" />
                </div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.30em] text-sidebar-foreground/70">
                  Centralized MIS
                </p>
              </>
            )}
          </div>

          {renderNav()}
          {sidebarFooter()}
        </motion.aside>

        {/* ---------- Main ---------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* topbar */}
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:gap-3 sm:px-4 lg:px-5">
            {/* mobile nav */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[270px] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground/70">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex h-full flex-col">
                  <div className="relative flex h-auto flex-col items-center gap-2 border-b border-sidebar-border/70 px-3 pt-5 pb-4">
                    <div className="relative flex items-center justify-center">
                      <BrandGlow
                        width={196}
                        height={102}
                        className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                      />
                      <DronaFullLogo onDark width={136} eager className="relative h-auto" />
                    </div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.30em] text-sidebar-foreground/70">
                      Centralized MIS
                    </p>
                    <div className="pointer-events-none absolute right-0 top-0 overflow-hidden opacity-[0.16] text-white">
                      <DronaArcs width={160} height={160} className="-translate-y-4 translate-x-4" />
                    </div>
                  </div>
                  {renderNav(true)}
                  {sidebarFooter(true)}
                </div>
              </SheetContent>
            </Sheet>

            {/* title block — section eyebrow + page title */}
            <div className="min-w-0">
              <p className="hidden text-[9.5px] font-semibold uppercase tracking-[0.18em] text-brand-gold sm:block">
                {meta.section}
              </p>
              <h1 className="truncate font-display text-[15px] font-bold tracking-tight">
                {meta.title}
              </h1>
            </div>

            {/* global search — jumps into the MIS workspace */}
            <div className="relative ml-auto hidden w-52 transition-all duration-200 focus-within:w-72 lg:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); if (e.key === 'Escape') { setGlobalSearch(''); e.currentTarget.blur() } }}
                placeholder="Search the MIS…"
                aria-label="Global search — searches MIS records"
                className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-14 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
              />
              {globalSearch ? (
                <button
                  onClick={commitSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-brand-red px-2 py-0.5 text-[11px] font-medium text-white"
                >
                  Go
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 text-[10px] text-muted-foreground/70">
                  <Command className="h-2.5 w-2.5" />/
                </kbd>
              )}
            </div>

            <div className="ml-auto flex items-center gap-0.5 sm:ml-0 sm:gap-1.5">
              {/* notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
                    <Bell className="h-4 w-4" />
                    {unread > 0 && (
                      <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[9px] font-bold text-white">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span>Notifications</span>
                    {notifications.length > 0 && (
                      <span className="text-[11px] font-normal text-muted-foreground">live activity</span>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <Bell className="mx-auto h-5 w-5 text-muted-foreground/40" />
                      <p className="mt-2 text-[13px] text-muted-foreground">No activity yet</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        Live updates from across the MIS appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="nice-scroll max-h-80 overflow-y-auto">
                      {notifications.slice(0, 12).map((n) => {
                        const Icon = NOTIF_ICONS[n.kind] ?? Info
                        return (
                          <div key={n.id} className="flex gap-2.5 px-3 py-2.5 hover:bg-accent/40">
                            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                              n.kind === 'schema' ? 'bg-brand-gold/15 text-brand-gold' :
                              n.kind === 'import' ? 'bg-brand-brown/15 text-brand-brown' :
                              'bg-brand-red/10 text-brand-red'
                            }`}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={`text-[12.5px] leading-snug ${n.read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>
                                {n.title}
                              </p>
                              {n.description && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.description}</p>}
                              <p className="mt-0.5 text-[10px] text-muted-foreground/60">{relTime(n.at)}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {notifications.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <DropdownMenuItem onClick={markAllRead} className="gap-1.5 text-[12px]">
                          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={clearNotifications} className="gap-1.5 text-[12px] text-muted-foreground">
                          <Trash2 className="h-3.5 w-3.5" /> Clear
                        </DropdownMenuItem>
                      </div>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={doRefresh} aria-label="Refresh data">
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh data</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    aria-label="Toggle theme"
                  >
                    {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Light / dark theme</TooltipContent>
              </Tooltip>

              {/* user */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-1 flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2.5 transition-colors hover:bg-accent/50">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-brand-red/12 text-[11px] font-bold text-brand-red">
                        {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-[120px] truncate text-[13px] font-medium sm:block">{user.name}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="space-y-0.5">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
                    <p className="pt-1">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold/45 bg-brand-gold/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-brown dark:text-brand-gold">
                        <span className="drona-live-dot h-1.5 w-1.5 rounded-full bg-brand-gold" />
                        {ROLE_LABELS[user.role]}
                      </span>
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {can(user.role, 'settings:view') && (
                    <DropdownMenuItem onClick={() => setView('settings')}>
                      <Settings2 className="h-4 w-4" /> Users & Settings
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={toggleCalculator}>
                    <Calculator className="h-4 w-4" /> Calculator
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={doLogout} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* view */}
          <main className="nice-scroll min-h-0 flex-1 overflow-y-auto">
            {view === 'dashboard' && <DashboardView />}
            {view === 'mis' && <MisView />}
            {view === 'reports' && <ReportsView />}
            {view === 'excel' && <ImportExportView />}
            {view === 'audit' && <AuditView />}
            {view === 'settings' && <SettingsView />}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
