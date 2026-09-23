'use client'

// Root portal — session gate: login view ⇄ app shell.
// Realtime events surface as toasts AND as entries in the header
// notification feed (the "what is happening right now" channel).
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/client/store'
import { useSession, useRealtime } from '@/lib/client/hooks'
import LoginView from '@/components/portal/LoginView'
import AppShell from '@/components/portal/AppShell'
import Calculator from '@/components/calculator/Calculator'
import { DronaFullLogo, RouteLoader, BrandGlow } from '@/components/brand/DronaLogo'

export default function Portal() {
  const { data, isLoading } = useSession()
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const view = useAppStore((s) => s.view)

  // keep store in sync with the session query
  useEffect(() => {
    if (data?.user !== undefined) setUser(data.user)
  }, [data, setUser])

  // ---- global calculator shortcut: Ctrl + Shift + C ----
  const toggleCalculator = useAppStore((s) => s.toggleCalculator)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault()
        toggleCalculator()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCalculator])

  // ---- realtime notifications (only meaningful when signed in) ----
  const requestRefresh = useAppStore((s) => s.requestRefresh)
  const pushNotification = useAppStore((s) => s.pushNotification)
  useRealtime((e) => {
    if (!e?.type) return
    if (e.type === 'field_changed') {
      pushNotification({ kind: 'schema', title: `MIS schema changed — ${e.detail || 'columns updated'}`, description: `by ${e.by || 'another user'} • reload to load the new columns` })
      toast.info(`MIS schema changed — ${e.detail || 'columns updated'}`, {
        description: `by ${e.by || 'another user'} • Reload to load the new columns`,
        action: { label: 'Reload', onClick: () => window.location.reload() },
        duration: 12_000,
      })
      return
    }
    if (e.type === 'import_applied') {
      pushNotification({ kind: 'import', title: `Excel import applied by ${e.by || 'a user'}`, description: e.detail || `${e.count ?? 0} records affected` })
      toast.info(`Excel import applied by ${e.by || 'a user'}`, {
        description: e.detail || `${e.count ?? 0} records affected`,
        duration: 12_000,
      })
      requestRefresh()
      return
    }
    const labels: Record<string, string> = {
      records_updated: 'record(s) updated',
      records_created: 'new record(s) added',
      records_deleted: 'record(s) deleted',
    }
    const label = labels[e.type] || 'data changed'
    pushNotification({ kind: 'data', title: `${e.count ?? 1} ${label}`, description: `by ${e.by || 'another user'} • just now` })
    toast.info(`${e.count ?? 1} ${label}`, {
      description: `by ${e.by || 'another user'} • just now`,
      duration: 10_000,
    })
    requestRefresh()
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
        {/* the company's original transparent logo — no plate; dark mode uses
            the charcoal-optimised artwork with a faint warm-gold halo */}
        <div className="relative flex items-center justify-center">
          <BrandGlow
            width={300}
            height={150}
            className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 dark:opacity-100"
          />
          <DronaFullLogo width={220} eager className="relative h-auto dark:hidden" />
          <DronaFullLogo onDark width={220} className="relative hidden h-auto dark:block" />
        </div>
        <RouteLoader label="Connecting to Drona Centralized MIS…" />
      </div>
    )
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {user ? (
          <motion.div
            key="app"
            className="flex min-h-screen flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <AppShell />
          </motion.div>
        ) : (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <LoginView />
          </motion.div>
        )}
      </AnimatePresence>
      <Calculator />
      <span className="sr-only" aria-live="polite">View changed to {view}</span>
    </>
  )
}
