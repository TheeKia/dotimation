import { afterEach, expect, mock, test } from 'bun:test'
import {
  systemReducedMotion,
  watchDpr,
  watchFont,
  watchReducedMotion,
} from '../../src/runtime/environment'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
afterEach(() => {
  for (const [key, descriptor] of [
    ['window', originalWindow],
    ['document', originalDocument],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

function mediaHarness() {
  const queries: { query: string; listeners: Set<() => void> }[] = []
  const browser = {
    devicePixelRatio: 1,
    matchMedia: (query: string) => {
      const listeners = new Set<() => void>()
      queries.push({ query, listeners })
      return {
        matches: query.includes('reduce'),
        addEventListener: (_event: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) =>
          listeners.delete(listener),
      }
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: browser,
  })
  return { queries, browser }
}

test('DPR watching re-arms at the new ratio and cleanup releases the latest listener', () => {
  const h = mediaHarness()
  const changed = mock(() => {})
  const cleanup = watchDpr(changed)
  expect(h.queries[0]!.query).toBe('(resolution: 1dppx)')
  h.browser.devicePixelRatio = 2
  for (const listener of [...h.queries[0]!.listeners]) listener()
  expect(h.queries[0]!.listeners.size).toBe(0)
  expect(h.queries[1]!.query).toBe('(resolution: 2dppx)')
  expect(changed).toHaveBeenCalledTimes(1)
  cleanup()
  expect(h.queries[1]!.listeners.size).toBe(0)
})

test('reduced-motion subscription is removable and reads the operating system preference', () => {
  const h = mediaHarness()
  const changed = mock(() => {})
  const cleanup = watchReducedMotion(changed)
  expect(systemReducedMotion()).toBe(true)
  for (const listener of h.queries[0]!.listeners) listener()
  expect(changed).toHaveBeenCalledTimes(1)
  cleanup()
  expect(h.queries[0]!.listeners.size).toBe(0)
})

test('font readiness uses actual text, ignores unmatched faces and cancels late arrivals', async () => {
  const pending: ((faces: FontFace[]) => void)[] = []
  const check = mock(() => false)
  const load = mock(
    (_font: string, _text: string) =>
      new Promise<FontFace[]>((resolve) => pending.push(resolve)),
  )
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { fonts: { check, load } },
  })
  const loaded = mock(() => {})
  const item = { type: 'text', data: '漢字', fontFamily: 'Custom' } as const
  const cancel = watchFont(item, 'sans-serif', loaded)
  expect(load).toHaveBeenCalledWith('16px Custom', '漢字')
  cancel()
  pending[0]!([{} as FontFace])
  await Promise.resolve()
  expect(loaded).not.toHaveBeenCalled()
  watchFont(item, 'sans-serif', loaded)
  pending[1]!([])
  await Promise.resolve()
  expect(loaded).not.toHaveBeenCalled()
  watchFont(item, 'sans-serif', loaded)
  pending[2]!([{} as FontFace])
  await Promise.resolve()
  expect(loaded).toHaveBeenCalledTimes(1)
})

test('generic and already-loaded fonts need no async work', () => {
  const load = mock(async () => [])
  const check = mock(() => true)
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { fonts: { check, load } },
  })
  watchFont({ type: 'text', data: 'A' }, 'sans-serif', () => {})
  expect(check).not.toHaveBeenCalled()
  watchFont(
    { type: 'text', data: 'A', fontFamily: 'Loaded' },
    'sans-serif',
    () => {},
  )
  expect(check).toHaveBeenCalledTimes(1)
  expect(load).not.toHaveBeenCalled()
})
