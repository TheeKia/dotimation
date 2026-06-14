import type { AnimateItem } from '@/types'
import { getAutoFontSize, getMonospaceFontSize } from '@/utils/font'

export const DEFAULT_TEXT_COLOR = 'rgb(200,200,200)'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function resolveFontSize(
  item: Extract<AnimateItem, { type: 'text' }>,
  width: number,
): number {
  if (item.fontSize === 'AUTO_MONO')
    return getMonospaceFontSize(width, item.data)
  if (item.fontSize === 'AUTO' || item.fontSize === undefined) {
    return getAutoFontSize(width, item.data)
  }
  return item.fontSize
}

export function drawText(
  ctx: Ctx2D,
  item: Extract<AnimateItem, { type: 'text' }>,
  width: number,
  height: number,
  defaultFontFamily: string,
): void {
  const fontSize = resolveFontSize(item, width)
  ctx.font = `${fontSize}px ${item.fontFamily || defaultFontFamily}`
  ctx.fillStyle = item.textColor || DEFAULT_TEXT_COLOR
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = item.data.split('\n')
  const lineHeight = fontSize * 1.2
  const startY = (height - lines.length * lineHeight) / 2 + lineHeight / 2
  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, width / 2, startY + index * lineHeight)
  }
}

export function imageScale(
  width: number,
  height: number,
  imgW: number,
  imgH: number,
  item: Extract<AnimateItem, { type: 'image' }>,
): number {
  const wScale = item.maxWidth ? item.maxWidth / imgW : Number.POSITIVE_INFINITY
  const hScale = item.maxHeight
    ? item.maxHeight / imgH
    : Number.POSITIVE_INFINITY
  const userScale = Math.min(wScale, hScale)
  const scaleLimit = Math.min(width / imgW, height / imgH)
  return Math.min(userScale, scaleLimit)
}

export function drawImage(
  ctx: Ctx2D,
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  width: number,
  height: number,
  item: Extract<AnimateItem, { type: 'image' }>,
): void {
  const scale = imageScale(width, height, imgW, imgH, item)
  const sw = imgW * scale
  const sh = imgH * scale
  const x = (width - sw) / 2
  const y = (height - sh) / 2
  if (item.invert) {
    ctx.save()
    ctx.filter = 'invert(1)'
    ctx.drawImage(image, x, y, sw, sh)
    ctx.restore()
  } else {
    ctx.drawImage(image, x, y, sw, sh)
  }
}
