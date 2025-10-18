import type { AnimateItem, Particle } from './types'

// Scales by text content so wider glyphs (W,M,0-9, emoji, CJK) cost more.
export function getFontSize(width: number, text: string): number {
  const MAX = 300
  const MIN = 10
  if (!text) return MIN

  // Average per-glyph "em" costs (relative to 1em width).
  const AVG = 0.58 // generic fallback
  const LIGHT = 0.46 // a–z
  const HEAVY = 0.72 // W/M
  const UPPER_NUM = 0.64 // A–Z and 0–9
  const SPACE = 0.28 // space
  const PUNCT = 0.38 // .,:;!?-_"'`/\
  const CJK = 1.0 // CJK full-width-ish
  const EMOJI = 1.1

  // Estimate total "em width" for the string
  let emTotal = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!

    if (cp <= 0x7f) {
      // Basic Latin
      if (ch === ' ') emTotal += SPACE
      else if (/[.,;:!?'"`\-_/\\]/.test(ch)) emTotal += PUNCT
      else if (/[MW]/.test(ch)) emTotal += HEAVY
      else if (/[A-Z0-9]/.test(ch)) emTotal += UPPER_NUM
      else if (/[a-z]/.test(ch)) emTotal += LIGHT
      else emTotal += AVG
    } else {
      // Emoji + CJK buckets. (Good enough without a full width table.)
      if (cp >= 0x1f300 && cp <= 0x1faff) emTotal += EMOJI
      else if (
        (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
        (cp >= 0x3040 && cp <= 0x30ff) || // JP Kana
        (cp >= 0xac00 && cp <= 0xd7af) // Hangul
      ) {
        emTotal += CJK
      } else {
        emTotal += AVG
      }
    }
  }

  // If fontSize * emTotal ≈ pixel width, then fontSize ≈ width / emTotal.
  // That gives a tight fit. We blend with a gentler width curve for very short labels
  // so "OK" or "Hi" don’t explode visually.
  const n = [...text].length
  const sizeByLength = width / (Math.max(emTotal, 1) + 1)
  const sizeByWidthCurve = Math.sqrt(width) * 2 + Math.log1p(width) // soft growth
  const blend = Math.min(n / 5, 1) // rely on length after ~4 chars

  let px = sizeByLength * blend + sizeByWidthCurve * (1 - blend)

  if (!Number.isFinite(px)) px = MIN
  return Math.max(MIN, Math.min(px, MAX)) * 1.5
}

function getScale(
  width: number,
  height: number,
  image: HTMLImageElement,
  item: AnimateItem,
): number {
  if (item.type !== 'image') return 1

  const wScale = item.maxWidth
    ? item.maxWidth / image.width
    : Number.POSITIVE_INFINITY
  const hScale = item.maxHeight
    ? item.maxHeight / image.height
    : Number.POSITIVE_INFINITY

  const userScale = Math.min(wScale, hScale)
  const scaleLimit = Math.min(width / image.width, height / image.height)

  return Math.min(userScale, scaleLimit)
}

export async function initParticles(
  width: number,
  height: number,
  item: AnimateItem,
  fontFamily: string = 'sans-serif',
): Promise<Particle[]> {
  const canvas = document.createElement('canvas')
  const ctx = getCtx(canvas, width, height)
  if (!ctx) return []

  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  if (item.type === 'image') {
    const image = new Image()
    image.src = item.data
    await image.decode()
    const scale = getScale(width, height, image, item)
    const sw = image.width * scale
    const sh = image.height * scale
    const x = (width - sw) / 2
    const y = (height - sh) / 2
    ctx.drawImage(image, x, y, sw, sh)
  } else {
    const fontSize = getFontSize(width, item.data)
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.fillStyle = 'rgb(200,200,200)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.data, width / 2, height / 2)
  }

  const devW = canvas.width // width * dpr
  const devH = canvas.height // height * dpr
  const img = ctx.getImageData(0, 0, devW, devH)
  const pixels = img.data

  const particles: Particle[] = []
  const densityCss = 2
  const stepDev = Math.max(1, Math.round(densityCss * dpr))
  const ALPHA = 128

  for (let yDev = 0; yDev < devH; yDev += stepDev) {
    for (let xDev = 0; xDev < devW; xDev += stepDev) {
      const idx = (yDev * devW + xDev) * 4
      if (pixels[idx + 3]! > ALPHA) {
        const xCss = xDev / dpr
        const yCss = yDev / dpr
        const r = pixels[idx]!,
          g = pixels[idx + 1]!,
          b = pixels[idx + 2]!

        particles.push({
          x: xCss,
          y: yCss,
          homeX: xCss,
          homeY: yCss,
          vx: 0,
          vy: 0,
          opacity: -Math.random() * 3,
          homeR: r,
          homeG: g,
          homeB: b,
          r,
          g,
          b,
        })
      }
    }
  }

  // Fisher–Yates
  for (let i = particles.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    ;[particles[i], particles[j]] = [particles[j]!, particles[i]!]
  }

  return particles
}

export function getCtx(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // baseline: 1 CSS px == dpr device px
  ctx.imageSmoothingEnabled = false
  return ctx
}
