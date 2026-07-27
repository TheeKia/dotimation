import { expect, test } from 'bun:test'
import type { ComponentProps } from 'react'
import type { DotOptions, MotionOptions, SimParams } from '../src/index'
import { Dotimation } from '../src/index'

// -----------------------------------------------------------------------
// Enforcement note — read before touching anything below.
//
// The `expect(...)` calls in this file are real: they run, and can fail,
// every time `bun test` runs.
//
// The `@ts-expect-error` / typed-literal assertions further down are NOT
// currently enforced by anything this repo runs:
//   - `bun test` transpiles TypeScript (strips types) but does not
//     type-check it. Verified directly: a bogus `@ts-expect-error` with no
//     real error underneath it, and an object literal with a made-up excess
//     property assigned to a narrow interface, both pass `bun test` with
//     zero diagnostics.
//   - `bun run type-check` runs `tsc --noEmit` against the root
//     tsconfig.json, whose `include` is `src/**/*` only. This file lives
//     under `test/`, so tsc's project never contains it at all
//     (`tsc --listFiles` omits it) — the compiler never opens the file, so
//     it can neither catch a real error nor flag an unused
//     `@ts-expect-error` directive.
//   - Biome (lint) is not type-aware and does not evaluate these either.
//
// So: nothing in CI currently gates the type-level assertions below. They
// are accurate, deliberate documentation of the public prop surface, and
// they WILL start being enforced automatically the moment `test/**` (or
// this file) is added to a project that `tsc --noEmit` covers. Until then,
// treat them as editor-checked documentation, not a CI gate — this only
// matters for the props removed by the params-API redesign, guarded below.
// -----------------------------------------------------------------------

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

// --- Type-only surface checks (see enforcement note above) --------------

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

// @ts-expect-error dotSize was replaced by dots.size
const removedDotSize: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  dotSize: 4,
}

// @ts-expect-error pointSpacingCss was replaced by dots.spacing
const removedPointSpacingCss: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  pointSpacingCss: 4,
}

// @ts-expect-error alpha was replaced by dots.threshold
const removedAlpha: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  alpha: 128,
}

// @ts-expect-error maxParticles was replaced by dots.max
const removedMaxParticles: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  maxParticles: 1000,
}

// @ts-expect-error idle was removed; loop policy now derives from motion.jitter (and field content)
const removedIdle: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
  idle: true,
}

// @ts-expect-error canvasRef was replaced by the React 19 `ref` prop
const removedCanvasRef: Props = {
  item: { type: 'text', data: 'x' },
  width: 10,
  height: 10,
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
