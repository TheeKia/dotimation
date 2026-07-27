/// <reference lib="webworker" />
import type { AnimateItem, FieldTargets } from '@/types'
import { createAsyncLru } from '../utils/async-lru'
import { drawImage, drawText } from './draw'
import { invertPixels, sampleTargets } from './sample'

// Decoded-bitmap cache; evicted bitmaps are closed to release their pixel
// memory. The cache dies with the worker's ~10 s idle self-termination, so
// memory is bounded in time as well as by the cap.
const bitmapCache = createAsyncLru<ImageBitmap>(4, (evicted) => {
  evicted.then(
    (bmp) => bmp.close(),
    () => {},
  )
})

function loadBitmap(src: string): Promise<ImageBitmap> {
  const cached = bitmapCache.get(src)
  if (cached) return cached
  const loading = (async () => {
    const res = await fetch(src, { mode: 'cors' })
    return createImageBitmap(await res.blob())
  })()
  // Drop failed loads so a later request can retry them.
  loading.catch(() => bitmapCache.delete(src))
  bitmapCache.set(src, loading)
  return loading
}

interface RasterRequest {
  id: number
  item: AnimateItem
  width: number
  height: number
  defaultFontFamily: string
  threshold: number
  spacingCss: number
  max: number
  dpr: number
}

async function run(req: RasterRequest): Promise<FieldTargets> {
  const w = Math.round(req.width * req.dpr)
  const h = Math.round(req.height * req.dpr)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('worker: no 2d context')
  ctx.setTransform(req.dpr, 0, 0, req.dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  if (req.item.type === 'image') {
    // The cache owns the bitmap's lifetime (closed on eviction), so no
    // close() here — the next request for the same URL reuses it.
    const bmp = await loadBitmap(req.item.data)
    drawImage(ctx, bmp, bmp.width, bmp.height, req.width, req.height, req.item)
  } else {
    drawText(ctx, req.item, req.width, req.height, req.defaultFontFamily)
  }

  const img = ctx.getImageData(0, 0, w, h)
  if (req.item.type === 'image' && req.item.invert) invertPixels(img.data)
  return sampleTargets(
    img.data,
    w,
    h,
    req.dpr,
    req.spacingCss,
    req.threshold,
    undefined,
    req.max,
  )
}

self.onmessage = (e: MessageEvent<RasterRequest>): void => {
  run(e.data).then(
    (targets) => {
      const transfer = [
        targets.homeX.buffer,
        targets.homeY.buffer,
        targets.homeR.buffer,
        targets.homeG.buffer,
        targets.homeB.buffer,
      ]
      ;(self as DedicatedWorkerGlobalScope).postMessage(
        { id: e.data.id, targets },
        transfer,
      )
    },
    (err) => {
      ;(self as DedicatedWorkerGlobalScope).postMessage({
        id: e.data.id,
        error: String(err),
      })
    },
  )
}
