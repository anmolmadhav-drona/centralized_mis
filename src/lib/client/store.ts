// Global client state (zustand) — active view, calculator, session,
// realtime notification feed, global MIS search, mobile navigation
'use client'

import { create } from 'zustand'
import type { SessionUser } from '@/lib/types'

export type ViewId = 'dashboard' | 'mis' | 'reports' | 'excel' | 'audit' | 'settings'

export interface NotificationItem {
  id: string
  title: string
  description?: string
  at: number
  kind: 'data' | 'schema' | 'import' | 'system'
  read?: boolean
}

interface AppState {
  user: SessionUser | null
  setUser: (u: SessionUser | null) => void
  view: ViewId
  setView: (v: ViewId) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  calculatorOpen: boolean
  setCalculatorOpen: (open: boolean) => void
  toggleCalculator: () => void
  /** bump to trigger a data refresh across views (e.g. after realtime notice) */
  refreshEpoch: number
  requestRefresh: () => void
  /** realtime notification feed (bell in the header) */
  notifications: NotificationItem[]
  pushNotification: (n: Omit<NotificationItem, 'id' | 'at'>) => void
  markAllNotificationsRead: () => void
  clearNotifications: () => void
  /** global search (header) → MIS workspace search box */
  misSearch: string
  misSearchEpoch: number
  setMisSearch: (text: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (u) => set({ user: u }),
  view: 'dashboard',
  setView: (v) => set({ view: v }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  calculatorOpen: false,
  setCalculatorOpen: (open) => set({ calculatorOpen: open }),
  toggleCalculator: () => set((s) => ({ calculatorOpen: !s.calculatorOpen })),
  refreshEpoch: 0,
  requestRefresh: () => set((s) => ({ refreshEpoch: s.refreshEpoch + 1 })),
  notifications: [],
  pushNotification: (n) => set((s) => ({
    notifications: [
      { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() },
      ...s.notifications,
    ].slice(0, 30),
  })),
  markAllNotificationsRead: () => set((s) => ({
    notifications: s.notifications.map((n) => ({ ...n, read: true })),
  })),
  clearNotifications: () => set({ notifications: [] }),
  misSearch: '',
  misSearchEpoch: 0,
  setMisSearch: (text) => set((s) => ({ misSearch: text, misSearchEpoch: s.misSearchEpoch + 1 })),
}))
