// Client hooks — session, field registry, realtime socket
'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import { apiGet } from '@/lib/client/api'
import { useAppStore } from '@/lib/client/store'
import type { FieldDef, SessionUser } from '@/lib/types'

export function useSession() {
  const setUser = useAppStore((s) => s.setUser)
  const query = useQuery({
    queryKey: ['session'],
    queryFn: () => apiGet<{ user: SessionUser | null }>('/api/auth/me'),
    staleTime: 60_000,
  })
  useEffect(() => {
    if (query.data) setUser(query.data.user)
  }, [query.data, setUser])
  return query
}

export function useFields() {
  return useQuery({
    queryKey: ['fields'],
    queryFn: () => apiGet<{ fields: FieldDef[] }>('/api/fields'),
    staleTime: 60_000,
  })
}

export interface MisEvent {
  type: string
  count?: number
  by?: string
  source?: string
  detail?: string
  at?: string
}

/** Socket.IO connection to the realtime service.
 *  URL comes from /api/config (REALTIME_PUBLIC_URL at runtime); the
 *  same-origin XTransformPort form is the local sandbox fallback — never a
 *  direct port URL. */
export function useRealtime(onEvent: (e: MisEvent) => void) {
  const socketRef = useRef<Socket | null>(null)
  const handlerRef = useRef(onEvent)
  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let socket: Socket | null = null
    let cancelled = false
    ;(async () => {
      let url: string | null = null
      try {
        const res = await fetch('/api/config')
        if (res.ok) url = ((await res.json()) as { realtimeUrl: string | null }).realtimeUrl
      } catch { /* fall back to same-origin */ }
      if (cancelled) return
      // sandbox gateway: same-origin with the transform-port query;
      // production: REALTIME_PUBLIC_URL from runtime configuration
      const target = url ?? '/?XTransformPort=3003'
      socket = io(target, { transports: ['websocket', 'polling'] })
      socketRef.current = socket
      socket.on('connect', () => setConnected(true))
      socket.on('disconnect', () => setConnected(false))
      socket.on('mis-event', (e: MisEvent) => handlerRef.current(e))
    })()
    return () => {
      cancelled = true
      socket?.disconnect()
      socketRef.current = null
    }
  }, [])

  return connected
}

/** Invalidate all data queries (used by the "Refresh view" action). */
export function useRefreshAll() {
  const qc = useQueryClient()
  const requestRefresh = useAppStore((s) => s.requestRefresh)
  return () => {
    qc.invalidateQueries({ queryKey: ['fields'] })
    requestRefresh()
  }
}
