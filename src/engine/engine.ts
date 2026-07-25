import type { Backend, IdleBehavior, ParticleField } from '@/types'
import { accumulate, FIXED_DT } from './clock'
import { OPACITY_RATE, SETTLE_TIME } from './constants'
import { computeSettleDuration } from './settle'

export interface EngineOptions {
  backend: Backend
  canvas: HTMLCanvasElement
  dpr: number
  idle: IdleBehavior
}

const SETTLE_SECONDS = computeSettleDuration(SETTLE_TIME, OPACITY_RATE)

export interface Engine {
  setField(field: ParticleField): void
  /** Update the dot footprint live (read at draw time) without recreating the engine. */
  setDotSize(dotSize: number): void
  /** Switch idle behavior live (read by the loop each frame) without recreating the engine. */
  setIdle(next: IdleBehavior): void
  /**
   * Resize in place without tearing down the engine — the component calls this
   * on width/height changes so simulation state survives across resizes.
   */
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas } = opts
  let idle = opts.idle
  let rafId = 0
  let running = false
  let last = 0
  let accumulator = 0
  let awakeUntil = 0
  let visible = true

  const loop = (now: number): void => {
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    for (let i = 0; i < r.steps; i++) backend.step(FIXED_DT)
    // Draw unconditionally while running: a skipped present is what made
    // cleared-buffer flicker possible on high-refresh displays, and skipping
    // was only ever worth it when preserveDrawingBuffer paid for it on every
    // real present. The loop only runs during the awake window, so the extra
    // draws are bounded and cheap.
    backend.draw()
    if (idle === 'sleep' && (now >= awakeUntil || backend.settled?.())) {
      stop()
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  const start = (): void => {
    if (running) return
    running = true
    last = performance.now()
    accumulator = 0
    rafId = requestAnimationFrame(loop)
  }

  const stop = (): void => {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  const wake = (): void => {
    awakeUntil = performance.now() + SETTLE_SECONDS * 1000
    if (!running && visible) start()
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) {
            // In 'animate' mode the loop must run whenever on-screen; in
            // 'sleep' mode only resume if we're still inside the wake window.
            if (idle === 'animate' || performance.now() < awakeUntil) start()
          } else {
            stop()
          }
        })
      : null
  io?.observe(canvas)

  return {
    setField(field): void {
      backend.uploadField(field)
      wake()
    },
    setDotSize(dotSize): void {
      backend.setDotSize(dotSize)
      wake()
    },
    setIdle(next): void {
      if (next === idle) return
      idle = next
      // 'animate' must run whenever visible; 'sleep' gets one settle window
      // so an in-flight morph finishes before the loop stops itself.
      if (idle === 'animate') {
        if (visible && !running) start()
      } else {
        wake()
      }
    },
    resize(devW, devH): void {
      backend.resize(devW, devH)
      wake()
    },
    dispose(): void {
      stop()
      io?.disconnect()
      backend.dispose()
    },
  }
}
