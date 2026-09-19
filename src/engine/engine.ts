import type { Backend, ParticleField } from '@/types'
import { accumulate, FIXED_DT } from './clock'
import { snapField } from './field'
import type { SimParams } from './params'
import { computeSettleDuration } from './settle'

export interface EngineOptions {
  backend: Backend
  canvas: HTMLCanvasElement
  dpr: number
  params: SimParams
}

export interface Engine {
  /** Push a reconciled field; `full` is forwarded to Backend.uploadField. */
  setField(field: ParticleField, full?: boolean): void
  /**
   * Apply new sim params live (dot size, jitter, spring, fade) without
   * recreating anything. Also re-derives the loop policy: jitter > 0 means
   * the shimmer must stay visible, so the loop runs whenever on-screen and
   * the field has content; jitter === 0 (or an empty field) means nothing
   * moves once settled, so the loop sleeps.
   */
  setParams(params: SimParams): void
  /**
   * Resize in place without tearing down the engine — the component calls this
   * on width/height changes so simulation state survives across resizes.
   */
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas } = opts
  let settleSeconds = computeSettleDuration(
    opts.params.settleTime,
    opts.params.opacityRate,
    opts.params.colorRate,
  )
  // `continuous` is what jitter alone asks for; the loop policy everywhere
  // below reads `continuous && hasContent` — an empty ACTIVE layout (no
  // item.data, or fill mode before the first measure) has nothing to
  // shimmer, so it must go through the ordinary settle/sleep path
  // regardless of jitter (see setField for why `active`, not `count`).
  let continuous = opts.params.jitter > 0
  let hasContent = false
  let currentField: ParticleField | null = null
  let rafId = 0
  let running = false
  let last = 0
  let accumulator = 0
  let remaining = 0
  let needsFrame = false
  let disposed = false
  let visible = true

  const loop = (now: number): void => {
    if (disposed) return
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    remaining -= r.steps * FIXED_DT
    for (let i = 0; i < r.steps; i++) backend.step(FIXED_DT)
    const finish =
      !(continuous && hasContent) && (remaining <= 0 || !!backend.settled?.())
    if (finish && currentField) {
      // The spring's settle time is an approximation. Complete the layout
      // before sleeping so slow/long-distance morphs cannot freeze short.
      // GPU CPU snapshots are stale, so this must be a full-state upload.
      snapField(currentField)
      backend.uploadField(currentField, true)
    }
    // Always present the running frame, including the exact final state.
    backend.draw()
    if (finish) {
      needsFrame = false
      stop()
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  const start = (): void => {
    if (running || disposed) return
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
    remaining = settleSeconds
    needsFrame = true
    if (!running && visible) start()
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) {
            // Paused time does not advance physics or consume the settle budget.
            if ((continuous && hasContent) || needsFrame) start()
          } else {
            stop()
          }
        })
      : null
  io?.observe(canvas)

  return {
    setField(field, full): void {
      // Track content BEFORE uploading/waking, and gate on `active` (the
      // live layout), not `count`: `count` includes in-flight faders, so an
      // empty layout that still has faders (e.g. content -> empty) would
      // stay "stale-true" with count and never let the loop sleep once the
      // fade completes. An empty ACTIVE layout means nothing to shimmer; any
      // faders still ride the settle window below (wake() arms it, and
      // settled() — src/engine/rest.ts — stays false while a fader's alpha
      // is still above threshold, so the fade finishes on the sleep path
      // before the loop stops itself). A field that just became non-empty
      // must be eligible for the continuous path immediately (wake() below
      // starts the loop if so).
      currentField = field
      hasContent = field.active > 0
      backend.uploadField(field, full)
      wake()
    },
    setParams(next): void {
      backend.setParams(next)
      settleSeconds = computeSettleDuration(
        next.settleTime,
        next.opacityRate,
        next.colorRate,
      )
      continuous = next.jitter > 0
      if (continuous && hasContent) {
        if (visible && !running) start()
      } else {
        // One settle window so an in-flight morph (or a fresh dot size)
        // paints before the loop stops itself.
        wake()
      }
    },
    resize(devW, devH): void {
      backend.resize(devW, devH)
      wake()
    },
    dispose(): void {
      disposed = true
      currentField = null
      stop()
      io?.disconnect()
      backend.dispose()
    },
  }
}
