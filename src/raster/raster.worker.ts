/// <reference lib="webworker" />
import type { AnimateItem, FieldTargets } from '@/types'
import { drawImage, drawText } from './draw'
import { sampleTargets } from './sample'

interface RasterRequest {
  id: number
  item: AnimateItem
  width: number
  height: number
  defaultFontFamily: string
  alpha: number
  pointSpacingCss: number
  maxParticles: number
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
    const res = await fetch(req.item.data, { mode: 'cors' })
    const bmp = await createImageBitmap(await res.blob())
    drawImage(ctx, bmp, bmp.width, bmp.height, req.width, req.height, req.item)
    bmp.close()
  } else {
    drawText(ctx, req.item, req.width, req.height, req.defaultFontFamily)
  }

  const img = ctx.getImageData(0, 0, w, h)
  return sampleTargets(
    img.data,
    w,
    h,
    req.dpr,
    req.pointSpacingCss,
    req.alpha,
    Math.random,
    req.maxParticles,
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
