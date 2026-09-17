// Drona Logitech — brand identity components (authentic logo system)
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
  'M243.5 399.9C227.9 397.6 206.5 389.1 192.9 379.9C164 360.5 145.1 335.6 134.6 303.4C124.4 272.2 125.9 240.5 138.8 213.6C145.8 199.1 153.8 188.9 174 168.9C195.8 147.3 198.8 145.5 212.5 145.5C220.5 145.5 222.2 145.8 228.2 148.7C236.6 152.7 243.3 159.4 247.4 168C250.2 173.8 250.5 175.5 250.5 183.5C250.5 197.1 249.5 198.6 224.4 224C212.8 235.8 202.9 246.6 202.5 247.8C200.4 254.9 206.6 263 214.3 263C218.5 263 218.5 263 252.6 228.8C288.4 192.8 293.3 186.8 299.2 172.7C307.8 152.5 308.2 123.7 300.4 101.8C294.3 85 285.6 71.4 272.6 58.4C249.9 35.9 224.3 25 193.8 25C180 25 169.7 26.8 159.2 31.2C144.6 37.3 140 41.3 92.4 89.1C67.6 114.1 45.9 136.5 44.3 139C33 155.9 25 181.4 25 200.6C25 205.5 25.7 213.7 26.6 219C28 227.6 28 229 26.7 232.2C25 236.2 21.3 238.6 15.3 239.6C12 240.1 10.9 239.8 8.2 237.6C6.5 236.1 4.1 232.4 2.8 229.2C0.7 223.8 0.5 222.2 0.5 201.5C0.6 181.7 0.8 178.6 2.9 171C8 151.9 16.3 134.6 27.5 119.5C30.4 115.7 52.5 92.7 76.6 68.4C123 21.8 127.3 18.1 144.2 10C148.8 7.8 157 4.8 162.5 3.3C171.9 0.7 173.8 0.5 193 0.5C209.6 0.5 215 0.9 221.5 2.4C263.8 12.3 298.1 39.2 317.5 77.7C338.7 119.9 336.2 168 310.9 204C307.6 208.7 292.2 225 270.1 247.2C238.8 278.6 233.8 283.3 228.5 285.7C210.8 293.7 189.7 285.3 180.2 266.4C175.3 256.7 175.5 242 180.5 233.4C181.9 231 192.5 219.6 204 208C224.5 187.5 225 186.8 225 182.9C225 179.4 224.4 178.1 221.1 174.9C217.8 171.6 216.6 171 212.9 171C208.8 171 208.3 171.4 194.7 184.8C176.2 203 169 211.5 164.2 220.8C150 248.4 149.7 279.6 163.3 308.4C178.5 340.4 204.1 362.3 238.5 372.6C251.5 376.4 272.6 377.1 285.3 374.1C297.2 371.3 308 366.9 315.9 361.5C323.4 356.5 406.2 274.2 413.5 264.4C430 242.5 438.2 209.5 433.5 183.5C431.4 172.1 431.6 170.6 435 166.6C443.5 157 454.9 161.3 458 175.3C459.8 183.4 460.4 208.3 459.1 218.3C456 241.7 446.3 263.6 430 284.1C420.9 295.6 344.6 371.6 334.8 379C325.3 386.2 310.1 393.8 297.5 397.6C289.2 400.1 287 400.4 269 400.6C258.3 400.7 246.8 400.4 243.5 399.9ZM124.3 362.9C120.3 361.7 117.4 358.2 110.5 346.1C84.2 299.7 75.2 245.3 87.5 207.7C90.9 197.2 96 186.6 102.2 177.4C107.1 170.1 141.1 133.8 145.4 131.3C148.3 129.6 154.5 129.7 158 131.5C164 134.6 166 144.1 161.8 149.6C160.6 151.2 152.6 159.7 143.9 168.5C123.8 189 117.1 199.3 110.9 219C108.7 225.9 108.5 228.2 108.5 247C108.5 263.2 108.9 269.2 110.3 275.5C115.1 296.8 122.8 316 134.9 337C139.1 344.3 140.3 347.5 140.3 350.7C140.3 359.3 132.6 365.2 124.3 362.9ZM61 316.4C54 310.5 45.1 285.3 40.5 258.2C38.4 245.8 38.4 215.1 40.5 202.8C43.8 184 51.7 165 62.1 151C67.7 143.4 95.9 114.3 101.3 110.5C106.1 107.1 115.6 109.6 118.6 115.2C120.7 118.9 120.3 125.3 117.8 128.6C116.6 130.2 108.6 138.7 100 147.5C91.4 156.3 83 165.5 81.3 168C59.5 200.2 58.2 251.8 78 297C81.7 305.3 81.6 309.7 77.8 313.7C72.4 319.5 66 320.5 61 316.4ZM348.6 292C342.3 290.1 338.3 283.6 339.5 277.3C340.1 274.2 343.1 270.6 357.9 255.5C367.6 245.6 377.3 234.9 379.3 231.8C386.7 220.5 391.6 207.1 394.6 190C398.6 167.1 392.6 125.1 382.5 105C379.4 98.7 378.6 94.6 380 90.5C381.7 85.3 385.3 83 391.5 83C400.5 83 404 87.6 410.6 107.9C418.5 132.2 421.4 149.1 421.3 171.5C421.3 202.9 413 229.6 396.9 251C389.9 260.1 358 292 355.8 292C354.9 292 353.6 292.2 352.8 292.4C352.1 292.6 350.2 292.4 348.6 292ZM300.9 269.5C297.8 267.8 295 262.4 295 258.3C295 253.8 299.8 247.2 310.4 237.5C338.7 211.3 348.9 193.2 352 163.8C354.9 135.6 344.3 96.1 325 63.4C318.4 52.4 317.6 48.6 320.9 43.6C324.7 37.9 331.5 36.4 338 39.8C346.8 44.6 367.9 91 374 119C380.8 150 378.3 181.4 367 206.5C363.4 214.4 356.4 225.5 350.2 233C343 241.7 316.8 268 313.8 269.6C310.4 271.4 304.3 271.3 300.9 269.5Z'

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
