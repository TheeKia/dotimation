import { afterEach, expect, spyOn, test } from 'bun:test'
import { stepField } from '../../src/backends/canvas2d/simulate'
import { createEngine } from '../../src/engine/engine'
import { createField } from '../../src/engine/field'
import { DEFAULT_MOTION, toSimParams } from '../../src/engine/params'
import type { Backend } from '../../src/types'

const originalRaf = globalThis.requestAnimationFrame
const originalCancel = globalThis.cancelAnimationFrame
const originalObserver = globalThis.IntersectionObserver
let cleanup = (): void => {}
afterEach(() => {
  cleanup()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancel
  globalThis.IntersectionObserver = originalObserver
})

function harness() {
  let now = 0
  const time = spyOn(performance, 'now').mockImplementation(() => now)
  let callback: FrameRequestCallback | null = null
  let visibility: IntersectionObserverCallback = () => {}
  globalThis.requestAnimationFrame = (cb) => {
    callback = cb
    return 1
  }
  globalThis.cancelAnimationFrame = () => {
    callback = null
  }
  globalThis.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      visibility = cb
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver
  let steps = 0
  let draws = 0
  const backend: Backend = {
    init() {},
    uploadField() {},
    setParams() {},
    resize() {},
    dispose() {},
    step() {
      steps++
    },
    draw() {
      draws++
    },
    settled() {
      return false
    },
  }
  const engine = createEngine({
    backend,
    canvas: {} as HTMLCanvasElement,
    dpr: 1,
    params: toSimParams({ ...DEFAULT_MOTION, jitter: 0 }, 1, false),
  })
  cleanup = () => {
    engine.dispose()
    time.mockRestore()
  }
  return {
    engine,
    backend,
    advance(ms: number) {
      now += ms
    },
    frame(ms = 1000 / 60) {
      now += ms
      const cb = callback
      callback = null
      cb?.(now)
    },
    visible(value: boolean) {
      visibility(
        [{ isIntersecting: value } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    },
    get pending() {
      return callback !== null
    },
    get steps() {
      return steps
    },
    get draws() {
      return draws
    },
  }
}

test('a field uploaded offscreen still animates after a long absence', () => {
  const h = harness()
  h.visible(false)
  h.engine.setField(createField(1))
  h.advance(60_000)
  h.visible(true)
  expect(h.pending).toBe(true)
  h.frame()
  expect(h.steps).toBeGreaterThan(0)
  expect(h.draws).toBe(1)
  expect(h.pending).toBe(true)
})

test('a suspended frame does not consume the whole physics settle budget', () => {
  const h = harness()
  h.engine.setField(createField(1))
  h.frame(60_000)
  expect(h.pending).toBe(true)
  for (let i = 0; i < 300; i++) h.frame()
  expect(h.pending).toBe(false)
})

test('visibility changes do not restart a settled or disposed engine', () => {
  const h = harness()
  h.engine.setField(createField(1))
  for (let i = 0; i < 300; i++) h.frame()
  h.visible(false)
  h.visible(true)
  expect(h.pending).toBe(false)
  h.engine.dispose()
  h.engine.resize(100, 100)
  expect(h.pending).toBe(false)
})

test('a slow morph reaches its exact target before the timeout puts it to sleep', () => {
  const h = harness()
  const params = toSimParams(
    { ...DEFAULT_MOTION, jitter: 0, settleTime: 10 },
    1,
    false,
  )
  const field = createField(1)
  field.active = field.count = 1
  field.homeX[0] = 1000
  field.targetAlpha[0] = field.alpha[0] = 1
  h.backend.step = (dt) => {
    stepField(field, dt, params)
  }
  h.engine.setParams(params)
  h.engine.setField(field)
  for (let i = 0; i < 1000; i++) h.frame()
  expect(h.pending).toBe(false)
  expect(field.x[0]).toBe(1000)
  expect(field.vx[0]).toBe(0)
})
