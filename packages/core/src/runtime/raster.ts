import { type RasterInputs, sameRasterInputs } from '../raster/inputs'
import { rasterize } from '../raster/rasterize'
import {
  rasterizeViaWorker,
  workerRasterAvailable,
} from '../raster/rasterize-worker'
import { emptyFieldTargets } from '../raster/sample'
import { isWorkerSafe } from '../raster/worker-safe'
import type { FieldTargets } from '../types'
import { createLatestWins } from '../utils/latest-wins'
import { getDpr } from '../utils/utils'

export async function runRasterize(
  inputs: RasterInputs,
): Promise<FieldTargets> {
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
  const args = [
    width,
    height,
    item,
    defaultFontFamily,
    threshold,
    spacing,
    max,
    getDpr(maxDpr),
  ] as const
  if (workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)) {
    try {
      return await rasterizeViaWorker(...args)
    } catch {
      // Worker failures always retain the main-thread path, including CSP and
      // missing OffscreenCanvas support. Custom fonts never enter the worker.
    }
  }
  return rasterize(...args)
}

export interface RasterScheduler {
  update(inputs: RasterInputs): void
  invalidate(): void
}

/** One in-flight raster and one latest queued input, independent of framework. */
export function createRasterScheduler(
  publish: (targets: FieldTargets) => void,
  run: typeof runRasterize = runRasterize,
): RasterScheduler {
  let previous: RasterInputs | null = null
  let generation = 0
  const schedule = createLatestWins<{ inputs: RasterInputs; id: number }>(
    async ({ inputs, id }) => {
      if (id !== generation) return
      let targets: FieldTargets
      try {
        targets = await run(inputs)
      } catch (error) {
        if (id !== generation) return
        previous = null
        console.warn('[dotimation] rasterization failed', error)
        return
      }
      if (id === generation) publish(targets)
    },
  )
  return {
    update(inputs): void {
      if (previous && sameRasterInputs(previous, inputs)) return
      // Snapshot caller-owned values: a later in-place mutation must not make
      // the previous input silently compare equal to the next update.
      previous = { ...inputs, item: { ...inputs.item } }
      const id = ++generation
      if (!inputs.item.data || inputs.width <= 0 || inputs.height <= 0) {
        publish(emptyFieldTargets())
      } else {
        schedule({ inputs: previous, id })
      }
    },
    invalidate(): void {
      generation++
      previous = null
    },
  }
}
