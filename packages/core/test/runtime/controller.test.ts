import { expect, mock, test } from 'bun:test'
import type { Engine } from '../../src/engine/engine'
import { BackendRetryError, type SelectOptions } from '../../src/engine/select'
import {
  createController,
  type RuntimeDependencies,
} from '../../src/runtime/controller'
import type { DotimationOptions } from '../../src/runtime/options'
import type { Backend, FieldTargets, ParticleField } from '../../src/types'

const options = (
  overrides: Partial<DotimationOptions> = {},
): DotimationOptions =>
  ({
    item: { type: 'text', data: 'a' },
    width: 100,
    height: 50,
    backend: 'canvas2d',
    ...overrides,
  }) as DotimationOptions
const canvas = (): HTMLCanvasElement =>
  ({ width: 300, height: 150 }) as HTMLCanvasElement
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const target: FieldTargets = {
  count: 1,
  homeX: Float32Array.of(25),
  homeY: Float32Array.of(25),
  homeR: Float32Array.of(255),
  homeG: Float32Array.of(0),
  homeB: Float32Array.of(0),
}

function harness() {
  const initializations: {
    options: SelectOptions
    resolve: (result: { backend: Backend; kind: 'canvas2d' }) => void
    reject: (error: Error) => void
  }[] = []
  const backend: Backend = {
    init() {},
    uploadField() {},
    setParams() {},
    step() {},
    draw() {},
    resize() {},
    dispose: mock(() => {}),
  }
  const engine = {
    setField: mock((_field: ParticleField, _full?: boolean) => {}),
    setParams: mock((_params: Parameters<Engine['setParams']>[0]) => {}),
    resize: mock((_w: number, _h: number) => {}),
    dispose: mock(() => {}),
  }
  const rasterize = mock(async () => target)
  const dependencies: RuntimeDependencies = {
    select: (options) =>
      new Promise((resolve, reject) =>
        initializations.push({ options, resolve, reject }),
      ),
    engine: mock(() => engine),
    rasterize,
  }
  const replaceCanvas = mock(() => {})
  const controller = createController({ replaceCanvas }, dependencies)
  return {
    controller,
    initializations,
    backend,
    engine,
    dependencies,
    replaceCanvas,
    rasterize,
  }
}

test('controller construction and prop updates acquire no browser resources before connect', () => {
  const h = harness()
  h.controller.update(options())
  expect(h.initializations).toHaveLength(0)
  expect(h.rasterize).not.toHaveBeenCalled()
  expect(h.replaceCanvas).not.toHaveBeenCalled()
})

test('async startup synchronizes the latest size, motion, content and stats callback', async () => {
  const h = harness()
  const oldStats = mock(() => {})
  const newStats = mock(() => {})
  h.controller.update(options({ onStats: oldStats }))
  const element = canvas()
  const cleanup = h.controller.connect(element)
  h.controller.update(
    options({ width: 480, motion: { jitter: 0 }, onStats: newStats }),
  )
  await flush()
  h.initializations[0]!.resolve({ backend: h.backend, kind: 'canvas2d' })
  await flush()
  expect(h.engine.resize).toHaveBeenLastCalledWith(480, 50)
  expect(h.engine.setParams.mock.calls.at(-1)![0].jitter).toBe(0)
  expect(h.engine.setField).toHaveBeenCalledTimes(1)
  expect(oldStats).not.toHaveBeenCalled()
  expect(newStats).toHaveBeenLastCalledWith({
    backend: 'canvas2d',
    particles: 1,
  })
  cleanup()
})

test('cancelled startup disposes a late backend without creating an engine or publishing stats', async () => {
  const h = harness()
  const stats = mock(() => {})
  h.controller.update(options({ onStats: stats }))
  const cleanup = h.controller.connect(canvas())
  cleanup()
  expect(h.initializations[0]!.options.signal?.aborted).toBe(true)
  h.initializations[0]!.resolve({ backend: h.backend, kind: 'canvas2d' })
  await flush()
  expect(h.backend.dispose).toHaveBeenCalledTimes(1)
  expect(h.dependencies.engine).not.toHaveBeenCalled()
  expect(stats).not.toHaveBeenCalled()
})

test('fallback waits for a fresh canvas and old cleanup cannot stop the new session', async () => {
  const h = harness()
  h.controller.update(options({ backend: 'webgl2' }))
  const first = canvas()
  const oldCleanup = h.controller.connect(first)
  h.initializations[0]!.reject(
    new BackendRetryError('canvas2d', { cause: new Error('GPU failed') }),
  )
  await flush()
  expect(h.replaceCanvas).toHaveBeenCalledTimes(1)
  expect(h.initializations).toHaveLength(1)
  const second = canvas()
  h.controller.update(options({ backend: 'webgl2' }))
  const cleanup = h.controller.connect(second)
  oldCleanup()
  expect(h.initializations[1]!.options.requested).toBe('canvas2d')
  expect(h.initializations[1]!.options.canvas).toBe(second)
  expect(h.initializations[1]!.options.signal?.aborted).toBe(false)
  h.initializations[1]!.resolve({ backend: h.backend, kind: 'canvas2d' })
  await flush()
  cleanup()
  cleanup()
  expect(h.engine.dispose).toHaveBeenCalledTimes(1)
})

test('live motion updates preserve the session and identical options do not wake or rasterize again', async () => {
  const h = harness()
  h.controller.update(options())
  const cleanup = h.controller.connect(canvas())
  h.initializations[0]!.resolve({ backend: h.backend, kind: 'canvas2d' })
  await flush()
  const beforeRaster = h.rasterize.mock.calls.length
  const beforeParams = h.engine.setParams.mock.calls.length
  h.controller.update(options())
  expect(h.rasterize).toHaveBeenCalledTimes(beforeRaster)
  expect(h.engine.setParams).toHaveBeenCalledTimes(beforeParams)
  h.controller.update(
    options({ motion: { jitter: 0 }, dots: { size: 'hairline' } }),
  )
  expect(h.engine.setParams).toHaveBeenCalledTimes(beforeParams + 1)
  expect(h.rasterize).toHaveBeenCalledTimes(beforeRaster)
  expect(h.replaceCanvas).not.toHaveBeenCalled()
  expect(h.initializations).toHaveLength(1)
  cleanup()
})

test('reduced motion snaps the first upload and forces full GPU state synchronization', async () => {
  const h = harness()
  h.controller.update(options({ reducedMotion: true, motion: { jitter: 2 } }))
  const cleanup = h.controller.connect(canvas())
  h.initializations[0]!.resolve({ backend: h.backend, kind: 'canvas2d' })
  await flush()
  const [field, full] = h.engine.setField.mock.calls.at(-1)!
  expect(full).toBe(true)
  expect(field.x[0]).toBe(25)
  expect(field.alpha[0]).toBe(1)
  expect(h.engine.setParams.mock.calls.at(-1)![0].jitter).toBe(0)
  cleanup()
})

test('configuration changes abort initialization and ignore its eventual fallback', async () => {
  const h = harness()
  h.controller.update(options({ backend: 'webgl2' }))
  h.controller.connect(canvas())
  h.controller.update(options({ backend: 'canvas2d', maxDpr: 1 }))
  expect(h.initializations[0]!.options.signal?.aborted).toBe(true)
  const cleanup = h.controller.connect(canvas())
  h.initializations[0]!.reject(
    new BackendRetryError('canvas2d', { cause: new Error('old failure') }),
  )
  await flush()
  expect(h.replaceCanvas).toHaveBeenCalledTimes(1)
  expect(h.initializations[1]!.options.requested).toBe('canvas2d')
  cleanup()
})
