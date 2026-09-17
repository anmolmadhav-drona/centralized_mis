'use client'

// /reset-password?token=… — the landing page for password reset email links.
// Public (the user cannot sign in — that is the point of the flow). Presents
// the new-password form, consumes the single-use token via
// /api/auth/reset-confirm, then routes back to the sign-in page.
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DronaFullLogo } from '@/components/brand/DronaLogo'

function ResetPasswordForm() {
  const params = useSearchParams()
  const token = params.get('token') || ''
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setDone(true)
        toast.success('Password updated', {
          description: 'You can sign in with your new password now.',
        })
        setTimeout(() => router.push('/'), 2500)
      } else if (res.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.')
      } else {
        // Uniform server message for invalid/expired/used tokens.
        setError(json.error || 'Invalid or expired reset link.')
      }
    } catch {
      setError('Unable to update the password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FDFDFD] px-6 dark:bg-sidebar">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <DronaFullLogo width={220} eager className="h-auto w-[220px] dark:hidden" />
          <DronaFullLogo onDark width={220} eager className="hidden h-auto w-[220px] dark:block" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-xl border bg-card p-6 shadow-sm"
        >
          {!token ? (
            <>
              <h1 className="font-display text-lg font-bold tracking-tight">Reset link missing</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This page needs a valid reset link. Use <span className="font-medium text-foreground">Forgot
                password?</span> on the sign-in page to request a new one — links are valid for 30 minutes
                and can be used once.
              </p>
              <Button asChild variant="outline" className="mt-5 w-full">
                <Link href="/"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
              </Button>
            </>
          ) : done ? (
            <div className="py-2 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <h1 className="mt-3 font-display text-lg font-bold tracking-tight">Password updated</h1>
              <p className="mt-2 text-sm text-muted-foreground">Redirecting you to the sign-in page…</p>
              <Button asChild className="mt-5 w-full">
                <Link href="/">Go to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <h1 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
                <KeyRound className="h-4 w-4 text-brand-red" />
                Set a new password
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a new password for your Drona Logitech account.
              </p>
              <form onSubmit={submit} className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className="pl-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      minLength={8}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Repeat the new password"
                      className="pl-9"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                </div>
                {error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
                  >
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Update password
                </Button>
              </form>
            </>
          )}
        </motion.div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Did not request a reset? You can ignore the email — your password stays unchanged.
        </p>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
