import type { RefObject } from 'react'

import type { Particle } from '../types'

function tuneSpring({
  settleTime,
  zeta,
}: {
  settleTime: number
  zeta: number
}) {
  const wn = 4 / (zeta * settleTime) // rad/s
  const k = wn * wn // stiffness
  const c = 2 * zeta * wn // damping
  return { k, c }
}

function expLerp(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

const physicsHz = 90
const fixedDt = 1 / physicsHz // seconds per physics step
const maxStepsPerFrame = 8 // prevents spiral after tab restore

const isLittleEndian = (() => {
  if (typeof Uint32Array === 'undefined') return true
  const buf = new ArrayBuffer(4)
  new Uint32Array(buf)[0] = 0x01020304
  return new Uint8Array(buf)[0] === 0x04
})()

function packRGBA(r: number, g: number, b: number, a: number): number {
  return isLittleEndian
    ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}

const colorRate = 2
const opacityRate = 2
const jitterHz = 15
const jitterPeriod = 1 / jitterHz
const jitterAmount = 1

export function animateParticles(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  particlesRef: RefObject<Particle[]>,
  intermediateRef: RefObject<Particle[]>,
  signal: AbortSignal,
): void {
  const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })

  let frameId = 0
  let last = performance.now()
  let accumulator = 0
  let jitterClock = 0
  let imageData: ImageData | null = null
  let pixelView: Uint32Array | null = null

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const devW = canvas.width
  const devH = canvas.height

  const onAbort = () => {
    if (frameId) cancelAnimationFrame(frameId)
    signal.removeEventListener('abort', onAbort)
  }
  if (signal.aborted) return
  signal.addEventListener('abort', onAbort, { once: true })

  function advance(
    p: Particle,
    fadeUp: boolean,
    dt: number,
    doJitter: boolean,
  ) {
    const dx = p.homeX - p.x
    const dy = p.homeY - p.y
    const ax = k * dx - c * p.vx
    const ay = k * dy - c * p.vy

    p.vx += ax * dt
    p.vy += ay * dt
    p.x += p.vx * dt
    p.y += p.vy * dt

    if (doJitter) p.x += (Math.random() - 0.5) * jitterAmount

    p.r = expLerp(p.r, p.homeR, colorRate, dt)
    p.g = expLerp(p.g, p.homeG, colorRate, dt)
    p.b = expLerp(p.b, p.homeB, colorRate, dt)

    p.opacity = fadeUp
      ? Math.min(1, p.opacity + opacityRate * dt)
      : Math.max(0, p.opacity - opacityRate * dt)
  }

  function stepPhysics(dt: number) {
    const arr = particlesRef.current
    const inter = intermediateRef.current
    if (!arr.length && !inter.length) return

    jitterClock += dt
    const doJitter = jitterClock >= jitterPeriod
    if (doJitter) jitterClock -= jitterPeriod

    for (let i = 0; i < inter.length; i++)
      advance(inter[i]!, false, dt, doJitter)
    let w = 0
    for (let r = 0; r < inter.length; r++)
      if (inter[r]!.opacity > 0.001) inter[w++] = inter[r]!
    inter.length = w
    intermediateRef.current = inter
    for (let i = 0; i < arr.length; i++) advance(arr[i]!, true, dt, doJitter)
  }

  function render() {
    const arr = particlesRef.current
    const inter = intermediateRef.current

    // Prepare buffer (device size)
    if (!imageData || imageData.width !== devW || imageData.height !== devH) {
      imageData = ctx.createImageData(devW, devH)
      pixelView = new Uint32Array(imageData.data.buffer)
    } else {
      pixelView!.fill(0)
    }
    const view = pixelView!

    const drawPoint = (p: Particle) => {
      const sa = p.opacity
      if (sa <= 0) return
      const clampedA = sa >= 1 ? 1 : sa

      const xDev = (p.x * dpr + 0.5) | 0
      const yDev = (p.y * dpr + 0.5) | 0
      if (xDev < 0 || yDev < 0 || xDev >= devW || yDev >= devH) return

      const idx = yDev * devW + xDev
      const dst = view[idx]!

      const sr = p.r < 0 ? 0 : p.r > 255 ? 255 : p.r | 0
      const sg = p.g < 0 ? 0 : p.g > 255 ? 255 : p.g | 0
      const sb = p.b < 0 ? 0 : p.b > 255 ? 255 : p.b | 0

      if (dst === 0) {
        view[idx] = packRGBA(sr, sg, sb, (clampedA * 255 + 0.5) | 0)
        return
      }

      const dr = isLittleEndian ? dst & 0xff : (dst >>> 24) & 0xff
      const dg = isLittleEndian ? (dst >>> 8) & 0xff : (dst >>> 16) & 0xff
      const db = isLittleEndian ? (dst >>> 16) & 0xff : (dst >>> 8) & 0xff
      const da = isLittleEndian ? (dst >>> 24) & 0xff : dst & 0xff

      const daN = da / 255
      const outA = clampedA + daN * (1 - clampedA)
      if (outA <= 0) return
      const outR = (sr * clampedA + dr * daN * (1 - clampedA)) / outA
      const outG = (sg * clampedA + dg * daN * (1 - clampedA)) / outA
      const outB = (sb * clampedA + db * daN * (1 - clampedA)) / outA

      view[idx] = packRGBA(
        (outR + 0.5) | 0,
        (outG + 0.5) | 0,
        (outB + 0.5) | 0,
        (outA * 255 + 0.5) | 0,
      )
    }

    for (let i = 0; i < arr.length; i++) drawPoint(arr[i]!)
    for (let i = 0; i < inter.length; i++) drawPoint(inter[i]!)

    ctx.putImageData(imageData, 0, 0)
  }

  const loop = (now: number) => {
    const frameDelta = Math.min(0.05, (now - last) / 1000)
    last = now
    accumulator += frameDelta

    let steps = 0
    while (accumulator >= fixedDt && steps < maxStepsPerFrame) {
      stepPhysics(fixedDt)
      accumulator -= fixedDt
      steps++
    }

    render()

    frameId = requestAnimationFrame(loop)
  }

  frameId = requestAnimationFrame(loop)
}
