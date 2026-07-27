import type { AnimateItem } from '../types'

/**
 * Everything that affects rasterization output. `useFieldTargets` re-runs the
 * rasterizer exactly when one of these changed — comparing ALL of them here
 * (pure, unit-tested) is the fix for silently ignoring runtime changes to
 * threshold/spacing/max/defaultFontFamily.
 */
export interface RasterInputs {
  item: AnimateItem
  width: number
  height: number
  defaultFontFamily: string
  threshold: number
  spacing: number
  max: number
  /** Density cap applied to devicePixelRatio when rasterizing. */
  maxDpr: number
  /** Bumped by the component when devicePixelRatio changes (see Dotimation). */
  dprEpoch: number
  /** Bumped when the item's custom web font finishes loading (see useFontEpoch). */
  fontEpoch: number
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const keysA = Object.keys(a) as (keyof T)[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}

export function sameRasterInputs(a: RasterInputs, b: RasterInputs): boolean {
  return (
    shallowEqual(a.item, b.item) &&
    a.width === b.width &&
    a.height === b.height &&
    a.defaultFontFamily === b.defaultFontFamily &&
    a.threshold === b.threshold &&
    a.spacing === b.spacing &&
    a.max === b.max &&
    a.maxDpr === b.maxDpr &&
    a.dprEpoch === b.dprEpoch &&
    a.fontEpoch === b.fontEpoch
  )
}
