'use client'

// Drona Logitech — Centralized MIS sign-in experience.
// A professional logistics hero: the company truck/road video plays quietly
// behind the brand lockup on the left, with a clean white sign-in card on the
// right. Self-signup has been retired — accounts are provisioned by
// administrators from Users & Settings. All auth logic is unchanged (Auth.js
// credentials → JWT cookie session); this file is UI only.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import { Eye, EyeOff, KeyRound, Loader2, Lock, Mail, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
import { DronaFullLogo } from '@/components/brand/DronaLogo'

// Purely client-side convenience for the "Remember me" control — it remembers
// the last email for prefill only. It never touches auth, sessions or cookies.
const REMEMBER_EMAIL_KEY = 'npl-login-email'

export default function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSending, setForgotSending] = useState(false)
  const setUser = useAppStore((s) => s.setUser)
  const qc = useQueryClient()
  const router = useRouter()

  // ---- reduced motion: honor the OS preference for the entrance ----
  const reduced = useReducedMotion()

  // Prefill a remembered email (client convenience only — see note above).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_EMAIL_KEY)
      if (saved) {
        setEmail(saved)
        setRemember(true)
      }
    } catch {
      /* storage unavailable (private mode / blocked) — ignore */
    }
  }, [])

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
      // remember (or forget) the email for next time — prefill convenience only
      try {
        if (remember) window.localStorage.setItem(REMEMBER_EMAIL_KEY, em)
        else window.localStorage.removeItem(REMEMBER_EMAIL_KEY)
      } catch {
        /* storage unavailable — ignore */
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
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-brand-charcoal">
      {/* ---- background hero video — subtle logistics ambience ---- */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src="/hero-video.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* readability wash — keeps the truck/road visible while text stays legible.
          Stronger on the left (branding) on desktop; a gentle overall dim on mobile. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/45 lg:bg-gradient-to-r lg:from-black/70 lg:via-black/40 lg:to-black/15"
      />

      {/* ---- content ---- */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <main className="flex flex-1 flex-col lg:flex-row lg:items-stretch">
          {/* brand / hero side */}
          <section className="flex flex-col items-center gap-5 px-6 pt-12 text-center sm:pt-16 lg:flex-1 lg:items-start lg:justify-center lg:px-16 lg:pt-0 lg:text-left">
            <DronaFullLogo
              onDark
              eager
              width={440}
              className="h-auto w-[220px] drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)] sm:w-[280px] lg:w-[420px]"
            />
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                Centralized MIS
              </h1>
              <p className="mt-2 text-base font-medium text-white/85 sm:text-lg">
                Experiencing Togetherness
              </p>
              <p className="mx-auto mt-4 hidden max-w-md text-sm leading-relaxed text-white/70 lg:mx-0 lg:block">
                One connected workspace for every shipment, delivery and report — accurate,
                live and shared across the team.
              </p>
            </div>
            <span className="sr-only">Drona Logitech — Experiencing Togetherness.</span>
          </section>

          {/* sign-in card side */}
          <section className="flex items-center justify-center px-6 pb-12 pt-8 sm:px-10 lg:w-[560px] lg:px-14 lg:py-0">
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="w-full max-w-md rounded-2xl border border-black/5 bg-white p-6 shadow-2xl sm:p-8 dark:border-white/10 dark:bg-card"
            >
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Sign in</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use your Drona Logitech account to continue.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
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
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(v) => setRemember(v === true)}
                      disabled={loading}
                      aria-label="Remember me"
                    />
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email)
                      setForgotOpen(true)
                    }}
                    className="text-[13px] font-medium text-brand-red underline-offset-4 transition-colors hover:underline focus-visible:underline"
                  >
                    Forgot password?
                  </button>
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
              </form>

              <p className="mt-5 text-center text-[13px] leading-relaxed text-muted-foreground">
                Accounts are provisioned by your administrator.
                <br />
                Need access? Request it from the MIS team.
              </p>
            </motion.div>
          </section>
        </main>

        {/* ---- subtle footer ---- */}
        <footer className="relative z-10 px-6 pb-6 text-center text-xs text-white/60 sm:px-10">
          © {new Date().getFullYear()} Drona Logitech · Centralized MIS · Internal use only
        </footer>
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
