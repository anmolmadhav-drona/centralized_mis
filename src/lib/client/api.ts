// Typed fetch wrapper — uniform error handling for all client calls
export class ApiClientError extends Error {
  status: number
  code?: string
  data?: unknown
  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      body.error || 'Request failed. Please try again.',
      body.code,
      body
    )
  }
  return body as T
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' })
  return parse<T>(res)
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return parse<T>(res)
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse<T>(res)
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' })
  return parse<T>(res)
}

export async function apiUpload<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: formData })
  return parse<T>(res)
}

/** Download a binary file from a POST API (Excel export). */
export async function apiDownload(url: string, body: unknown, fallbackName: string): Promise<{ fileName: string }> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = 'Export failed. Please try again.'
    try { msg = JSON.parse(text).error || msg } catch { /* keep default */ }
    throw new ApiClientError(res.status, msg)
  }
  const fileName = res.headers.get('x-file-name') || fallbackName
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return { fileName }
}
