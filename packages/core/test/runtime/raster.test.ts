import { expect, spyOn, test } from 'bun:test'
import type { RasterInputs } from '../../src/raster/inputs'
import { createRasterScheduler } from '../../src/runtime/raster'
import type { FieldTargets } from '../../src/types'

const inputs = (text: string): RasterInputs => ({
  item: { type: 'text', data: text },
  width: 100,
  height: 50,
  defaultFontFamily: 'sans-serif',
  threshold: 100,
  spacing: 2,
  max: 100,
  maxDpr: 2,
  dprEpoch: 0,
  fontEpoch: 0,
})
const targets = (count: number): FieldTargets => ({
  count,
  homeX: new Float32Array(count),
  homeY: new Float32Array(count),
  homeR: new Float32Array(count),
  homeG: new Float32Array(count),
  homeB: new Float32Array(count),
})
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function harness() {
  const jobs: {
    input: RasterInputs
    resolve: (targets: FieldTargets) => void
    reject: (reason: Error) => void
  }[] = []
  const published: FieldTargets[] = []
  const scheduler = createRasterScheduler(
    (value) => published.push(value),
    (input) =>
      new Promise((resolve, reject) => jobs.push({ input, resolve, reject })),
  )
  return { jobs, published, scheduler }
}

test('raster storms coalesce and never publish stale results', async () => {
  const h = harness()
  h.scheduler.update(inputs('a'))
  h.scheduler.update(inputs('b'))
  h.scheduler.update(inputs('c'))
  expect(h.jobs).toHaveLength(1)
  h.jobs[0]!.resolve(targets(1))
  await flush()
  expect(h.published).toHaveLength(0)
  expect(h.jobs.map((job) => job.input.item.data)).toEqual(['a', 'c'])
  h.jobs[1]!.resolve(targets(3))
  await flush()
  expect(h.published.map((value) => value.count)).toEqual([3])
})

test('cleanup cancels queued work and a subsequent session can reuse the scheduler', async () => {
  const h = harness()
  h.scheduler.update(inputs('a'))
  h.scheduler.update(inputs('b'))
  h.scheduler.invalidate()
  h.jobs[0]!.resolve(targets(1))
  await flush()
  expect(h.jobs).toHaveLength(1)
  expect(h.published).toHaveLength(0)
  h.scheduler.update(inputs('b'))
  expect(h.jobs).toHaveLength(2)
})

test('empty layouts publish immediately and supersede pending nonempty content', async () => {
  const h = harness()
  h.scheduler.update(inputs('a'))
  h.scheduler.update(inputs(''))
  expect(h.published.map((value) => value.count)).toEqual([0])
  h.jobs[0]!.resolve(targets(1))
  await flush()
  expect(h.published.map((value) => value.count)).toEqual([0])
})

test('failed inputs retry on the next update, but successful identical inputs do not', async () => {
  const h = harness()
  const warning = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const input = inputs('a')
    h.scheduler.update(input)
    h.jobs[0]!.reject(new Error('decode failed'))
    await flush()
    h.scheduler.update(input)
    expect(h.jobs).toHaveLength(2)
    h.jobs[1]!.resolve(targets(1))
    await flush()
    h.scheduler.update(inputs('a'))
    expect(h.jobs).toHaveLength(2)
  } finally {
    warning.mockRestore()
  }
})

test('caller mutation cannot change the in-flight or previous snapshot', async () => {
  const h = harness()
  const input = inputs('a')
  h.scheduler.update(input)
  input.item.data = 'b'
  h.scheduler.update(input)
  expect(h.jobs[0]!.input.item.data).toBe('a')
  h.jobs[0]!.resolve(targets(1))
  await flush()
  expect(h.jobs[1]!.input.item.data).toBe('b')
})
