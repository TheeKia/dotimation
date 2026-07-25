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
import { createLatestWins } from '@/utils/latest-wins'
import { getDpr } from '@/utils/utils'

interface RasterJob {
  inputs: RasterInputs
  id: number
}

/** Worker-first rasterization with a main-thread fallback on any failure. */
function runRasterize(inputs: RasterInputs): Promise<FieldTargets> {
  const {
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
  } = inputs
  const dpr = getDpr()
  if (workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)) {
    return rasterizeViaWorker(
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
  }
  return rasterize(
    width,
    height,
    item,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
  )
}

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
  // One scheduler per hook instance: rasterization storms (drag-resize) are
  // coalesced to "one in flight + the newest waiting" instead of one full
  // pixel walk per input change. The executionId guard keeps a completed-but-
  // superseded run from publishing stale targets.
  const schedule = useRef<((job: RasterJob) => void) | null>(null)
  if (schedule.current === null) {
    schedule.current = createLatestWins<RasterJob>(async ({ inputs, id }) => {
      try {
        const t = await runRasterize(inputs)
        if (id === executionId.current) setTargets(t)
      } catch (err) {
        // Rasterization can reject (e.g. a cross-origin image fails to load or
        // the canvas is tainted). Keep the previously rendered targets, but
        // forget these inputs so a later render can retry them.
        if (id === executionId.current && prev.current === inputs) {
          prev.current = null
        }
        if (typeof console !== 'undefined') {
          console.warn('[dotimation] rasterization failed', err)
        }
      }
    })
  }

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
    schedule.current?.({ inputs: next, id })
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
