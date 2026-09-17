#!/usr/bin/env python3
"""Regenerate src/components/brand/DronaLogo.tsx for the DRONA LOGITECH logo,
injecting the potrace-traced emblem path into the DronaMark vector component."""

PATH_DATA = open('/tmp/gdrive/emblem-d.txt').read().strip()

FILE = '''// Drona Logitech — brand identity components (authentic logo system)
//
// The artwork is the official DRONA LOGITECH logo: the wordmark DRONA with a
// golden double-spiral emblem as the O, "LOGITECH" flanked by outward-pointing
// arrows, and the tagline "Experiencing Togetherness" beneath. The full logo
// (/brand/logo-main) is the original artwork, derived directly from the
// supplied company logo file (transparent background — placed directly on
// surfaces, never on a plate).
//
// Palette (sampled from the artwork):
//   wordmark + LOGITECH  #DF1E1E  (Drona Red)
//   emblem spiral        #FFA41C  (Emblem Gold)
//   tagline              #231F20  (near-black; lifted to warm grey on dark)
// Dark surfaces keep the red/gold as-is; only the tagline is lifted.

import { cn } from '@/lib/utils'

/**
 * The traced vector emblem — the double-spiral 'O' of DRONA, potrace-derived
 * from the original artwork (viewBox 0 0 460 401, single fill path).
 * Crisp from 16px (favicon / collapsed sidebar) upward.
 */
const EMBLEM_PATH =
  '__PATH__'

const LIGHT_EMBLEM = '#FFA41C'
const DARK_EMBLEM = '#FFB62E'

/**
 * The Drona Logitech emblem mark — the simplified authentic logo icon.
 */
export function DronaMark({
  size = 36,
  onDark = false,
  className,
}: {
  size?: number
  onDark?: boolean
  className?: string
}) {
  return (
    <svg
      width={size}
      height={Math.round((size * 401) / 460)}
      viewBox="0 0 460 401"
      role="img"
      aria-label="Drona Logitech"
      className={className}
    >
      <path d={EMBLEM_PATH} fill={onDark ? DARK_EMBLEM : LIGHT_EMBLEM} fillRule="nonzero" />
    </svg>
  )
}

/**
 * The original Drona Logitech artwork (raster) — the DRONA wordmark with the
 * spiral emblem in the O, the arrowed LOGITECH line and the tagline.
 * 1280x548 source asset, transparent background — the logo is placed directly
 * on surfaces, never on a plate. `onDark` selects the dark-surface variant
 * (same red/gold artwork; only the near-black tagline is lifted to a warm
 * grey so it stays legible on charcoal).
 */
export function DronaFullLogo({
  width = 300,
  className,
  eager = false,
  onDark = false,
}: {
  width?: number
  className?: string
  eager?: boolean
  onDark?: boolean
}) {
  const height = Math.round((width * 548) / 1280)
  const stem = onDark ? '/brand/logo-main-dark' : '/brand/logo-main'
  return (
    <picture>
      <source srcSet={`${stem}.webp`} type="image/webp" />
      <img
        src={`${stem}.png`}
        width={width}
        height={height}
        alt="Drona Logitech"
        className={className}
        decoding={eager ? 'sync' : 'async'}
        loading={eager ? 'eager' : undefined}
      />
    </picture>
  )
}

/**
 * The ORIGINAL company emblem, cropped straight from the supplied logo
 * artwork (the double-spiral 'O' of DRONA).
 * 340x296 source asset, transparent background — placed directly on the
 * surface. `onDark` selects the charcoal-optimised variant.
 */
export function DronaEmblem({
  width = 34,
  className,
  eager = false,
  onDark = false,
}: {
  width?: number
  className?: string
  eager?: boolean
  onDark?: boolean
}) {
  const height = Math.round((width * 296) / 340)
  const stem = onDark ? '/brand/logo-emblem-dark' : '/brand/logo-emblem'
  return (
    <picture>
      <source srcSet={`${stem}.webp`} type="image/webp" />
      <img
        src={`${stem}.png`}
        width={width}
        height={height}
        alt="Drona Logitech"
        className={className}
        decoding={eager ? 'sync' : 'async'}
        loading={eager ? 'eager' : undefined}
      />
    </picture>
  )
}

/**
 * Ambient warm-gold halo — lets the transparent original artwork sit directly
 * ON the charcoal sidebar instead of on a plate. Very subtle: a soft radial
 * wash of Emblem Gold behind the logo, no hard edges, no container.
 */
export function BrandGlow({
  width = 200,
  height = 120,
  intensity = 0.14,
  className,
}: {
  width?: number
  height?: number
  intensity?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute select-none', className)}
      style={{
        width,
        height,
        background: `radial-gradient(ellipse at center, rgba(232, 154, 22, ${intensity}) 0%, rgba(232, 154, 22, ${
          intensity * 0.4
        }) 45%, rgba(232, 154, 22, 0) 72%)`,
      }}
    />
  )
}

/** Horizontal lockup — mark + "DRONA LOGITECH" wordmark + sub-line */
export function DronaLockup({
  size = 40,
  sub = 'CENTRALIZED MIS',
  onDark = true,
  showSub = true,
  className,
}: {
  size?: number
  sub?: string
  onDark?: boolean
  showSub?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <DronaMark size={size} onDark={onDark} className="shrink-0" />
      <div className="min-w-0 leading-none">
        <p
          className={cn(
            'font-display font-extrabold tracking-[0.08em]',
            onDark ? 'text-white' : 'text-[#252525]',
          )}
          style={{ fontSize: size * 0.42 }}
        >
          DRONA{' '}
          <span className={cn('font-bold tracking-[0.22em]', onDark ? 'text-[#E89A16]' : 'text-[#A91518]')}>
            LOGITECH
          </span>
        </p>
        {showSub && (
          <p
            className={cn(
              'mt-1.5 font-semibold uppercase tracking-[0.30em]',
              onDark ? 'text-white/55' : 'text-[#6B6B6B]',
            )}
            style={{ fontSize: Math.max(size * 0.23, 8.5) }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Decorative fingerprint arcs — the ambient brand texture.
 * Renders stroke-only concentric arcs (currentColor) + one gold route arc.
 * Used in the sidebar, login panel, empty states — always subtle.
 */
export function DronaArcs({
  width = 320,
  height = 320,
  className,
  goldArc = true,
  opacity = 1,
}: {
  width?: number
  height?: number
  className?: string
  goldArc?: boolean
  opacity?: number
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 320 320"
      aria-hidden="true"
      className={cn('pointer-events-none select-none', className)}
      style={{ opacity }}
    >
      <g fill="none" strokeLinecap="round">
        <path d="M 70 300 A 110 110 0 0 1 290 90" stroke="currentColor" strokeWidth="2" opacity="0.5" />
        <path d="M 30 300 A 150 150 0 0 1 300 60" stroke="currentColor" strokeWidth="2.5" opacity="0.4" />
        <path d="M -10 300 A 190 190 0 0 1 300 20" stroke="currentColor" strokeWidth="3" opacity="0.3" />
        {goldArc && (
          <path d="M 50 300 A 130 130 0 0 1 295 75" stroke="#E89A16" strokeWidth="2.5" opacity="0.55" />
        )}
      </g>
    </svg>
  )
}

/** Gold route divider — a thin logistics route line with origin/destination nodes */
export function RouteDivider({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 8" height={8} preserveAspectRatio="none" aria-hidden="true" className={cn('w-full', className)}>
      <line x1="6" y1="4" x2="194" y2="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <line x1="6" y1="4" x2="140" y2="4" stroke="#E89A16" strokeWidth="1.5" />
      <circle cx="6" cy="4" r="2.6" fill="#E89A16" />
      <circle cx="140" cy="4" r="2.2" fill="#E89A16" />
      <circle cx="194" cy="4" r="2" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

/** Route-line loading indicator — a shipment moving along its route */
export function RouteLoader({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)} role="status" aria-live="polite">
      <svg width="132" height="14" viewBox="0 0 132 14" aria-hidden="true">
        <line x1="4" y1="7" x2="128" y2="7" stroke="currentColor" strokeWidth="1.5" opacity="0.18" className="text-foreground" />
        <line
          x1="4" y1="7" x2="128" y2="7"
          stroke="#E89A16" strokeWidth="1.5"
          strokeDasharray="24 104"
          className="drona-route-dash"
        />
        <circle cx="4" cy="7" r="3" fill="#A91518" />
        <circle cx="128" cy="7" r="3" fill="none" stroke="#E89A16" strokeWidth="1.5" />
      </svg>
      {label && <p className="text-[13px] text-muted-foreground">{label}</p>}
    </div>
  )
}
'''

out = FILE.replace('__PATH__', PATH_DATA)
dest = '/home/z/my-project/src/components/brand/DronaLogo.tsx'
open(dest, 'w').write(out)
print(f'wrote {dest}: {len(out)} chars (path data {len(PATH_DATA)} chars injected)')
