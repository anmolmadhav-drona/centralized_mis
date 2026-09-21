'use client'

// Drona Logitech — Centralized MIS sign-in experience.
// Split entry staged around the company's original DRONA LOGITECH logo
// artwork (transparent, never on a plate): a luminous near-white brand stage
// on the left, the warm workspace form on the right. Self-signup has been
// retired — accounts are provisioned by administrators from Users & Settings.
// All auth logic unchanged (JWT cookie session).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import { Eye, EyeOff, KeyRound, Loader2, Lock, Mail, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { signIn } from 'next-auth/react'
import { apiGet, ApiClientError } from '@/lib/client/api'
import { useAppStore } from '@/lib/client/store'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionUser } from '@/lib/types'
import { BrandGlow, DronaArcs, DronaFullLogo } from '@/components/brand/DronaLogo'

export default function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSending, setForgotSending] = useState(false)
  const setUser = useAppStore((s) => s.setUser)
  const qc = useQueryClient()
  const router = useRouter()

  // ---- reduced motion: honor the OS preference for the stage entrance ----
  const reduced = useReducedMotion()

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault()
    const em = (creds?.email ?? email).trim().toLowerCase()
    const pw = creds?.password ?? password
    if (!em || !pw) {
      setError('Enter your email and password.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Auth.js credentials flow (CSRF-protected POST to the NextAuth handler)
      const res = await signIn('credentials', { email: em, password: pw, redirect: false })
      if (res?.error) {
        // safe codes only — never reveal whether the account exists
        setError(res.code === 'too_many_attempts'
          ? 'Too many attempts. Please wait a minute and try again.'
          : 'Incorrect email or password.')
        return
      }
      const { user } = await apiGet<{ user: SessionUser | null }>('/api/auth/me')
      if (!user) {
        setError('Unable to sign in. Please try again.')
        return
      }
      setUser(user)
      qc.setQueryData(['session'], { user })
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`, {
        description: `Signed in to Drona Centralized MIS as ${user.role}`,
      })
      router.refresh()
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* ---- brand stage — the original Drona Logitech logo artwork ---- */}
      <div className="relative flex flex-col border-b border-border/60 bg-[#FDFDFD] dark:bg-sidebar dark:border-sidebar-border lg:w-[52%] lg:border-b-0 lg:overflow-hidden">
        {/* ambient texture — the fingerprint arcs, echoing the emblem's spiral */}
        <DronaArcs
          width={420}
          height={420}
          className="pointer-events-none absolute -right-24 -top-20 hidden text-brand-brown/15 dark:text-sidebar-foreground/10 lg:block"
        />
        {/* stage chrome: identity header + footer frame the artwork */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-5 sm:px-10 sm:pt-6 lg:px-12 lg:pt-10">
          <div>
            <p className="font-display text-[15px] font-extrabold tracking-tight text-brand-charcoal dark:text-white">
              DRONA <span className="text-brand-red">LOGITECH</span>
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.34em] text-brand-brown/80 dark:text-sidebar-foreground/60">
              Centralized MIS
            </p>
          </div>
        </div>

        {/* the artwork itself — transparent, placed directly on the stage */}
        <div className="relative flex flex-1 items-center justify-center px-6 py-5 sm:px-10 sm:py-7 lg:px-12 lg:py-10">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="relative flex w-full max-w-[680px] items-center justify-center"
          >
            {/* faint warm-gold halo — only on the charcoal stage */}
            <BrandGlow
              width={520}
              height={300}
              intensity={0.12}
              className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 dark:opacity-100"
            />
            <DronaFullLogo width={680} eager className="relative h-auto w-full dark:hidden" />
            <DronaFullLogo onDark width={680} eager className="relative hidden h-auto w-full dark:block" />
          </motion.div>
          {/* for screen readers: the brand message as text */}
          <span className="sr-only">Drona Logitech — Experiencing Togetherness.</span>
        </div>

        <p className="relative z-10 hidden px-12 pb-8 text-xs text-brand-brown/50 dark:text-sidebar-foreground/55 lg:block">
          © {new Date().getFullYear()} Drona Logitech · Centralized MIS · Internal use only
        </p>
      </div>

      {/* ---- form panel — the workspace ---- */}
      <div className="relative flex flex-1 items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="w-full max-w-sm"
        >
          <h2 className="font-display text-xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your Drona Logitech account to continue.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@dronalogitech.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={loading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
                role="alert"
              >
                {error}
              </motion.p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in to Centralized MIS
            </Button>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email)
                  setForgotOpen(true)
                }}
                className="text-[13px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:underline"
              >
                Forgot password?
              </button>
            </div>
          </form>

          <p className="mt-5 text-center text-[13px] leading-relaxed text-muted-foreground">
            Accounts are provisioned by your administrator.
            <br />
            Need access? Request it from the MIS team.
          </p>

        </motion.div>
      </div>

      {/* ---- forgot password — anti-enumeration by design: the response is
           identical whether or not the account exists ---- */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-brand-red" />
              Reset your password
            </DialogTitle>
            <DialogDescription>
              Enter your account email. If it exists, we will send a reset link valid for 30 minutes.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              const em = forgotEmail.trim().toLowerCase()
              if (!em) return
              setForgotSending(true)
              try {
                const res = await fetch('/api/auth/reset-request', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ email: em }),
                })
                // The message is uniform on purpose — it never confirms
                // whether the account exists.
                const json = await res.json().catch(() => ({}))
                if (res.ok) {
                  toast.success('Reset link requested', {
                    description: json.message ?? 'If an account exists for that email, a reset link has been sent.',
                  })
                  setForgotOpen(false)
                } else if (res.status === 429) {
                  toast.error('Too many attempts. Please wait a few minutes and try again.')
                } else {
                  toast.error('Unable to request a reset. Please try again.')
                }
              } catch {
                toast.error('Unable to request a reset. Please try again.')
              } finally {
                setForgotSending(false)
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@dronalogitech.com"
                  className="pl-9"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  disabled={forgotSending}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={forgotSending}>
              {forgotSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send reset link
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
