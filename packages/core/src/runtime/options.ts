import type { DotOptions, MotionOptions } from '../engine/params'
import type { AnimateItem, BackendKind, DotimationStats } from '../types'

/** Fixed CSS-pixel dimensions, or a canvas that fills its containing box. */
export type SizeOptions =
  | { width: number; height: number; fill?: false }
  | { fill: true; width?: undefined; height?: undefined }

/** Framework-independent component options. */
export type DotimationOptions = SizeOptions & {
  item: AnimateItem
  /** Accessible canvas name; text items default to their text. */
  ariaLabel?: string
  /** @default 'sans-serif' */
  defaultFontFamily?: string
  /** Appearance and sampling; individual fields default and sanitize in core. */
  dots?: DotOptions
  /** Spring feel, fade and shimmer. Updates preserve the active simulation. */
  motion?: MotionOptions
  /** @default 'auto' */
  backend?: BackendKind
  /** Device pixel ratio cap. @default 2 */
  maxDpr?: number
  /** Omit to follow the operating system preference. */
  reducedMotion?: boolean
  /** Particle assignment: chaotic swarm or spatially nearest homes.
   * Applies from the next content change. @default 'swarm' */
  matching?: 'swarm' | 'nearest'
  /** Reports the resolved backend and active particle count on startup/layout updates. */
  onStats?: (stats: DotimationStats) => void
}
