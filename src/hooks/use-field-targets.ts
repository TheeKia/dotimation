import { useEffect, useRef, useState } from 'react'
import { rasterize } from '@/raster/rasterize'
import {
  rasterizeViaWorker,
  workerRasterAvailable,
} from '@/raster/rasterize-worker'
import { isWorkerSafe } from '@/raster/worker-safe'
import type { AnimateItem, FieldTargets } from '@/types'

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const keysA = Object.keys(a) as (keyof T)[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}

export function useFieldTargets(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number,
): FieldTargets | null {
  const [targets, setTargets] = useState<FieldTargets | null>(null)
  const prevItem = useRef<AnimateItem | null>(null)
  const prevSize = useRef({ width: 0, height: 0 })
  const executionId = useRef(0)

  useEffect(() => {
    if (!item.data) return
    const itemChanged =
      !prevItem.current || !shallowEqual(prevItem.current, item)
    const sizeChanged =
      prevSize.current.width !== width || prevSize.current.height !== height
    if (!itemChanged && !sizeChanged) return
    prevItem.current = item
    prevSize.current = { width, height }
    const id = ++executionId.current
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const useWorker =
      workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)
    const task = useWorker
      ? rasterizeViaWorker(
          width,
          height,
          item,
          defaultFontFamily,
          alpha,
          pointSpacingCss,
          maxParticles,
          dpr,
        ).catch(() =>
          rasterize(
            width,
            height,
            item,
            defaultFontFamily,
            alpha,
            pointSpacingCss,
            maxParticles,
          ),
        )
      : rasterize(
          width,
          height,
          item,
          defaultFontFamily,
          alpha,
          pointSpacingCss,
          maxParticles,
        )
    task
      .then((t) => {
        if (id === executionId.current) setTargets(t)
      })
      .catch((err) => {
        // Rasterization can reject (e.g. a cross-origin image fails to load or
        // the canvas is tainted). Don't leave the rejection unhandled; keep the
        // previously rendered targets in place.
        if (typeof console !== 'undefined') {
          console.warn('[dotimation] rasterization failed', err)
        }
      })
  }, [
    width,
    height,
    item,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
  ])

  return targets
}
