// Realtime event emitter — web app → Socket.IO realtime service.
//
// The web app POSTs events to the realtime service's INTERNAL admin endpoint
// (REALTIME_URL, default http://127.0.0.1:3004 for same-host deployments;
// set it to the realtime service's internal Coolify network address in
// production). The request carries the shared REALTIME_SECRET.
//
// Fire-and-forget: realtime failures must never fail the business operation.
// There is deliberately NO development fallback secret — if REALTIME_SECRET
// is missing in production, events are rejected by the service and a single
// clear error is logged.
const RT_URL = process.env.REALTIME_URL || 'http://127.0.0.1:3004'
const RT_SECRET = process.env.REALTIME_SECRET || ''

let warnedMissingSecret = false

export interface RealtimeEvent {
  type: 'records_updated' | 'records_created' | 'records_deleted' | 'import_applied' | 'field_changed' | 'user_changed' | 'delivery_synced'
  count?: number
  by?: string
  source?: 'PORTAL' | 'EXCEL' | 'API'
  detail?: string
  at?: string
}

export async function emitRealtime(event: RealtimeEvent): Promise<void> {
  if (!RT_SECRET) {
    if (process.env.NODE_ENV === 'production' && !warnedMissingSecret) {
      warnedMissingSecret = true
      console.error('[realtime] REALTIME_SECRET is not set — realtime events will NOT be delivered. Configure it and redeploy.')
    }
    return
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    await fetch(`${RT_URL}/emit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rt-secret': RT_SECRET },
      body: JSON.stringify({ ...event, at: event.at || new Date().toISOString() }),
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch {
    // non-fatal by design
  }
}
