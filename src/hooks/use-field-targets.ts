import { useEffect, useRef, useState } from 'react'
import { type RasterInputs, sameRasterInputs } from '@/raster/inputs'
import { rasterize } from '@/raster/rasterize'
import {
  rasterizeViaWorker,
  workerRasterAvailable,
} from '@/raster/rasterize-worker'
import { emptyFieldTargets } from '@/raster/sample'
import { isWorkerSafe } from '@/raster/worker-safe'
import type { AnimateItem, FieldTargets } from '@/types'
import { getDpr } from '@/utils/utils'

export function useFieldTargets(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number,
  dprEpoch: number,
): FieldTargets | null {
  const [targets, setTargets] = useState<FieldTargets | null>(null)
  const prev = useRef<RasterInputs | null>(null)
  const executionId = useRef(0)

  useEffect(() => {
    const next: RasterInputs = {
      item,
      width,
      height,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
      maxParticles,
      dprEpoch,
    }
    if (prev.current && sameRasterInputs(prev.current, next)) return
    prev.current = next
    const id = ++executionId.current

    // An empty item is a valid layout (zero particles): publish it so the
    // field fades out instead of freezing the previous content forever.
    if (!item.data) {
      setTargets(emptyFieldTargets())
      return
    }

    const dpr = getDpr()
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
        // the canvas is tainted). Keep the previously rendered targets, but
        // forget these inputs so a later render can retry them.
        if (id === executionId.current && prev.current === next) {
          prev.current = null
        }
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
    dprEpoch,
  ])

  return targets
}
