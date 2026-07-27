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
    threshold,
    spacing,
    max,
    maxDpr,
  } = inputs
  const dpr = getDpr(maxDpr)
  if (workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)) {
    return rasterizeViaWorker(
      width,
      height,
      item,
      defaultFontFamily,
      threshold,
      spacing,
      max,
      dpr,
    ).catch(() =>
      rasterize(
        width,
        height,
        item,
        defaultFontFamily,
        threshold,
        spacing,
        max,
        dpr,
      ),
    )
  }
  return rasterize(
    width,
    height,
    item,
    defaultFontFamily,
    threshold,
    spacing,
    max,
    dpr,
  )
}

export function useFieldTargets(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  threshold: number,
  spacing: number,
  max: number,
  maxDpr: number,
  dprEpoch: number,
  fontEpoch: number,
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
      threshold,
      spacing,
      max,
      maxDpr,
      dprEpoch,
      fontEpoch,
    }
    if (prev.current && sameRasterInputs(prev.current, next)) return
    prev.current = next
    const id = ++executionId.current

    // An empty item is a valid layout (zero particles): publish it so the
    // field fades out instead of freezing the previous content forever. A
    // non-positive size means fill mode hasn't measured yet — same treatment.
    if (!item.data || width <= 0 || height <= 0) {
      setTargets(emptyFieldTargets())
      return
    }
    schedule.current?.({ inputs: next, id })
  }, [
    width,
    height,
    item,
    defaultFontFamily,
    threshold,
    spacing,
    max,
    maxDpr,
    dprEpoch,
    fontEpoch,
  ])

  return targets
}
