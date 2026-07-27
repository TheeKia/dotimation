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
// are accurate, deliberate documentation of the public prop surface. Until
// this file is folded into a type-checked project, treat them as
// editor-checked documentation, not a CI gate.
//
// What's actually verified (not just asserted): each `@ts-expect-error`
// below sits directly above the offending PROPERTY line inside its object
// literal, not above the `const ...: Props = {` declaration — tsc reports
// excess-property errors (TS2353) at the property, so a directive placed
// above the declaration line instead suppresses nothing and additionally
// fails as an "unused '@ts-expect-error' directive" (TS2578). Confirmed by
// building a disposable probe project (`tsconfig.json` extended, `include`
// widened to add this file, `types` widened to add `"bun"` so `bun:test`
// resolves — the real tsconfig's `types: ["@webgpu/types"]` otherwise
// blocks automatic `@types/bun` inclusion for ANY test file, a pre-existing,
// unrelated gap) and running `bunx tsc --noEmit` against it:
//   - With the directive above the `const` line (the bug this comment used
//     to describe): every one of the 6 removed-prop guards produced BOTH a
//     TS2578 (unused directive, at the const line) AND an unsuppressed
//     TS2353 (excess property, at the property line) — i.e. the guard
//     would fail open if a removed prop were ever reintroduced, while
//     simultaneously erroring on its own directive.
//   - With the directive moved to directly above the property (current
//     state below): the probe reports zero diagnostics, exit code 0 — the
//     6 guards suppress cleanly and the 2 valid fixtures (`validFixed`,
//     `validFill`) type-check with no errors.
// So: the guards below are now genuinely correct and WILL start being
// enforced automatically (with the "bun" types caveat above) the moment
// `test/**` is folded into a type-checked project — that just isn't this
// repo's `bun run type-check` today.
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
