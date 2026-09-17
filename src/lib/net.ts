// Request metadata helpers — proxy-aware and spoofing-resistant.
//
// The app runs behind trusted reverse proxies (Coolify in production, the
// sandbox gateway locally). The LAST X-Forwarded-For entry is the one our own
// proxy appended (the address it saw); earlier entries are client-supplied
// and can be forged, so they are never used.

/** Best-effort client IP for rate limiting and audit logs. */
export function requestIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return headers.get('x-real-ip') || null
}

/** Request user-agent for audit logs. */
export function requestUserAgent(headers: Headers): string | null {
  return headers.get('user-agent') || null
}
