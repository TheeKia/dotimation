import { tuneSpring } from './settle'

/** User-facing dot field options (the `dots` prop). All optional. */
export interface DotOptions {
  /** Dot footprint in CSS px (scales with devicePixelRatio). @default 1 */
  size?: number
  /** Sampling grid step in CSS px; larger = sparser dots. Min 1. @default 2 */
  spacing?: number
  /** Alpha cutoff (0-255) a source pixel must exceed to become a dot. @default 128 */
  threshold?: number
  /** Cap on total particles (uniform random subset). @default unbounded */
  max?: number
}

/** User-facing motion options (the `motion` prop). All optional. */
export interface MotionOptions {
  /** Shimmer amplitude in px per physics step; 0 disables. @default 1 */
  jitter?: number
  /** Seconds for a morph to converge. Floored at 0.2. @default 0.85 */
  settleTime?: number
  /** Damping ratio: 1 = no overshoot, lower = bouncier. Clamped to [0.3, 1]. @default 1 */
  damping?: number
  /** Opacity ease rate per second for fade-in/out. @default 2 */
  fade?: number
}

export interface ResolvedDots {
  size: number
  spacing: number
  threshold: number
  max: number
}

export interface ResolvedMotion {
  jitter: number
  settleTime: number
  damping: number
  fade: number
}

/**
 * Everything the engine and backends need per instance, derived in one place
 * (`toSimParams`) so the three tiers cannot drift. Applied live via
 * Engine.setParams / Backend.setParams — no recreation on change.
 */
export interface SimParams {
  dotSize: number
  jitter: number
  k: number
  c: number
  settleTime: number
  opacityRate: number
  colorRate: number
}

/** Per-second color ease rate toward home color. Internal (not user-exposed). */
export const COLOR_RATE: number = 2

export const DEFAULT_DOTS: ResolvedDots = {
  size: 1,
  spacing: 2,
  threshold: 128,
  max: Number.POSITIVE_INFINITY,
}

export const DEFAULT_MOTION: ResolvedMotion = {
  jitter: 1,
  settleTime: 0.85,
  damping: 1,
  fade: 2,
}

/**
 * Integrator-stability floors. The spring runs semi-implicit Euler at 90 Hz
 * (FIXED_DT = 1/90), stable roughly while wn*dt < 2 with wn = 4/(zeta*settleTime).
 * These floors give worst-case wn = 4/(0.3*0.2) ~= 66.7 -> wn*dt ~= 0.74,
 * comfortably stable with margin for the jitter forcing. tuneSpring's settling
 * formula additionally requires zeta <= 1.
 */
export const MIN_SETTLE_TIME: number = 0.2
export const MIN_DAMPING: number = 0.3

function num(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Fills defaults and sanitizes out-of-range input (silently — degrade, never throw). */
export function resolveDots(input?: DotOptions): ResolvedDots {
  const size = num(input?.size, DEFAULT_DOTS.size)
  const spacing = num(input?.spacing, DEFAULT_DOTS.spacing)
  const threshold = num(input?.threshold, DEFAULT_DOTS.threshold)
  // Infinity is the valid "unbounded" value for max, so only NaN falls back.
  const rawMax = input?.max
  const max =
    typeof rawMax === 'number' && !Number.isNaN(rawMax)
      ? Math.max(0, Math.floor(rawMax))
      : DEFAULT_DOTS.max
  return {
    size: size > 0 ? size : DEFAULT_DOTS.size,
    spacing: Math.max(1, spacing),
    threshold: Math.min(255, Math.max(0, threshold)),
    max,
  }
}

/** Fills defaults and sanitizes; see MIN_SETTLE_TIME / MIN_DAMPING for the floors. */
export function resolveMotion(input?: MotionOptions): ResolvedMotion {
  const jitter = num(input?.jitter, DEFAULT_MOTION.jitter)
  const settleTime = num(input?.settleTime, DEFAULT_MOTION.settleTime)
  const damping = num(input?.damping, DEFAULT_MOTION.damping)
  const fade = num(input?.fade, DEFAULT_MOTION.fade)
  return {
    jitter: Math.max(0, jitter),
    settleTime: Math.max(
      MIN_SETTLE_TIME,
      settleTime > 0 ? settleTime : DEFAULT_MOTION.settleTime,
    ),
    damping: Math.min(1, Math.max(MIN_DAMPING, damping)),
    fade: fade > 0 ? fade : DEFAULT_MOTION.fade,
  }
}

/**
 * The single place tuneSpring is applied. `reduced` zeroes the jitter
 * (accessibility always wins over the motion prop).
 */
export function toSimParams(
  motion: ResolvedMotion,
  dotSize: number,
  reduced: boolean,
): SimParams {
  const { k, c } = tuneSpring({
    settleTime: motion.settleTime,
    zeta: motion.damping,
  })
  return {
    dotSize,
    jitter: reduced ? 0 : motion.jitter,
    k,
    c,
    settleTime: motion.settleTime,
    opacityRate: motion.fade,
    colorRate: COLOR_RATE,
  }
}
