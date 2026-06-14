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
  /**
   * Resize in place without tearing down the engine. Unused in P0 (the React
   * component recreates the engine on size change); wired for P1/P2 where GPU
   * backends will resize live to avoid losing simulation state.
   */
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas, idle } = opts
  let rafId = 0
  let running = false
  let last = 0
  let accumulator = 0
  let awakeUntil = 0
  let visible = true
  // When true, the next frame redraws even if no physics step ran (a fresh
  // field/resize/dot-size change made the last drawn frame stale).
  let dirty = true

  const loop = (now: number): void => {
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    for (let i = 0; i < r.steps; i++) backend.step(FIXED_DT)
    // Skip the redraw on frames where nothing advanced — e.g. a display
    // refreshing faster than the 90 Hz fixed step yields 0-step frames whose
    // output is identical to the previous one.
    if (r.steps > 0 || dirty) {
      backend.draw()
      dirty = false
    }
    if (idle === 'sleep' && now >= awakeUntil) {
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
    dirty = true
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
