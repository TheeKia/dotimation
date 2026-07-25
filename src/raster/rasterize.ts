import type { AnimateItem, FieldTargets } from '@/types'
import { createAsyncLru } from '@/utils/async-lru'
import { getCtx, getDpr } from '@/utils/utils'
import { drawImage, drawText } from './draw'
import { emptyFieldTargets, invertPixels, sampleTargets } from './sample'

// Decoded-image cache: a resize storm re-rasterizes the same URL dozens of
// times; caching the decoded element skips the fetch+decode each time. Small
// cap — entries are full decoded images.
const imageCache = createAsyncLru<HTMLImageElement>(4)

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached
  const loading = (async () => {
    const image = new Image()
    // crossOrigin must be set BEFORE src or the request goes out without CORS,
    // tainting the canvas and making getImageData throw for cross-origin images.
    image.crossOrigin = 'anonymous'
    image.src = src
    await image.decode()
    return image
  })()
  // Drop failed loads so a later render can retry them.
  loading.catch(() => imageCache.delete(src))
  imageCache.set(src, loading)
  return loading
}

export async function rasterize(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number = Number.POSITIVE_INFINITY,
): Promise<FieldTargets> {
  const empty = emptyFieldTargets()

  const canvas = document.createElement('canvas')
  const ctx = getCtx(canvas, width, height)
  if (!ctx) return empty

  if (item.type === 'image') {
    const image = await loadImage(item.data)
    drawImage(ctx, image, image.width, image.height, width, height, item)
  } else {
    drawText(ctx, item, width, height, defaultFontFamily)
  }

  const dpr = getDpr()
  const devW = canvas.width
  const devH = canvas.height
  const img = ctx.getImageData(0, 0, devW, devH)
  if (item.type === 'image' && item.invert) invertPixels(img.data)
  return sampleTargets(
    img.data,
    devW,
    devH,
    dpr,
    pointSpacingCss,
    alpha,
    undefined,
    maxParticles,
  )
}
