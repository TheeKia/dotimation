import { expect, test } from 'bun:test'
import type { ComponentProps } from 'react'
import type { DotOptions, MotionOptions, SimParams } from '../src/index'
import { Dotimation } from '../src/index'

// Public API fixtures are compiled by test/tsconfig.json in `bun run type-check`.

test('Dotimation is exported as a function component', () => {
  expect(typeof Dotimation).toBe('function')
})

test('DotOptions / MotionOptions / SimParams are usable as plain objects', () => {
  const d: DotOptions = { size: 2, spacing: 3, threshold: 100, max: 500 }
  const m: MotionOptions = { jitter: 0.5, settleTime: 1, damping: 0.8, fade: 3 }
  const s: SimParams = {
    dotSize: 2,
    jitter: 1,
    k: 100,
    c: 10,
    settleTime: 0.85,
    opacityRate: 2,
    colorRate: 2,
  }
  expect(d.size).toBe(2)
  expect(m.jitter).toBe(0.5)
  expect(s.dotSize).toBe(2)
})

// Type-level public API checks.

type Props = ComponentProps<typeof Dotimation>

// Valid usage: fixed size with inline `dots`/`motion` literals must
// type-check cleanly — no @ts-expect-error on this one.
const validFixed: Props = {
  item: { type: 'text', data: 'hello' },
  width: 200,
  height: 80,
  dots: { size: 2, spacing: 3, threshold: 120, max: 5000 },
  motion: { jitter: 0.5, settleTime: 0.9, damping: 0.9, fade: 2 },
}

// Valid usage: fill mode also type-checks.
const validFill: Props = {
  item: { type: 'image', data: '/x.png' },
  fill: true,
}

// Removed props (params-API redesign) must be rejected --------------------

const removedDotSize: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  // @ts-expect-error dotSize was replaced by dots.size
  dotSize: 4,
}

const removedPointSpacingCss: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  // @ts-expect-error pointSpacingCss was replaced by dots.spacing
  pointSpacingCss: 4,
}

const removedAlpha: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  // @ts-expect-error alpha was replaced by dots.threshold
  alpha: 128,
}

const removedMaxParticles: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  // @ts-expect-error maxParticles was replaced by dots.max
  maxParticles: 1000,
}

const removedIdle: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  // @ts-expect-error idle was removed; loop policy now derives from motion.jitter (and field content)
  idle: true,
}

const removedCanvasRef: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  // @ts-expect-error canvasRef was replaced by the React 19 `ref` prop
  canvasRef: { current: null },
}

test('type-level surface fixtures above are exercised (no DOM rendering)', () => {
  // These consts exist purely so the assignments above are real variable
  // declarations subject to the type checks described in the note at the
  // top of this file. Referencing them here just keeps them "used".
  const fixtures = [
    validFixed,
    validFill,
    removedDotSize,
    removedPointSpacingCss,
    removedAlpha,
    removedMaxParticles,
    removedIdle,
    removedCanvasRef,
  ]
  expect(fixtures.length).toBe(8)
})
